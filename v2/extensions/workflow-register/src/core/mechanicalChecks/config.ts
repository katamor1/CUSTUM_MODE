import * as path from "path"

const yaml = require("js-yaml") as { load(text: string): unknown }

const SCHEMA_VERSION = "bob-mechanical-checks/v1"
const RUNNERS = new Set(["bat", "powershell", "python", "node", "executable"])
const PARSERS = new Set(["exit_code", "regex", "sarif", "csv"])
const PARSER_INPUTS = new Set(["stdout", "stderr", "evidence"])
const GATES = new Set(["pre_code_review", "pre_bob_review", "post_bob_review", "pre_test_start", "release_readiness"])

export type MechanicalCheckStatus = "passed" | "warning" | "failed" | "blocked"
export type MechanicalCheckRunnerType = "bat" | "powershell" | "python" | "node" | "executable"
export type MechanicalCheckParserType = "exit_code" | "regex" | "sarif" | "csv"
export type MechanicalCheckParserInput = "stdout" | "stderr" | "evidence"

export interface MechanicalChecksConfig {
  schemaVersion: typeof SCHEMA_VERSION
  projectId?: string
  profiles: MechanicalCheckProfile[]
  checks: MechanicalCheckDefinition[]
}

export interface MechanicalCheckProfile {
  id: string
  title: string
  gate: string
  checks: string[]
}

export interface MechanicalCheckDefinition {
  id: string
  title: string
  runner: MechanicalCheckRunnerType
  command: string
  cwd: string
  args: string[]
  env: Record<string, string>
  timeoutSeconds: number
  changedFilesOnly: boolean
  evidence: {
    collect: string[]
  }
  parser: MechanicalCheckParserDefinition
  passCondition: MechanicalCheckPassCondition
  severityOnFail: "error" | "warning" | "info"
  allowFailure: boolean
}

export type MechanicalCheckParserDefinition =
  | { type: "exit_code" }
  | ({
    type: "regex"
    input?: MechanicalCheckParserInput
    warningPattern?: string
    errorPattern?: string
  } & MechanicalCheckDeltaDefinition)
  | ({ type: "sarif"; input: MechanicalCheckParserInput } & MechanicalCheckDeltaDefinition)
  | ({
    type: "csv"
    input: MechanicalCheckParserInput
    idColumn?: string
    fileColumn?: string
    lineColumn?: string
    messageColumn?: string
    severityColumn?: string
  } & MechanicalCheckDeltaDefinition)

export interface MechanicalCheckDeltaDefinition {
  baselineEvidence?: string[]
  targetEvidence?: string[]
  identityColumns?: string[]
}

export interface MechanicalCheckPassCondition {
  maxNewWarnings?: number
  maxNewErrors?: number
  maxNewFindings?: number
  maxViolations?: number
  allowKnownIdsFile?: string
}

export type MechanicalChecksConfigValidationResult =
  | { ok: true; config: MechanicalChecksConfig; diagnostics: string[] }
  | { ok: false; diagnostics: string[]; config?: MechanicalChecksConfig }

export interface MechanicalChecksConfigValidationOptions {
  workspaceRoot?: string
}

export function parseMechanicalChecksConfig(
  text: string,
  options: MechanicalChecksConfigValidationOptions = {}
): MechanicalChecksConfigValidationResult {
  try {
    return validateMechanicalChecksConfig(yaml.load(text), options)
  } catch (error) {
    return { ok: false, diagnostics: [`invalid YAML: ${formatError(error)}`] }
  }
}

export function validateMechanicalChecksConfig(
  value: unknown,
  options: MechanicalChecksConfigValidationOptions = {}
): MechanicalChecksConfigValidationResult {
  const diagnostics: string[] = []
  const record = asRecord(value)
  const schemaVersion = stringField(record, "schema_version") ?? stringField(record, "schemaVersion")
  if (schemaVersion !== SCHEMA_VERSION) {
    diagnostics.push(`schema_version must be ${SCHEMA_VERSION}`)
  }

  const profiles = arrayField(record, "profiles").map((item, index) => normalizeProfile(asRecord(item), index, diagnostics))
  const checks = arrayField(record, "checks").map((item, index) => normalizeCheck(asRecord(item), index, diagnostics, options))
  validateUniqueIds("profile", profiles, diagnostics)
  validateUniqueIds("check", checks, diagnostics)
  validateProfileCheckReferences(profiles, checks, diagnostics)

  const config: MechanicalChecksConfig = {
    schemaVersion: SCHEMA_VERSION,
    projectId: stringField(record, "project_id") ?? stringField(record, "projectId"),
    profiles,
    checks
  }
  return diagnostics.length === 0 ? { ok: true, config, diagnostics } : { ok: false, config, diagnostics }
}

