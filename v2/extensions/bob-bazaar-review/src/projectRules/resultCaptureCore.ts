import * as fs from "node:fs/promises"
import * as path from "node:path"
import { loadProjectChecklist } from "./io"
import { renderReviewResultMarkdown } from "./markdown"
import { ProjectChecklist, ProjectRule, ReviewResult, ReviewStatus, ValidationIssue } from "./types"
import { validateReviewResultJson } from "./validator"

const STATUSES: ReviewStatus[] = ["pass", "fail", "unknown", "not_applicable", "blocked"]

export interface CaptureReviewResultResult {
  status: "ok" | "error"
  source: string
  reviewId?: string
  jsonPath?: string
  markdownPath?: string
  jsonText?: string
  valid: boolean
  issueCount: number
  issues?: ValidationIssue[]
  summary?: ReviewResult["summary"]
}

export interface CandidateText {
  source: string
  text: string
}

export interface CaptureReviewResultOptions {
  expectedChecklistItems?: number
  workspaceRoot?: string
  workflowState?: Record<string, string>
}

export async function captureReviewResultText(workspaceRoot: string, text: string, source: string, options: CaptureReviewResultOptions = {}): Promise<CaptureReviewResultResult> {
  return captureReviewResultFromCandidates(workspaceRoot, [{ source, text }], options)
}

export async function captureReviewResultFromCandidates(workspaceRoot: string, candidates: CandidateText[], options: CaptureReviewResultOptions = {}): Promise<CaptureReviewResultResult> {
  for (const candidate of candidates) {
    const jsonText = extractJsonFromText(candidate.text)
    if (!jsonText) continue
    return handleReviewResultJson(workspaceRoot, jsonText, candidate.source, options)
  }

  const recovered = await recoverReviewResultFromMarkdown(workspaceRoot, candidates, options)
  if (recovered) return handleReviewResultJson(workspaceRoot, recovered.jsonText, recovered.source, options)

  return {
    status: "error",
    source: "none",
    valid: false,
    issueCount: 1,
    issues: [{ path: "$", message: "No review-result JSON was found." }]
  }
}

async function recoverReviewResultFromMarkdown(workspaceRoot: string, candidates: CandidateText[], options: CaptureReviewResultOptions): Promise<{ source: string; jsonText: string } | undefined> {
  const state = options.workflowState
  if (!state) return undefined
  const reviewContext = parseStateObject(state.reviewContext)
  const reviewRules = parseStateObject(state.reviewRules)
  const checklistPath = stringValue(reviewRules?.checklistPath)
  const checklist = await loadProjectChecklist(workspaceRoot, checklistPath)
  if (checklist.rules.length === 0) return undefined

  for (const candidate of candidates) {
    const decisions = parseMarkdownChecklistDecisions(candidate.text, checklist)
    if (decisions.size === 0) continue
    const result = buildRecoveredReviewResult(checklist.rules, decisions, reviewContext)
    return { source: `${candidate.source} markdown recovery`, jsonText: JSON.stringify(result, null, 2) }
  }
  return undefined
}

interface MarkdownChecklistDecision {
  status: ReviewStatus
  reason: string
}

function parseMarkdownChecklistDecisions(text: string, checklist: ProjectChecklist): Map<string, MarkdownChecklistDecision> {
  const decisions = new Map<string, MarkdownChecklistDecision>()
  const rulesById = new Map(checklist.rules.map((rule) => [rule.id, rule]))
  parseMarkdownTableDecisions(text, rulesById, decisions)
  parseMarkdownHeadingDecisions(text, rulesById, decisions)
  return decisions
}

