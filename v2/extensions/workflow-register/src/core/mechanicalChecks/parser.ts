import * as fs from "fs/promises"
import { MechanicalCheckParserDefinition } from "./config"

export interface MechanicalCheckProcessOutput {
  exitCode?: number
  stdout: string
  stderr: string
  timedOut: boolean
  error?: string
}

export interface MechanicalCheckEvidenceFile {
  absolutePath: string
  relativePath: string
  type: string
}

export interface MechanicalCheckMetrics {
  new_warnings?: number
  new_errors?: number
  new_findings?: number
  total_findings?: number
  known_findings?: number
  violations?: number
}

export interface MechanicalCheckFinding {
  id: string
  file?: string
  line?: number
  message: string
  severity: "error" | "warning" | "info"
  source?: string
  fingerprint?: string
}

export type MechanicalCheckParseResult =
  | { ok: true; metrics: MechanicalCheckMetrics; findings: MechanicalCheckFinding[] }
  | { ok: false; reason: string; metrics: MechanicalCheckMetrics; findings: MechanicalCheckFinding[] }

export interface ParseMechanicalCheckOutputInput {
  workspaceRoot: string
  parser: MechanicalCheckParserDefinition
  processResult: MechanicalCheckProcessOutput
  evidence: MechanicalCheckEvidenceFile[]
  knownIds?: Set<string>
}

export async function parseMechanicalCheckOutput(
  input: ParseMechanicalCheckOutputInput
): Promise<MechanicalCheckParseResult> {
  if (input.parser.type === "regex") return parseRegexOutput(input)
  if (input.parser.type === "sarif") return parseStructuredEvidence(input, "SARIF", ["sarif", "json"], parseSarifFindings)
  if (input.parser.type === "csv") {
    const parser = input.parser
    return parseStructuredEvidence(input, "CSV", ["csv"], (text, source) => parseCsvFindings(text, source, parser))
  }
  return passedParse({}, [])
}

async function parseRegexOutput(input: ParseMechanicalCheckOutputInput): Promise<MechanicalCheckParseResult> {
  if (input.parser.type === "regex" && hasEvidenceDelta(input.parser)) {
    const baselineTexts = await deltaEvidenceTexts(input, input.parser.baselineEvidence, ["log", "txt", "out", "err"], "regex baseline evidence")
    const targetTexts = await deltaEvidenceTexts(input, input.parser.targetEvidence, ["log", "txt", "out", "err"], "regex target evidence")
    if (baselineTexts.kind === "error") return baselineTexts.result
    if (targetTexts.kind === "error") return targetTexts.result
    return passedParse(regexDeltaMetrics(input.parser, baselineTexts.texts, targetTexts.texts), [])
  }
  const texts = await inputTexts(input, ["log", "txt", "out", "err"], false)
  if ("input" in input.parser && input.parser.input === "evidence" && texts.length === 0) return failedParse("regex evidence not found")
  const text = texts.map((item) => item.text).join("\n")
  return passedParse({
    ...input.parser.type === "regex" && input.parser.warningPattern
      ? { new_warnings: countPattern(text, input.parser.warningPattern) }
      : {},
    ...input.parser.type === "regex" && input.parser.errorPattern
      ? { new_errors: countPattern(text, input.parser.errorPattern) }
      : {}
  }, [])
}

async function parseStructuredEvidence(
  input: ParseMechanicalCheckOutputInput,
  label: string,
  evidenceTypes: string[],
  parser: (text: string, source: string) => MechanicalCheckFinding[]
): Promise<MechanicalCheckParseResult> {
  if (hasEvidenceDelta(input.parser)) {
    const baselineTexts = await deltaEvidenceTexts(input, input.parser.baselineEvidence, evidenceTypes, `${label} baseline evidence`)
    const targetTexts = await deltaEvidenceTexts(input, input.parser.targetEvidence, evidenceTypes, `${label} target evidence`)
    if (baselineTexts.kind === "error") return baselineTexts.result
    if (targetTexts.kind === "error") return targetTexts.result
    try {
      const baselineFindings = dedupeFindings(baselineTexts.texts.flatMap((item) => parser(item.text, item.source)))
      const targetFindings = dedupeFindings(targetTexts.texts.flatMap((item) => parser(item.text, item.source)))
      const filtered = filterActionableFindings(targetFindings, baselineFindings, input.parser, input.knownIds)
      return passedParse(filtered.metrics, filtered.findings)
    } catch (error) {
      return failedParse(`failed to parse ${label}: ${formatError(error)}`)
    }
  }
  const texts = await inputTexts(input, evidenceTypes, true)
  if (texts.length === 0) return failedParse(`${label} evidence not found`)
  try {
    const findings = dedupeFindings(texts.flatMap((item) => parser(item.text, item.source)))
    const filtered = filterActionableFindings(findings, [], input.parser, input.knownIds)
    return passedParse(filtered.metrics, filtered.findings)
  } catch (error) {
    return failedParse(`failed to parse ${label}: ${formatError(error)}`)
  }
}