function normalizeProfile(record: Record<string, unknown>, index: number, diagnostics: string[]): MechanicalCheckProfile {
  const id = requiredString(record, "id", `profiles[${index}].id`, diagnostics)
  const title = stringField(record, "title") ?? id
  const gate = requiredString(record, "gate", `profiles[${index}].gate`, diagnostics)
  if (gate && !GATES.has(gate)) diagnostics.push(`Profile '${id}' uses unsupported gate '${gate}'.`)
  const checks = listField(record, "checks")
  if (checks.length === 0) diagnostics.push(`Profile '${id}' must reference at least one check.`)
  return { id, title, gate, checks }
}

function normalizeCheck(
  record: Record<string, unknown>,
  index: number,
  diagnostics: string[],
  options: MechanicalChecksConfigValidationOptions
): MechanicalCheckDefinition {
  const id = requiredString(record, "id", `checks[${index}].id`, diagnostics)
  const title = stringField(record, "title") ?? id
  const runner = requiredString(record, "runner", `checks[${index}].runner`, diagnostics)
  if (runner && !RUNNERS.has(runner)) diagnostics.push(`Check '${id}' uses unsupported runner '${runner}'.`)
  const command = requiredString(record, "command", `checks[${index}].command`, diagnostics)
  validateWorkspaceRelativePath(command, `Check '${id}' command`, "command", diagnostics, options)
  const cwd = stringField(record, "cwd") ?? "."
  validateWorkspaceRelativePath(cwd, `Check '${id}' cwd`, "cwd", diagnostics, options)

  const evidence = asRecord(record.evidence)
  const collect = listField(evidence, "collect")
  for (const evidencePath of collect) {
    validateWorkspaceRelativePath(evidencePath, `Check '${id}' evidence collect`, "evidence collect path", diagnostics, options)
  }

  const parser = normalizeParser(id, asRecord(record.parser), diagnostics, options)
  const passCondition = normalizePassCondition(asRecord(record.pass_condition ?? record.passCondition))
  if (passCondition.allowKnownIdsFile) {
    validateWorkspaceRelativePath(
      passCondition.allowKnownIdsFile,
      `Check '${id}' allow known ids file`,
      "allow known ids file",
      diagnostics,
      options
    )
  }

  return {
    id,
    title,
    runner: RUNNERS.has(runner) ? runner as MechanicalCheckRunnerType : "executable",
    command,
    cwd,
    args: listField(record, "args"),
    env: stringRecord(record.env),
    timeoutSeconds: numberField(record, "timeout_seconds") ?? numberField(record, "timeoutSeconds") ?? 300,
    changedFilesOnly: booleanField(record, "changed_files_only") ?? booleanField(record, "changedFilesOnly") ?? false,
    evidence: { collect },
    parser,
    passCondition,
    severityOnFail: severityField(record, "severity_on_fail") ?? severityField(record, "severityOnFail") ?? "error",
    allowFailure: booleanField(record, "allow_failure") ?? booleanField(record, "allowFailure") ?? false
  }
}

function normalizeParser(
  checkId: string,
  record: Record<string, unknown>,
  diagnostics: string[],
  options: MechanicalChecksConfigValidationOptions
): MechanicalCheckParserDefinition {
  const type = stringField(record, "type") ?? "exit_code"
  const delta = normalizeDeltaDefinition(checkId, record, diagnostics, options)
  if (!PARSERS.has(type)) {
    diagnostics.push(`Check '${checkId}' uses unsupported parser type '${type}'.`)
    return { type: "exit_code" }
  }
  if (type === "regex") {
    return {
      type: "regex",
      input: parserInputField(checkId, record, "input", diagnostics),
      warningPattern: stringField(record, "warning_pattern") ?? stringField(record, "warningPattern"),
      errorPattern: stringField(record, "error_pattern") ?? stringField(record, "errorPattern"),
      ...delta
    }
  }
  if (type === "sarif") {
    return {
      type: "sarif",
      input: parserInputField(checkId, record, "input", diagnostics) ?? "evidence",
      ...delta
    }
  }
  if (type === "csv") {
    return {
      type: "csv",
      input: parserInputField(checkId, record, "input", diagnostics) ?? "evidence",
      idColumn: stringField(record, "id_column") ?? stringField(record, "idColumn"),
      fileColumn: stringField(record, "file_column") ?? stringField(record, "fileColumn"),
      lineColumn: stringField(record, "line_column") ?? stringField(record, "lineColumn"),
      messageColumn: stringField(record, "message_column") ?? stringField(record, "messageColumn"),
      severityColumn: stringField(record, "severity_column") ?? stringField(record, "severityColumn"),
      ...delta
    }
  }
  return { type: "exit_code" }
}

