export type EvidenceIndexItem = {
  evidence_id?: string
  type?: string
  ref?: string
  source?: string
  location?: string
}

export type EvidenceLookup = {
  byId: Map<string, EvidenceIndexItem>
  byRef: Map<string, EvidenceIndexItem>
}

export type CanonicalizationIssue = {
  severity: "error" | "warning" | "info"
  path: string
  code: string
  message: string
}

export type CanonicalizationReport = {
  issues: CanonicalizationIssue[]
}

const EVIDENCE_TYPES = new Set([
  "requirement",
  "basic_design",
  "detailed_design",
  "test_spec",
  "ledger",
  "ticket",
  "code",
  "check_result"
])
const FINDING_CATEGORIES = new Set([
  "requirement-code-consistency",
  "design-code-consistency",
  "test-gap",
  "document-update-gap",
  "unintended-change",
  "interface-impact",
  "rt-ts-rule",
  "shared-memory-impact",
  "risk"
])
const QUESTION_CATEGORIES = new Set([
  "specification-clarification",
  "scope-clarification",
  "document-version",
  "missing-evidence",
  "test-policy",
  "owner-decision"
])
const COVERAGE_TYPES = new Set(["checked", "partially_checked", "not_checked", "out_of_scope"])

export function canonicalizeBobOutput(parsed: any, evidenceLookup: EvidenceLookup | undefined): any {
  return canonicalizeBobOutputWithReport(parsed, evidenceLookup).output
}

export function canonicalizeBobOutputWithReport(parsed: any, evidenceLookup: EvidenceLookup | undefined): { output: any; report: CanonicalizationReport } {
  const output = canonicalizeBobOutputCore(parsed, evidenceLookup)
  return { output, report: buildCanonicalizationReport(parsed, output) }
}

function canonicalizeBobOutputCore(parsed: any, evidenceLookup: EvidenceLookup | undefined): any {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed
  return pruneUndefined({
    schema_version: normalizeSchemaVersion(parsed.schema_version),
    review_summary: normalizeReviewSummary(parsed.review_summary),
    findings: normalizeFindings(parsed.findings, evidenceLookup),
    questions: normalizeQuestions(parsed.questions, evidenceLookup),
    coverage_notes: normalizeCoverageNotes(parsed.coverage_notes),
    rejected_or_uncertain: normalizeUncertainItems(parsed.rejected_or_uncertain)
  })
}

function buildCanonicalizationReport(parsed: any, output: any): CanonicalizationReport {
  const report: CanonicalizationReport = { issues: [] }
  if (!isRecord(parsed) || !isRecord(output)) return report

  recordDroppedKeys(report, "$", parsed, new Set(["schema_version", "review_summary", "findings", "questions", "coverage_notes", "rejected_or_uncertain"]))
  reportFieldTransform(report, "$.schema_version", parsed.schema_version, output.schema_version)

  const inputSummary = isRecord(parsed.review_summary) ? parsed.review_summary : {}
  const outputSummary = isRecord(output.review_summary) ? output.review_summary : {}
  recordDroppedKeys(report, "$.review_summary", inputSummary, new Set([
    "review_id",
    "package_id",
    "target_range",
    "result_type",
    "final_approval",
    "scope_statement",
    "generated_at",
    "prompt_template_id",
    "note",
    "summary",
    "reviewed_at"
  ]))
  for (const key of ["result_type", "final_approval", "scope_statement", "generated_at"] as const) {
    reportFieldTransform(report, `$.review_summary.${key}`, inputSummary[key], outputSummary[key])
  }

  reportCollection(report, "findings", parsed.findings, output.findings, (itemReport, itemPath, input, normalized) => {
    reportGeneratedId(itemReport, `${itemPath}.id`, input.id, normalized.id)
    reportFieldTransform(itemReport, `${itemPath}.category`, input.category, normalized.category, "defaulted_category", "replaced_category")
    reportEvidenceTransform(itemReport, `${itemPath}.evidence`, input.evidence, normalized.evidence)
    recordDroppedKeys(itemReport, itemPath, input, new Set(["id", "category", "severity", "confidence", "summary", "evidence", "reason", "impact", "recommended_action", "human_check"]))
  })
  reportCollection(report, "questions", parsed.questions, output.questions, (itemReport, itemPath, input, normalized) => {
    reportGeneratedId(itemReport, `${itemPath}.id`, input.id, normalized.id)
    reportFieldTransform(itemReport, `${itemPath}.category`, input.category, normalized.category, "defaulted_category", "replaced_category")
    reportFieldTransform(itemReport, `${itemPath}.suggested_action`, input.suggested_action, normalized.suggested_action)
    reportEvidenceTransform(itemReport, `${itemPath}.evidence`, input.evidence, normalized.evidence)
    recordDroppedKeys(itemReport, itemPath, input, new Set(["id", "category", "summary", "reason", "evidence", "suggested_owner", "suggested_action", "human_check"]))
  })
  reportCollection(report, "coverage_notes", parsed.coverage_notes, output.coverage_notes, (itemReport, itemPath, input, normalized) => {
    reportGeneratedId(itemReport, `${itemPath}.id`, input.id, normalized.id)
    reportFieldTransform(itemReport, `${itemPath}.type`, input.type, normalized.type, "defaulted_type", "replaced_type")
    recordDroppedKeys(itemReport, itemPath, input, new Set(["id", "type", "summary"]))
  })
  reportCollection(report, "rejected_or_uncertain", parsed.rejected_or_uncertain, output.rejected_or_uncertain, (itemReport, itemPath, input, normalized) => {
    reportGeneratedId(itemReport, `${itemPath}.id`, input.id, normalized.id)
    reportFieldTransform(itemReport, `${itemPath}.summary`, input.summary, normalized.summary)
    reportFieldTransform(itemReport, `${itemPath}.next_action`, input.next_action, normalized.next_action)
    recordDroppedKeys(itemReport, itemPath, input, new Set(["id", "summary", "reason", "next_action", "human_check"]))
  })
  return report
}

