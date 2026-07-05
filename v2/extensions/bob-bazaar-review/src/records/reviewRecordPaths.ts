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

/**
 * review record 内の workspace-relative path を実ファイル path へ解決する。
 *
 * workspaceRoot は record campaign の信頼境界であり、相対 path が workspace 外へ
 * 逃げる場合は生成物や evidence として扱わず拒否する。
 */
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

/**
 * record YAML に保存する path 表記を workspace 相対の POSIX 形式へ揃える。
 *
 * 絶対パスと `..` は review artifact の再現性と workspace containment を壊すため、
 * 文字列補正ではなく validation error として扱う。
 */
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
  const reservedDeviceName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
  if (
    /[<>:"/\\|?*\x00-\x1f]/.test(trimmed) ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.endsWith(".") ||
    trimmed.endsWith(" ") ||
    reservedDeviceName.test(trimmed)
  ) {
    throw new Error(`${fieldName} must be a safe path segment`)
  }
  return trimmed
}