function normalizeDeltaDefinition(
  checkId: string,
  record: Record<string, unknown>,
  diagnostics: string[],
  options: MechanicalChecksConfigValidationOptions
): MechanicalCheckDeltaDefinition {
  const baselineEvidence = listField(record, "baseline_evidence").concat(listField(record, "baselineEvidence"))
  const targetEvidence = listField(record, "target_evidence").concat(listField(record, "targetEvidence"))
  for (const evidencePath of baselineEvidence) {
    validateWorkspaceRelativePath(evidencePath, `Check '${checkId}' baseline evidence`, "path", diagnostics, options)
  }
  for (const evidencePath of targetEvidence) {
    validateWorkspaceRelativePath(evidencePath, `Check '${checkId}' target evidence`, "path", diagnostics, options)
  }
  return compact({
    baselineEvidence: baselineEvidence.length > 0 ? baselineEvidence : undefined,
    targetEvidence: targetEvidence.length > 0 ? targetEvidence : undefined,
    identityColumns: listField(record, "identity_columns").concat(listField(record, "identityColumns"))
  })
}

function normalizePassCondition(record: Record<string, unknown>): MechanicalCheckPassCondition {
  return compact({
    maxNewWarnings: numberField(record, "max_new_warnings") ?? numberField(record, "maxNewWarnings"),
    maxNewErrors: numberField(record, "max_new_errors") ?? numberField(record, "maxNewErrors"),
    maxNewFindings: numberField(record, "max_new_findings") ?? numberField(record, "maxNewFindings"),
    maxViolations: numberField(record, "max_violations") ?? numberField(record, "maxViolations"),
    allowKnownIdsFile: stringField(record, "allow_known_ids_file") ?? stringField(record, "allowKnownIdsFile")
  })
}

function validateUniqueIds(kind: "profile" | "check", items: Array<{ id: string }>, diagnostics: string[]): void {
  const seen = new Set<string>()
  for (const item of items) {
    if (!item.id) continue
    if (seen.has(item.id)) {
      diagnostics.push(`Duplicate ${kind} id '${item.id}'.`)
      continue
    }
    seen.add(item.id)
  }
}

function validateProfileCheckReferences(
  profiles: MechanicalCheckProfile[],
  checks: MechanicalCheckDefinition[],
  diagnostics: string[]
): void {
  const checkIds = new Set(checks.map((check) => check.id).filter(Boolean))
  for (const profile of profiles) {
    for (const checkId of profile.checks) {
      if (!checkIds.has(checkId)) diagnostics.push(`Profile '${profile.id}' references unknown check '${checkId}'.`)
    }
  }
}

function validateWorkspaceRelativePath(
  value: string,
  owner: string,
  label: string,
  diagnostics: string[],
  _options: MechanicalChecksConfigValidationOptions
): void {
  if (!value.trim()) {
    diagnostics.push(`${owner} ${label} is required.`)
    return
  }
  if (path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value)) {
    diagnostics.push(`${owner} ${label} must be workspace-relative.`)
    return
  }
  const segments = value.replace(/\\/g, "/").split("/").filter(Boolean)
  if (segments.includes("..")) diagnostics.push(`${owner} ${label} escapes the workspace.`)
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  label: string,
  diagnostics: string[]
): string {
  const value = stringField(record, key)
  if (!value) diagnostics.push(`${label} is required.`)
  return value ?? ""
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function arrayField(record: Record<string, unknown>, key: string): unknown[] {
  return Array.isArray(record[key]) ? record[key] as unknown[] : []
}

function listField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key]
  if (Array.isArray(value)) return value.map(String).filter((item) => item.trim()).map((item) => item.trim())
  if (typeof value === "string" && value.trim()) return [value.trim()]
  return []
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return undefined
}

function booleanField(record: Record<string, unknown>, key: string): boolean | undefined {
  return typeof record[key] === "boolean" ? record[key] as boolean : undefined
}

function severityField(record: Record<string, unknown>, key: string): "error" | "warning" | "info" | undefined {
  const value = stringField(record, key)
  return value === "error" || value === "warning" || value === "info" ? value : undefined
}

function parserInputField(
  checkId: string,
  record: Record<string, unknown>,
  key: string,
  diagnostics: string[]
): MechanicalCheckParserInput | undefined {
  const value = stringField(record, key)
  if (!value) return undefined
  if (PARSER_INPUTS.has(value)) return value as MechanicalCheckParserInput
  diagnostics.push(`Check '${checkId}' uses unsupported parser input '${value}'.`)
  return undefined
}

function stringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value)
  return Object.fromEntries(
    Object.entries(record)
      .filter(([, item]) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")
      .map(([key, item]) => [key, String(item)])
  )
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