function parseMarkdownTableDecisions(text: string, rulesById: Map<string, ProjectRule>, decisions: Map<string, MarkdownChecklistDecision>): void {
  for (const line of text.split(/\r?\n/)) {
    const cells = splitMarkdownTableRow(line)
    if (cells.length < 2 || cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))) continue
    const rule = ruleFromText(cells.join(" "), rulesById)
    if (!rule) continue
    const status = parseReviewStatus(cells[cells.length - 1])
    if (!status) continue
    const reason = stripMarkdown(cells.length >= 4 ? cells[cells.length - 2] : cells.join(" / "))
    decisions.set(rule.id, { status, reason: reason || `${rule.id} was parsed from Markdown output as ${status}.` })
  }
}

function parseMarkdownHeadingDecisions(text: string, rulesById: Map<string, ProjectRule>, decisions: Map<string, MarkdownChecklistDecision>): void {
  let currentRule: ProjectRule | undefined
  let reasonLines: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const headingRule = /^#{2,6}\s+/.test(line) ? ruleFromText(line, rulesById) : undefined
    if (headingRule) {
      currentRule = headingRule
      reasonLines = []
      continue
    }
    if (!currentRule) continue
    if (/^#{2,6}\s+/.test(line)) {
      currentRule = undefined
      reasonLines = []
      continue
    }
    const status = parseStatusLine(line)
    if (status) {
      const reason = [...reasonLines, stripMarkdown(line)].filter(Boolean).join(" ")
      decisions.set(currentRule.id, { status, reason: reason || `${currentRule.id} was parsed from Markdown output as ${status}.` })
      continue
    }
    const reason = stripMarkdown(line.replace(/^\s*[-*]\s*/, ""))
    if (reason) reasonLines.push(reason)
  }
}

function ruleFromText(text: string, rulesById: Map<string, ProjectRule>): ProjectRule | undefined {
  const plain = stripMarkdown(text)
  return Array.from(rulesById.values()).find((candidate) => plain.includes(candidate.id))
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return []
  return trimmed.slice(1, -1).split("|").map((cell) => cell.trim())
}

function parseReviewStatus(value: string): ReviewStatus | undefined {
  const plain = stripMarkdown(value).toLowerCase()
  const compact = plain.replace(/[^a-z0-9_\u3040-\u30ff\u3400-\u9fff]+/g, "")
  if (compact.includes("not_applicable") || compact.includes("notapplicable") || /\bn\/?a\b/.test(plain) || compact.includes("対象外") || compact.includes("該当なし") || compact.includes("非適用")) return "not_applicable"
  if (compact.includes("blocked") || compact.includes("ブロック")) return "blocked"
  if (compact.includes("unknown") || compact.includes("不明") || compact.includes("未確認")) return "unknown"
  if (compact.includes("fail") || compact.includes("ng") || compact.includes("問題あり") || compact.includes("不合格")) return "fail"
  if (compact.includes("pass") || compact.includes("ok") || compact.includes("問題なし") || compact.includes("合格")) return "pass"
  return undefined
}

function parseStatusLine(line: string): ReviewStatus | undefined {
  const plain = stripMarkdown(line)
  if (!/(^|\s)(status|ステータス|判定)\s*[:：]/i.test(plain)) return undefined
  return parseReviewStatus(plain)
}

function buildRecoveredReviewResult(rules: ProjectRule[], decisions: Map<string, MarkdownChecklistDecision>, reviewContext: Record<string, unknown> | undefined): ReviewResult {
  const summary = emptySummary()
  const findings: ReviewResult["findings"] = []
  const checklistResults = rules.map((rule) => {
    const decision = decisions.get(rule.id)
    const status = decision?.status ?? "unknown"
    summary[status] += 1
    const severity = status === "fail" ? rule.severity_on_fail : "info"
    const reason = decision?.reason ?? "Markdown output did not include a parseable checklist decision for this rule."
    const evidence = status === "pass" || status === "fail" ? [{ summary: reason }] : []
    if (status === "fail") {
      findings.push({
        id: `${rule.id}-001`,
        rule_id: rule.id,
        severity,
        title: rule.title,
        description: reason,
        suggested_fix: "該当ルールの指摘内容を確認し、必要な修正または追加調査を行ってください。"
      })
    }
    return {
      rule_id: rule.id,
      title: rule.title,
      status,
      severity,
      confidence: "medium" as const,
      evidence,
      reason
    }
  })
  return {
    review_id: buildRecoveredReviewId(reviewContext),
    vcs: buildRecoveredVcs(reviewContext),
    checklist_results: checklistResults,
    findings,
    summary
  }
}

