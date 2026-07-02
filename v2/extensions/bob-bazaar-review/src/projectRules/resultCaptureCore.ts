import * as fs from "node:fs/promises"
import * as path from "node:path"
import { renderReviewResultMarkdown } from "./markdown"
import { recoverReviewResultFromMarkdown } from "./resultCaptureMarkdownRecovery"
import { ReviewResult, ReviewStatus, ValidationIssue } from "./types"
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
