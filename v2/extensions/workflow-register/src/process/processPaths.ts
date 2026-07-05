import * as path from "path"
import * as fs from "fs/promises"

const WINDOWS_DRIVE_PREFIX = /^[A-Za-z]:[\\/]/
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function isSafeWorkspaceRelativePath(value: string): boolean {
  return validateWorkspaceRelativePath(value).ok
}

export function validateWorkspaceRelativePath(value: unknown): { ok: true; path: string } | { ok: false; reason: string } {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, reason: "path must be a non-empty string" }
  }
  if (value.includes("\0")) {
    return { ok: false, reason: "path must not contain NUL bytes" }
  }
  const normalizedSlashes = value.replace(/\\/g, "/")
  if (
    normalizedSlashes.startsWith("/") ||
    normalizedSlashes.startsWith("//") ||
    WINDOWS_DRIVE_PREFIX.test(value) ||
    path.win32.isAbsolute(value) ||
    path.posix.isAbsolute(normalizedSlashes)
  ) {
    return { ok: false, reason: "path must be relative to the workspace" }
  }
  const segments = normalizedSlashes.split("/")
  if (normalizedSlashes === ".") {
    return { ok: true, path: "." }
  }
  if (segments.some((segment) => segment === "..")) {
    return { ok: false, reason: "path must not contain .. segments" }
  }
  if (segments.some((segment) => segment.trim().length === 0 || segment === ".")) {
    return { ok: false, reason: "path must not contain empty or . segments" }
  }
  const normalized = path.posix.normalize(normalizedSlashes)
  if (normalized === "." || normalized.startsWith("../") || normalized === "..") {
    return { ok: false, reason: "path must resolve inside the workspace" }
  }
  return { ok: true, path: normalized }
}

export function describeUnsafeWorkspacePath(label: string, value: unknown): string | undefined {
  const result = validateWorkspaceRelativePath(value)
  if (result.ok) return undefined
  return `${label}: unsafe workspace path (${result.reason})`
}

export function validateSafePathSegment(value: unknown, label: string): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return `${label} must be a non-empty string`
  }
  if (!SAFE_PATH_SEGMENT.test(value) || value.includes("..") || value.includes("/") || value.includes("\\")) {
    return `${label} must be a safe path segment`
  }
  return undefined
}

export function toWorkspaceRelativePath(value: string): string {
  const result = validateWorkspaceRelativePath(value)
  if (!result.ok) {
    throw new Error(`unsafe workspace path: ${value}`)
  }
  return result.path
}

export function workspacePath(workspaceRoot: string, relativePath: string): string {
  return path.resolve(workspaceRoot, toWorkspaceRelativePath(relativePath))
}

export async function validateExistingWorkspacePath(
  workspaceRoot: string,
  relativePath: unknown,
  label: string
): Promise<string[]> {
  const diagnostics: string[] = []
  const pathResult = validateWorkspaceRelativePath(relativePath)
  if (!pathResult.ok) {
    diagnostics.push(`${label}: unsafe workspace path (${pathResult.reason})`)
    return diagnostics
  }
  const absolutePath = path.resolve(workspaceRoot, pathResult.path)
  try {
    const [workspaceRealPath, targetRealPath] = await Promise.all([
      fs.realpath(workspaceRoot),
      fs.realpath(absolutePath)
    ])
    if (!isPathInside(workspaceRealPath, targetRealPath)) {
      diagnostics.push(`${label}: symlink escape outside workspace (${pathResult.path})`)
    }
  } catch (error) {
    diagnostics.push(`${label}: path does not exist or cannot be read (${pathResult.path})`)
  }
  return diagnostics
}

export function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}