function buildRecoveredVcs(reviewContext: Record<string, unknown> | undefined): ReviewResult["vcs"] {
  const baseRevision = stringValue(reviewContext?.baseRevision) ?? stringValue(reviewContext?.base_revision)
  const targetRevision = stringValue(reviewContext?.targetRevision) ?? stringValue(reviewContext?.target_revision)
  const revision = stringValue(reviewContext?.revision) ?? (baseRevision ? undefined : targetRevision)
  const vcs: ReviewResult["vcs"] = {
    type: "bazaar",
    repository: stringValue(reviewContext?.workspacePath) ?? stringValue(reviewContext?.repository) ?? stringValue(reviewContext?.repositoryRoot),
    revision_mode: stringValue(reviewContext?.mode) ?? stringValue(reviewContext?.revisionMode)
  }
  if (revision) vcs.revision = revision
  if (baseRevision) vcs.base_revision = baseRevision
  if (targetRevision) vcs.target_revision = targetRevision
  return vcs
}

function buildRecoveredReviewId(reviewContext: Record<string, unknown> | undefined): string {
  const vcs = buildRecoveredVcs(reviewContext)
  const revision = [vcs.base_revision, vcs.target_revision].filter(Boolean).join("-") || vcs.revision || "unknown"
  return `bazaar-r${sanitizeReviewIdSegment(revision)}-project-rule-review`
}

function sanitizeReviewIdSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "") || "unknown"
}

function emptySummary(): Record<ReviewStatus, number> {
  return {
    pass: 0,
    fail: 0,
    unknown: 0,
    not_applicable: 0,
    blocked: 0
  }
}