async function deltaEvidenceTexts(
  input: ParseMechanicalCheckOutputInput,
  patterns: string[] | undefined,
  evidenceTypes: string[],
  label: string
): Promise<
  | { kind: "texts"; texts: Array<{ text: string; source: string }> }
  | { kind: "error"; result: MechanicalCheckParseResult }
> {
  const evidence = input.evidence.filter((item) => {
    const typeMatches = evidenceTypes.includes(item.type) || evidenceTypes.includes(extensionOf(item.relativePath))
    return typeMatches && (patterns ?? []).some((pattern) => globMatcher(pattern)(item.relativePath))
  })
  if (evidence.length === 0) return { kind: "error", result: failedParse(`${label} not found`) }
  return {
    kind: "texts",
    texts: await Promise.all(evidence.map(async (item) => ({
      text: await fs.readFile(item.absolutePath, "utf8"),
      source: item.relativePath
    })))
  }
}

async function inputTexts(
  input: ParseMechanicalCheckOutputInput,
  evidenceTypes: string[],
  requireMatchingEvidence: boolean
): Promise<Array<{ text: string; source: string }>> {
  const parserInput = "input" in input.parser ? input.parser.input : undefined
  if (parserInput === "stdout") return [{ text: input.processResult.stdout, source: "stdout" }]
  if (parserInput === "stderr") return [{ text: input.processResult.stderr, source: "stderr" }]
  if (!parserInput && !requireMatchingEvidence) {
    return [
      { text: input.processResult.stdout, source: "stdout" },
      { text: input.processResult.stderr, source: "stderr" },
      ...await Promise.all(input.evidence.map(async (item) => ({
        text: await readTextIfPossible(item.absolutePath),
        source: item.relativePath
      })))
    ]
  }
  const evidence = input.evidence.filter((item) => evidenceTypes.includes(item.type) || evidenceTypes.includes(extensionOf(item.relativePath)))
  return Promise.all(evidence.map(async (item) => ({
    text: await fs.readFile(item.absolutePath, "utf8"),
    source: item.relativePath
  })))
}

function parseSarifFindings(text: string, source: string): MechanicalCheckFinding[] {
  const document = JSON.parse(text) as unknown
  const runs = arrayField(asRecord(document), "runs")
  if (runs.length === 0) throw new Error("runs must be a non-empty array")
  return runs.flatMap((run) => arrayField(asRecord(run), "results").map((result) => sarifFinding(asRecord(result), source)))
}

function sarifFinding(result: Record<string, unknown>, source: string): MechanicalCheckFinding {
  const location = firstLocation(result)
  return buildFinding({
    id: stringField(result, "ruleId") ?? stringField(result, "ruleID") ?? "SARIF-FINDING",
    file: location.file,
    line: location.line,
    message: sarifMessage(asRecord(result.message)),
    severity: sarifSeverity(stringField(result, "level")),
    source
  })
}

function firstLocation(result: Record<string, unknown>): { file?: string; line?: number } {
  const location = asRecord(arrayField(result, "locations")[0])
  const physicalLocation = asRecord(location.physicalLocation)
  const artifactLocation = asRecord(physicalLocation.artifactLocation)
  const region = asRecord(physicalLocation.region)
  return {
    file: stringField(artifactLocation, "uri"),
    line: positiveNumberField(region, "startLine")
  }
}

function sarifMessage(record: Record<string, unknown>): string {
  return stringField(record, "text") ?? stringField(record, "markdown") ?? "SARIF finding"
}