function reportCollection(
  report: CanonicalizationReport,
  collectionName: string,
  input: unknown,
  normalized: unknown,
  visit: (report: CanonicalizationReport, path: string, input: Record<string, unknown>, normalized: Record<string, unknown>) => void
): void {
  if (!Array.isArray(input) || !Array.isArray(normalized)) return
  normalized.forEach((item, index) => {
    if (!isRecord(item)) return
    const source = isRecord(input[index]) ? input[index] : {}
    visit(report, `$.${collectionName}[${index}]`, source, item)
  })
}

function reportGeneratedId(report: CanonicalizationReport, path: string, input: unknown, normalized: unknown): void {
  if (typeof normalized !== "string" || input === normalized) return
  addIssue(report, "info", path, "generated_id", `Generated canonical id ${normalized}${typeof input === "string" ? ` from ${input}` : ""}.`)
}

function reportFieldTransform(
  report: CanonicalizationReport,
  path: string,
  input: unknown,
  normalized: unknown,
  defaultCode = "defaulted_field",
  replaceCode = "replaced_field"
): void {
  if (normalized === undefined || input === normalized) return
  if (stringValue(input) === undefined) {
    addIssue(report, "warning", path, defaultCode, `Filled ${path} with ${String(normalized)}.`)
    return
  }
  addIssue(report, "warning", path, replaceCode, `Replaced ${path} value ${String(input)} with ${String(normalized)}.`)
}

function reportEvidenceTransform(report: CanonicalizationReport, path: string, input: unknown, normalized: unknown): void {
  if (!Array.isArray(input) || !Array.isArray(normalized)) return
  if (JSON.stringify(input) !== JSON.stringify(normalized)) {
    addIssue(report, "info", path, "normalized_evidence", `Normalized evidence references at ${path}.`)
  }
}

function recordDroppedKeys(report: CanonicalizationReport, path: string, input: Record<string, unknown>, allowed: Set<string>): void {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) addIssue(report, "info", `${path}.${key}`, "dropped_field", `Dropped unsupported field ${path}.${key}.`)
  }
}

function addIssue(report: CanonicalizationReport, severity: CanonicalizationIssue["severity"], path: string, code: string, message: string): void {
  report.issues.push({ severity, path, code, message })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeSchemaVersion(value: unknown): unknown {
  if (value === 1 || value === "1" || value === "1.0") return 1
  return value
}

function normalizeReviewSummary(value: any): any {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {}
  return pruneUndefined({
    review_id: stringValue(input.review_id),
    package_id: stringValue(input.package_id),
    target_range: stringValue(input.target_range),
    result_type: stringValue(input.result_type) ?? "pre_review",
    final_approval: stringValue(input.final_approval) ?? "not_performed",
    scope_statement: stringValue(input.scope_statement)
      ?? stringValue(input.note)
      ?? stringValue(input.summary)
      ?? "入力された review-package の範囲で確認したプレレビュー結果。",
    generated_at: stringValue(input.generated_at) ?? stringValue(input.reviewed_at),
    prompt_template_id: stringValue(input.prompt_template_id)
  })
}

function normalizeFindings(value: unknown, evidenceLookup: EvidenceLookup | undefined): any[] {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => normalizeFinding(item, index, evidenceLookup))
}

