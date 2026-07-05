import { saveReviewResultArtifacts } from "./resultCaptureArtifacts"
import { extractJsonFromText } from "./resultCaptureJson"
import { recoverReviewResultFromMarkdown } from "./resultCaptureMarkdownRecovery"
import type {
  CandidateText,
  CaptureReviewResultOptions,
  CaptureReviewResultResult
} from "./resultCaptureTypes"
import { validateJsonAgainstSchema } from "./schemaValidator"
import type { ReviewResult, ReviewStatus, ValidationIssue } from "./types"
import { validateReviewResultJson } from "./validator"

const STATUSES: ReviewStatus[] = ["pass", "fail", "unknown", "not_applicable", "blocked"]

export async function captureReviewResultText(
  workspaceRoot: string,
  text: string,
  source: string,
  options: CaptureReviewResultOptions = {}
): Promise<CaptureReviewResultResult> {
  return captureReviewResultFromCandidates(workspaceRoot, [{ source, text }], options)
}

export async function captureReviewResultFromCandidates(
  workspaceRoot: string,
  candidates: CandidateText[],
  options: CaptureReviewResultOptions = {}
): Promise<CaptureReviewResultResult> {
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

export async function handleReviewResultJson(
  workspaceRoot: string,
  jsonText: string,
  source: string,
  options: CaptureReviewResultOptions = {}
): Promise<CaptureReviewResultResult> {
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
  const projectContractIssues = validateProjectContract(result, options)
  const issues = [...completionIssues, ...projectContractIssues]
  if (issues.length > 0) {
    return {
      status: "error",
      source,
      valid: false,
      issueCount: issues.length,
      issues
    }
  }

  const artifacts = await saveReviewResultArtifacts(workspaceRoot, result, options)
  return {
    status: "ok",
    source,
    reviewId: result.review_id,
    jsonPath: artifacts.jsonPath,
    markdownPath: artifacts.markdownPath,
    metadataPath: artifacts.metadataPath,
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

function validateProjectContract(result: ReviewResult, options: CaptureReviewResultOptions): ValidationIssue[] {
  return [
    ...validateExpectedRuleIds(result, options.expectedRuleIds),
    ...validateReviewResultSchema(result, options.reviewResultSchema)
  ]
}

function validateExpectedRuleIds(result: ReviewResult, expectedRuleIds: string[] | undefined): ValidationIssue[] {
  const expected = normalizeRuleIds(expectedRuleIds)
  if (!expected) return []

  const issues: ValidationIssue[] = []
  const expectedSet = new Set(expected)
  const seen = new Map<string, number>()

  result.checklist_results.forEach((item, index) => {
    const previous = seen.get(item.rule_id)
    if (previous !== undefined) {
      issues.push({
        path: `$.checklist_results[${index}].rule_id`,
        message: `duplicate rule_id ${item.rule_id}; first seen at checklist_results[${previous}]`
      })
    } else {
      seen.set(item.rule_id, index)
    }
    if (!expectedSet.has(item.rule_id)) {
      issues.push({ path: `$.checklist_results[${index}].rule_id`, message: `unexpected rule_id ${item.rule_id}` })
    }
  })

  for (const ruleId of expected) {
    if (!seen.has(ruleId)) {
      issues.push({ path: "$.checklist_results", message: `missing expected rule_id ${ruleId}` })
    }
  }

  return issues
}

function validateReviewResultSchema(result: ReviewResult, schema: unknown): ValidationIssue[] {
  return schema === undefined ? [] : validateJsonAgainstSchema(result, schema)
}

function normalizeRuleIds(ruleIds: string[] | undefined): string[] | undefined {
  if (!Array.isArray(ruleIds)) return undefined
  const normalized = ruleIds.map((ruleId) => typeof ruleId === "string" ? ruleId.trim() : "").filter(Boolean)
  return normalized.length > 0 ? normalized : undefined
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