function sarifSeverity(value: string | undefined): "error" | "warning" | "info" {
  if (value === "error") return "error"
  if (value === "warning") return "warning"
  if (value === "note" || value === "none") return "info"
  return "warning"
}

function parseCsvFindings(
  text: string,
  source: string,
  parser: Extract<MechanicalCheckParserDefinition, { type: "csv" }>
): MechanicalCheckFinding[] {
  const rows = parseCsvRows(text)
  if (rows.length === 0) return []
  const headers = rows[0].map((header) => header.trim())
  const columns = {
    id: columnIndex(headers, parser.idColumn ?? "id"),
    file: columnIndex(headers, parser.fileColumn ?? "file"),
    line: columnIndex(headers, parser.lineColumn ?? "line"),
    message: columnIndex(headers, parser.messageColumn ?? "message"),
    severity: columnIndex(headers, parser.severityColumn ?? "severity")
  }
  return rows.slice(1)
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row) => buildFinding({
      id: cell(row, columns.id) || "CSV-FINDING",
      file: optionalCell(row, columns.file),
      line: optionalPositiveNumber(cell(row, columns.line)),
      message: cell(row, columns.message) || cell(row, columns.id) || "CSV finding",
      severity: normalizeSeverity(cell(row, columns.severity)),
      source
    }))
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cellValue = ""
  let inQuotes = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]
    if (char === '"' && inQuotes && next === '"') {
      cellValue += '"'
      index += 1
      continue
    }
    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (char === "," && !inQuotes) {
      row.push(cellValue)
      cellValue = ""
      continue
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1
      row.push(cellValue)
      rows.push(row)
      row = []
      cellValue = ""
      continue
    }
    cellValue += char
  }
  if (cellValue.length > 0 || row.length > 0) {
    row.push(cellValue)
    rows.push(row)
  }
  return rows
}

function passedParse(metrics: MechanicalCheckMetrics, findings: MechanicalCheckFinding[]): MechanicalCheckParseResult {
  return { ok: true, metrics, findings }
}

function failedParse(reason: string): MechanicalCheckParseResult {
  return { ok: false, reason, metrics: {}, findings: [] }
}

function findingMetrics(findings: MechanicalCheckFinding[]): MechanicalCheckMetrics {
  return {
    total_findings: findings.length,
    new_findings: findings.length,
    violations: findings.length
  }
}

function regexDeltaMetrics(
  parser: Extract<MechanicalCheckParserDefinition, { type: "regex" }>,
  baselineTexts: Array<{ text: string; source: string }>,
  targetTexts: Array<{ text: string; source: string }>
): MechanicalCheckMetrics {
  const baselineText = baselineTexts.map((item) => item.text).join("\n")
  const targetText = targetTexts.map((item) => item.text).join("\n")
  const newWarnings = parser.warningPattern
    ? Math.max(0, countPattern(targetText, parser.warningPattern) - countPattern(baselineText, parser.warningPattern))
    : undefined
  const newErrors = parser.errorPattern
    ? Math.max(0, countPattern(targetText, parser.errorPattern) - countPattern(baselineText, parser.errorPattern))
    : undefined
  return {
    ...newWarnings !== undefined ? { new_warnings: newWarnings } : {},
    ...newErrors !== undefined ? { new_errors: newErrors } : {}
  }
}

function filterActionableFindings(
  targetFindings: MechanicalCheckFinding[],
  baselineFindings: MechanicalCheckFinding[],
  parser: MechanicalCheckParserDefinition,
  knownIds?: Set<string>
): { metrics: MechanicalCheckMetrics; findings: MechanicalCheckFinding[] } {
  const baselineKeys = new Set(baselineFindings.map((finding) => identityKey(finding, parser)))
  const knownFindings = targetFindings.filter((finding) => isKnownFinding(finding, knownIds))
  const findings = targetFindings.filter((finding) => !baselineKeys.has(identityKey(finding, parser)) && !isKnownFinding(finding, knownIds))
  const includeKnown = baselineFindings.length > 0 || Boolean(knownIds?.size)
  return {
    metrics: {
      total_findings: targetFindings.length,
      new_findings: findings.length,
      ...includeKnown ? { known_findings: knownFindings.length } : {},
      violations: findings.length
    },
    findings
  }
}