function normalizeFinding(item: any, index: number, evidenceLookup: EvidenceLookup | undefined): any {
  const input = item && typeof item === "object" && !Array.isArray(item) ? item : {}
  return pruneUndefined({
    id: normalizePrefixedId(input.id, "PRE", index, ["FIND", "FINDING"]),
    category: normalizeFindingCategory(input.category),
    severity: stringValue(input.severity),
    confidence: stringValue(input.confidence),
    summary: stringValue(input.summary),
    evidence: normalizeEvidenceArray(input.evidence, evidenceLookup),
    reason: stringValue(input.reason),
    impact: stringValue(input.impact),
    recommended_action: stringValue(input.recommended_action),
    human_check: stringValue(input.human_check)
  })
}

function normalizeQuestions(value: unknown, evidenceLookup: EvidenceLookup | undefined): any[] {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => normalizeQuestion(item, index, evidenceLookup))
}

function normalizeQuestion(item: any, index: number, evidenceLookup: EvidenceLookup | undefined): any {
  const input = item && typeof item === "object" && !Array.isArray(item) ? item : {}
  return pruneUndefined({
    id: normalizePrefixedId(input.id, "Q", index, "QUESTION"),
    category: normalizeQuestionCategory(input),
    summary: stringValue(input.summary),
    reason: stringValue(input.reason),
    evidence: normalizeEvidenceArray(input.evidence, evidenceLookup),
    suggested_owner: stringValue(input.suggested_owner),
    suggested_action: stringValue(input.suggested_action)
      ?? stringValue(input.human_check)
      ?? "レビュー担当者が不足情報を確認する。"
  })
}

function normalizeCoverageNotes(value: unknown): any[] {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => {
    const input = item && typeof item === "object" && !Array.isArray(item) ? item : { summary: item }
    const summary = stringValue(input.summary) ?? ""
    return pruneUndefined({
      id: normalizePrefixedId(input.id, "COV", index),
      type: normalizeCoverageType(input.type, summary),
      summary
    })
  })
}

function normalizeUncertainItems(value: unknown): any[] {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => {
    const input = item && typeof item === "object" && !Array.isArray(item) ? item : { summary: item }
    const reason = stringValue(input.reason)
      ?? stringValue(input.summary)
      ?? "finding として採用する十分な根拠がないため。"
    return pruneUndefined({
      id: normalizePrefixedId(input.id, "UNC", index, ["REJ", "REJECTED"]),
      summary: stringValue(input.summary) ?? compactSummary(reason),
      reason,
      next_action: stringValue(input.next_action)
        ?? stringValue(input.human_check)
        ?? "必要に応じて人間が根拠を確認する。"
    })
  })
}

function normalizeEvidenceArray(value: unknown, evidenceLookup: EvidenceLookup | undefined): any[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => normalizeEvidenceRef(item, evidenceLookup))
    .filter((item): item is Record<string, string> => Boolean(item))
}

function normalizeEvidenceRef(
  value: unknown,
  evidenceLookup: EvidenceLookup | undefined
): Record<string, string> | undefined {
  if (typeof value === "string") return evidenceObjectFromToken(evidenceToken(value), evidenceLookup)
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  const evidenceId = stringValue(input.evidence_id)
  const ref = stringValue(input.ref)
  if (!evidenceId && !ref && !stringValue(input.type)) {
    const shorthand = evidenceShorthand(value)
    return shorthand ? evidenceObjectFromToken(evidenceToken(shorthand), evidenceLookup) : undefined
  }
  const indexed = (evidenceId ? evidenceLookup?.byId.get(evidenceId) : undefined)
    ?? (ref ? evidenceLookup?.byRef.get(ref) : undefined)
  const type = normalizeEvidenceType(input.type) ?? normalizeEvidenceType(indexed?.type) ?? "check_result"
  return pruneUndefined({
    evidence_id: evidenceId ?? indexed?.evidence_id,
    type,
    ref: ref ?? indexed?.ref ?? evidenceId
  }) as Record<string, string>
}

