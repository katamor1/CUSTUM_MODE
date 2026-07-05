import * as path from "node:path"
import { REVIEW_RECORDS_ROOT } from "./reviewRecordTypes"

export function recordDirectory(workspaceRoot: string, campaignId: string, reviewId: string): string {
  return path.join(campaignDirectory(workspaceRoot, campaignId), "records", safePathSegment(reviewId, "review_id"))
}

export function campaignDirectory(workspaceRoot: string, campaignId: string): string {
  return path.join(workspaceRoot, REVIEW_RECORDS_ROOT, "campaigns", safePathSegment(campaignId, "campaign_id"))
}

export function recordYamlPath(workspaceRoot: string, campaignId: string, reviewId: string): string {
  return path.join(recordDirectory(workspaceRoot, campaignId, reviewId), "record.yaml")
}

export function triageYamlPath(workspaceRoot: string, campaignId: string, reviewId: string): string {
  return path.join(recordDirectory(workspaceRoot, campaignId, reviewId), "triage.yaml")
}

export function summaryJsonPath(workspaceRoot: string, campaignId: string): string {
  return path.join(campaignDirectory(workspaceRoot, campaignId), "summary.json")
}

export function summaryMarkdownPath(workspaceRoot: string, campaignId: string): string {
  return path.join(campaignDirectory(workspaceRoot, campaignId), "summary.md")
}

export function resolveWorkspaceRelativePath(workspaceRoot: string, relativePath: string): string {
  const normalized = normalizeWorkspaceRelativePath(relativePath)
  const resolved = path.resolve(workspaceRoot, normalized)
  const root = path.resolve(workspaceRoot)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`workspace-relative path escapes workspace: ${relativePath}`)
  }
  return resolved
}

export function validateWorkspaceRelativePath(relativePath: unknown, fieldName: string): string[] {
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    return [`${fieldName} is required`]
  }
  try {
    normalizeWorkspaceRelativePath(relativePath)
    return []
  } catch (error: any) {
    return [`${fieldName} must be a workspace-relative path: ${error?.message ?? String(error)}`]
  }
}

export function normalizeWorkspaceRelativePath(relativePath: string): string {
  const value = relativePath.trim()
  if (!value) throw new Error("empty path")
  if (path.isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("/")) {
    throw new Error("absolute paths are not allowed")
  }
  const normalized = path.posix.normalize(value.replace(/\\/g, "/"))
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("path must not use .. to escape")
  }
  return normalized
}

function safePathSegment(value: string, fieldName: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${fieldName} is required`)
  if (/[\\/]/.test(trimmed) || trimmed === "." || trimmed === "..") {
    throw new Error(`${fieldName} must not contain path separators`)
  }
  return trimmed
}