function identityKey(finding: MechanicalCheckFinding, parser: MechanicalCheckParserDefinition): string {
  const columns = "identityColumns" in parser && parser.identityColumns?.length ? parser.identityColumns : ["fingerprint"]
  return columns.map((column) => findingIdentityValue(finding, column)).join("|")
}

function findingIdentityValue(finding: MechanicalCheckFinding, column: string): string {
  if (column === "id") return finding.id
  if (column === "file") return finding.file ?? ""
  if (column === "line") return finding.line === undefined ? "" : String(finding.line)
  if (column === "message") return finding.message
  if (column === "severity") return finding.severity
  if (column === "source") return finding.source ?? ""
  if (column === "fingerprint") return finding.fingerprint ?? ""
  return ""
}

function isKnownFinding(finding: MechanicalCheckFinding, knownIds?: Set<string>): boolean {
  return Boolean(knownIds?.has(finding.id) || (finding.fingerprint && knownIds?.has(finding.fingerprint)))
}

function hasEvidenceDelta(
  parser: MechanicalCheckParserDefinition
): parser is Exclude<MechanicalCheckParserDefinition, { type: "exit_code" }> & { baselineEvidence: string[]; targetEvidence: string[] } {
  return "baselineEvidence" in parser && "targetEvidence" in parser && Boolean(parser.baselineEvidence?.length && parser.targetEvidence?.length)
}

function buildFinding(input: {
  id: string
  file?: string
  line?: number
  message: string
  severity: "error" | "warning" | "info"
  source: string
}): MechanicalCheckFinding {
  const fingerprint = [
    input.id,
    input.file ?? "",
    input.line ?? "",
    input.message,
    input.severity
  ].join("|")
  return { ...input, fingerprint }
}

function dedupeFindings(findings: MechanicalCheckFinding[]): MechanicalCheckFinding[] {
  const seen = new Set<string>()
  return findings.filter((finding) => {
    const key = finding.fingerprint ?? `${finding.id}|${finding.file ?? ""}|${finding.line ?? ""}|${finding.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function countPattern(text: string, pattern: string): number {
  try {
    return Array.from(text.matchAll(new RegExp(pattern, "g"))).length
  } catch {
    return 0
  }
}

async function readTextIfPossible(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8")
  } catch {
    return ""
  }
}

function arrayField(record: Record<string, unknown>, key: string): unknown[] {
  return Array.isArray(record[key]) ? record[key] as unknown[] : []
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function positiveNumberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

function columnIndex(headers: string[], name: string): number {
  return headers.findIndex((header) => header === name)
}

function cell(row: string[], index: number): string {
  return index >= 0 && index < row.length ? row[index].trim() : ""
}

function optionalCell(row: string[], index: number): string | undefined {
  const value = cell(row, index)
  return value || undefined
}

function optionalPositiveNumber(value: string): number | undefined {
  if (!value.trim()) return undefined
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function normalizeSeverity(value: string): "error" | "warning" | "info" {
  const normalized = value.trim().toLowerCase()
  if (normalized === "error" || normalized === "fatal") return "error"
  if (normalized === "warning" || normalized === "warn") return "warning"
  return "info"
}

function extensionOf(relativePath: string): string {
  const dotIndex = relativePath.lastIndexOf(".")
  return dotIndex >= 0 ? relativePath.slice(dotIndex + 1).toLowerCase() : ""
}

function globMatcher(pattern: string): (relativePath: string) => boolean {
  const source = pattern.replace(/\\/g, "/")
  let regex = "^"
  for (let index = 0; index < source.length; index += 1) {
    if (source.startsWith("**/", index)) {
      regex += "(?:.*/)?"
      index += 2
      continue
    }
    const char = source[index]
    if (char === "*" && source[index + 1] === "*") {
      regex += ".*"
      index += 1
    } else if (char === "*") {
      regex += "[^/]*"
    } else if (char === "?") {
      regex += "[^/]"
    } else {
      regex += escapeRegExp(char)
    }
  }
  regex += "$"
  const compiled = new RegExp(regex)
  return (relativePath) => compiled.test(relativePath.replace(/\\/g, "/"))
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