function parseStateObject(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function stripMarkdown(value: string): string {
  return value
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim()
}

export async function handleReviewResultJson(workspaceRoot: string, jsonText: string, source: string, options: CaptureReviewResultOptions = {}): Promise<CaptureReviewResultResult> {
  const normalizedJsonText = normalizeReviewResultJsonText(jsonText)
  const validation = validateReviewResultJson(normalizedJsonText)
  if (!validation.valid) {
    return {
      status: "error",
      source,
      valid: false,
      issueCount: validation.issues.length,
      issues: validation.issues
    }
  }

  const result = JSON.parse(normalizedJsonText) as ReviewResult
  const completionIssues = validateChecklistCompletion(result, options)
  if (completionIssues.length > 0) {
    return {
      status: "error",
      source,
      valid: false,
      issueCount: completionIssues.length,
      issues: completionIssues
    }
  }

  const artifacts = await saveReviewResultArtifacts(workspaceRoot, result)
  return {
    status: "ok",
    source,
    reviewId: result.review_id,
    jsonPath: artifacts.jsonPath,
    markdownPath: artifacts.markdownPath,
    jsonText: `${JSON.stringify(result, null, 2)}\n`,
    valid: true,
    issueCount: 0,
    summary: result.summary
  }
}

function normalizeReviewResultJsonText(jsonText: string): string {
  let value: unknown
  try {
    value = JSON.parse(jsonText)
  } catch {
    return jsonText
  }
  if (!isRecord(value) || !Array.isArray(value.checklist_results)) return jsonText
  let changed = false
  for (const item of value.checklist_results) {
    if (!isRecord(item)) continue
    const normalized = normalizeChecklistSeverity(item.severity)
    if (normalized && normalized !== item.severity) {
      item.severity = normalized
      changed = true
    }
  }
  if (isRecord(value.summary)) {
    const normalizedSummary = countChecklistStatuses(value.checklist_results)
    if (!sameSummary(value.summary, normalizedSummary)) {
      value.summary = normalizedSummary
      changed = true
    }
  }
  return changed ? JSON.stringify(value, null, 2) : jsonText
}

function normalizeChecklistSeverity(value: unknown): "info" | undefined {
  if (value === "error" || value === "warning" || value === "info") return undefined
  if (typeof value !== "string") return undefined
  const compact = value.trim().toLowerCase().replace(/[^a-z]+/g, "")
  return ["na", "notapplicable", "none", "null", "undefined"].includes(compact) ? "info" : undefined
}

function validateChecklistCompletion(result: ReviewResult, options: CaptureReviewResultOptions): ValidationIssue[] {
  const expected = options.expectedChecklistItems
  if (!Number.isInteger(expected) || expected === undefined || expected < 0) return []
  const actual = result.checklist_results.length
  return actual === expected
    ? []
    : [{ path: "$.checklist_results", message: `expected ${expected} checklist result(s), got ${actual}` }]
}

function countChecklistStatuses(items: unknown[]): Record<ReviewStatus, number> {
  const counts: Record<ReviewStatus, number> = {
    pass: 0,
    fail: 0,
    unknown: 0,
    not_applicable: 0,
    blocked: 0
  }
  for (const item of items) {
    if (!isRecord(item)) continue
    if (isReviewStatus(item.status)) counts[item.status] += 1
  }
  return counts
}

function sameSummary(summary: Record<string, unknown>, normalized: Record<ReviewStatus, number>): boolean {
  return STATUSES.every((status) => summary[status] === normalized[status])
}

function isReviewStatus(value: unknown): value is ReviewStatus {
  return typeof value === "string" && STATUSES.includes(value as ReviewStatus)
}

export async function saveReviewResultArtifacts(workspaceRoot: string, result: ReviewResult): Promise<{ jsonPath: string; markdownPath: string }> {
  const resultsDir = path.join(workspaceRoot, ".bob", "review", "results")
  await fs.mkdir(resultsDir, { recursive: true })

  const baseName = sanitizeFilename(result.review_id || buildFallbackReviewId(result))
  const jsonPath = path.join(resultsDir, `${baseName}.json`)
  const markdownPath = path.join(resultsDir, `${baseName}.md`)
  await fs.writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8")
  await fs.writeFile(markdownPath, `${renderReviewResultMarkdown(result)}\n`, "utf8")
  return { jsonPath, markdownPath }
}

export function extractJsonFromText(text: string): string | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  if (isValidJsonObject(trimmed)) return trimmed

  const fenced = extractFencedJson(trimmed)
  if (fenced) return fenced

  const objectCandidate = extractBalancedJsonObject(trimmed)
  return objectCandidate && isValidJsonObject(objectCandidate) ? objectCandidate : undefined
}

function extractFencedJson(text: string): string | undefined {
  const fencePattern = /```(?:json|JSON)?\s*\r?\n([\s\S]*?)\r?\n```/g
  for (let match = fencePattern.exec(text); match; match = fencePattern.exec(text)) {
    const candidate = match[1].trim()
    if (isValidJsonObject(candidate)) return candidate
  }
  return undefined
}

function extractBalancedJsonObject(text: string): string | undefined {
  const start = text.indexOf("{")
  if (start < 0) return undefined

  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === "{") {
      depth += 1
    } else if (char === "}") {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1).trim()
    }
  }
  return undefined
}

function isValidJsonObject(text: string): boolean {
  try {
    const parsed = JSON.parse(text)
    return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed))
  } catch {
    return false
  }
}

function sanitizeFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "") || "review-result"
}

function buildFallbackReviewId(result: ReviewResult): string {
  const revision = result.vcs.revision || result.vcs.target_revision || result.vcs.base_revision || "unknown"
  return `bazaar-${revision}-project-rule-review`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