function evidenceShorthand(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length !== 1) return undefined
  const [key, item] = entries[0]
  return `${key}${item === null || item === undefined ? "" : `: ${String(item)}`}`
}

function evidenceToken(value: string): string {
  const match = value.trim().match(/^([A-Z][A-Z0-9_-]*-[0-9]{3,})\b/)
  return match?.[1] ?? value.trim()
}

function evidenceObjectFromToken(
  value: string,
  evidenceLookup: EvidenceLookup | undefined
): Record<string, string> | undefined {
  const indexed = evidenceObjectFromLookup(value, evidenceLookup)
  if (indexed) return indexed
  const type = inferEvidenceType(value)
  return type ? { evidence_id: value, type, ref: value } : undefined
}

function evidenceObjectFromLookup(
  value: string,
  evidenceLookup: EvidenceLookup | undefined
): Record<string, string> | undefined {
  const indexed = evidenceLookup?.byId.get(value) ?? evidenceLookup?.byRef.get(value)
  if (!indexed?.evidence_id || !indexed.type || !indexed.ref) return undefined
  const type = normalizeEvidenceType(indexed.type)
  if (!type) return undefined
  return { evidence_id: indexed.evidence_id, type, ref: indexed.ref }
}

function normalizeFindingCategory(value: unknown): string {
  const category = stringValue(value)
  return category && FINDING_CATEGORIES.has(category) ? category : "risk"
}

function normalizeQuestionCategory(input: Record<string, unknown>): string {
  const category = stringValue(input.category)
  if (category && QUESTION_CATEGORIES.has(category)) return category
  if (category === "test-gap") return "test-policy"
  if (category === "document-update-gap") return "document-version"
  if (category === "interface-impact") return "missing-evidence"
  const text = `${stringValue(input.summary) ?? ""} ${stringValue(input.reason) ?? ""} ${stringValue(input.human_check) ?? ""}`
  if (/版|バージョン|旧値|文書/.test(text)) return "document-version"
  if (/スコープ|対象範囲|適用外|対象外|RT\s*経路/.test(text)) return "scope-clarification"
  if (/テスト/.test(text)) return "test-policy"
  if (/オーナー|承認|判断/.test(text)) return "owner-decision"
  if (/仕様/.test(text)) return "specification-clarification"
  return "missing-evidence"
}

function normalizeCoverageType(value: unknown, summary: string): string {
  const type = stringValue(value)
  if (type && COVERAGE_TYPES.has(type)) return type
  if (/対象外|スコープ外|out[-_ ]?of[-_ ]?scope|N\/A/i.test(summary)) return "out_of_scope"
  if (/一部|限界|完全.*できない/.test(summary)) return "partially_checked"
  if (/確認できない|存在しない|入力.*ない|含まれておらず|未確認/.test(summary)) return "not_checked"
  return "checked"
}

function normalizeEvidenceType(value: unknown): string | undefined {
  const type = stringValue(value)
  return type && EVIDENCE_TYPES.has(type) ? type : undefined
}

function inferEvidenceType(value: string): string | undefined {
  if (/^REQ-/.test(value)) return "requirement"
  if (/^BD-/.test(value)) return "basic_design"
  if (/^DD-/.test(value)) return "detailed_design"
  if (/^TC-/.test(value)) return "test_spec"
  if (/^LEDGER-/.test(value)) return "ledger"
  if (/^TICKET-/.test(value)) return "ticket"
  if (/^SRC-/.test(value)) return "code"
  return undefined
}

function normalizePrefixedId(
  value: unknown,
  prefix: string,
  index: number,
  alternatePrefix?: string | string[]
): string {
  const text = stringValue(value)
  for (const candidatePrefix of [prefix, ...toArray(alternatePrefix)]) {
    const current = text?.match(new RegExp(`^${candidatePrefix}-([0-9]+)$`))
    if (current) return `${prefix}-${current[1].padStart(3, "0")}`
  }
  return `${prefix}-${String(index + 1).padStart(3, "0")}`
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function compactSummary(value: string): string {
  const compacted = value.replace(/\s+/g, " ").trim()
  return compacted.length > 120 ? `${compacted.slice(0, 117)}...` : compacted
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (Array.isArray(value)) return value
  return value === undefined ? [] : [value]
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>
}
