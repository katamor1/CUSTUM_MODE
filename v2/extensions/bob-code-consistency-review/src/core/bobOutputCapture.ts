import * as path from "node:path"
import YAML from "yaml"
import { pathExists, readTextFile, writeTextFile } from "./fileSystem"

export type CaptureBobOutputResult = {
  status: "ok" | "error"
  bobOutputPath?: string
  reviewId?: string
  message: string
}

type EvidenceIndexItem = {
  evidence_id?: string
  type?: string
  ref?: string
  source?: string
  location?: string
}

type EvidenceLookup = {
  byId: Map<string, EvidenceIndexItem>
  byRef: Map<string, EvidenceIndexItem>
}

const EVIDENCE_TYPES = new Set(["requirement", "basic_design", "detailed_design", "test_spec", "ledger", "ticket", "code", "check_result"])
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
const QUESTION_CATEGORIES = new Set(["specification-clarification", "scope-clarification", "document-version", "missing-evidence", "test-policy", "owner-decision"])
const COVERAGE_TYPES = new Set(["checked", "partially_checked", "not_checked", "out_of_scope"])

export async function captureBobOutput(input: { workspaceRoot: string; text: string; bobOutputPath: string; packageDir?: string }): Promise<CaptureBobOutputResult> {
  const yamlText = extractYamlFromText(input.text)
  if (!yamlText) return { status: "error", message: "Bob 出力内に YAML オブジェクトが見つかりませんでした。" }

  let parsed: any
  try {
    parsed = YAML.parse(yamlText)
  } catch (error) {
    return { status: "error", message: `YAML が不正です: ${error instanceof Error ? error.message : String(error)}` }
  }
  const evidenceLookup = await loadEvidenceLookup(input.packageDir)
  const canonical = canonicalizeBobOutput(parsed, evidenceLookup)
  const normalized = `${YAML.stringify(canonical)}`
  await writeTextFile(input.bobOutputPath, normalized)
  return {
    status: "ok",
    bobOutputPath: path.resolve(input.bobOutputPath),
    reviewId: canonical?.review_summary?.review_id,
    message: `Bob 出力を保存しました: ${input.bobOutputPath}`
  }
}

export function extractYamlFromText(text: string): string | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  const fenced = trimmed.match(/```(?:yaml|yml|YAML)?\s*\r?\n([\s\S]*?)\r?\n```/)
  if (fenced) return fenced[1].trim()
  const start = trimmed.search(/^schema_version\s*:/m)
  return start >= 0 ? trimWorkflowStateTrailer(trimmed.slice(start)) : undefined
}

function trimWorkflowStateTrailer(text: string): string {
  const lines = text.split(/\r?\n/)
  const stop = lines.findIndex((line, index) => index > 0 && /^<\/(?:state|workflow_state)>/.test(line.trim()))
  return (stop >= 0 ? lines.slice(0, stop) : lines).join("\n").trim()
}

async function loadEvidenceLookup(packageDir: string | undefined): Promise<EvidenceLookup | undefined> {
  if (!packageDir) return undefined
  const evidencePath = path.join(packageDir, "evidence-index.json")
  if (!(await pathExists(evidencePath))) return undefined
  const parsed = JSON.parse(await readTextFile(evidencePath)) as { evidence?: EvidenceIndexItem[] }
  const byId = new Map<string, EvidenceIndexItem>()
  const byRef = new Map<string, EvidenceIndexItem>()
  for (const item of parsed.evidence ?? []) {
    if (item.evidence_id) byId.set(item.evidence_id, item)
    if (item.ref) byRef.set(item.ref, item)
  }
  return { byId, byRef }
}

function canonicalizeBobOutput(parsed: any, evidenceLookup: EvidenceLookup | undefined): any {
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
    scope_statement: stringValue(input.scope_statement) ?? stringValue(input.note) ?? stringValue(input.summary) ?? "入力された review-package の範囲で確認したプレレビュー結果。",
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
    suggested_action: stringValue(input.suggested_action) ?? stringValue(input.human_check) ?? "レビュー担当者が不足情報を確認する。"
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
    const reason = stringValue(input.reason) ?? stringValue(input.summary) ?? "finding として採用する十分な根拠がないため。"
    return pruneUndefined({
      id: normalizePrefixedId(input.id, "UNC", index, ["REJ", "REJECTED"]),
      summary: stringValue(input.summary) ?? compactSummary(reason),
      reason,
      next_action: stringValue(input.next_action) ?? stringValue(input.human_check) ?? "必要に応じて人間が根拠を確認する。"
    })
  })
}

function normalizeEvidenceArray(value: unknown, evidenceLookup: EvidenceLookup | undefined): any[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => normalizeEvidenceRef(item, evidenceLookup)).filter((item): item is Record<string, string> => Boolean(item))
}

function normalizeEvidenceRef(value: unknown, evidenceLookup: EvidenceLookup | undefined): Record<string, string> | undefined {
  if (typeof value === "string") return evidenceObjectFromToken(evidenceToken(value), evidenceLookup)
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  const evidenceId = stringValue(input.evidence_id)
  const ref = stringValue(input.ref)
  if (!evidenceId && !ref && !stringValue(input.type)) {
    const shorthand = evidenceShorthand(value)
    return shorthand ? evidenceObjectFromToken(evidenceToken(shorthand), evidenceLookup) : undefined
  }
  const indexed = (evidenceId ? evidenceLookup?.byId.get(evidenceId) : undefined) ?? (ref ? evidenceLookup?.byRef.get(ref) : undefined)
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

function evidenceObjectFromToken(value: string, evidenceLookup: EvidenceLookup | undefined): Record<string, string> | undefined {
  const indexed = evidenceObjectFromLookup(value, evidenceLookup)
  if (indexed) return indexed
  const type = inferEvidenceType(value)
  return type ? { evidence_id: value, type, ref: value } : undefined
}

function evidenceObjectFromLookup(value: string, evidenceLookup: EvidenceLookup | undefined): Record<string, string> | undefined {
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

function normalizePrefixedId(value: unknown, prefix: string, index: number, alternatePrefix?: string | string[]): string {
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
