import * as fs from "node:fs/promises"
import * as path from "node:path"
import { renderReviewResultMarkdown } from "./markdown"
import { ReviewResult, ValidationIssue } from "./types"
import { validateReviewResultJson } from "./validator"

export interface CaptureReviewResultResult {
  status: "ok" | "error"
  source: string
  reviewId?: string
  jsonPath?: string
  markdownPath?: string
  valid: boolean
  issueCount: number
  issues?: ValidationIssue[]
  summary?: ReviewResult["summary"]
}

export interface CandidateText {
  source: string
  text: string
}

export async function captureReviewResultText(workspaceRoot: string, text: string, source: string): Promise<CaptureReviewResultResult> {
  return captureReviewResultFromCandidates(workspaceRoot, [{ source, text }])
}

export async function captureReviewResultFromCandidates(workspaceRoot: string, candidates: CandidateText[]): Promise<CaptureReviewResultResult> {
  for (const candidate of candidates) {
    const jsonText = extractJsonFromText(candidate.text)
    if (!jsonText) continue
    return handleReviewResultJson(workspaceRoot, jsonText, candidate.source)
  }

  return {
    status: "error",
    source: "none",
    valid: false,
    issueCount: 1,
    issues: [{ path: "$", message: "No review-result JSON was found." }]
  }
}

export async function handleReviewResultJson(workspaceRoot: string, jsonText: string, source: string): Promise<CaptureReviewResultResult> {
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
  const artifacts = await saveReviewResultArtifacts(workspaceRoot, result)
  return {
    status: "ok",
    source,
    reviewId: result.review_id,
    jsonPath: artifacts.jsonPath,
    markdownPath: artifacts.markdownPath,
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
  return changed ? JSON.stringify(value, null, 2) : jsonText
}

function normalizeChecklistSeverity(value: unknown): "info" | undefined {
  if (value === "error" || value === "warning" || value === "info") return undefined
  if (typeof value !== "string") return undefined
  const compact = value.trim().toLowerCase().replace(/[^a-z]+/g, "")
  return ["na", "notapplicable", "none", "null", "undefined"].includes(compact) ? "info" : undefined
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
    const value = JSON.parse(text)
    return typeof value === "object" && value !== null && !Array.isArray(value)
  } catch {
    return false
  }
}

function buildFallbackReviewId(result: ReviewResult): string {
  const revision = result.vcs.revision ?? result.vcs.target_revision ?? "unknown"
  return `bazaar-${revision}-${timestampForFilename(new Date())}`
}

function timestampForFilename(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function sanitizeFilename(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || `review-result-${timestampForFilename(new Date())}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
