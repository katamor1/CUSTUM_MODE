import * as fsSync from "node:fs"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { decodeTextBuffer } from "./textEncoding"

export type WorkspacePathKind =
  | "review-package-output"
  | "bob-output"
  | "human-triage-output"
  | "traceability-catalog"
  | "traceability-gate-report"
  | "traceability-ai-draft-output"
  | "repository-symbol-index-output"
  | "repository-symbol-index-cache"
  | "artifact-ledger"

type WorkspacePathPolicy = {
  label: string
  description: string
  allow: (segments: string[], relativePath: string) => boolean
}

const WORKSPACE_PATH_POLICIES: Record<WorkspacePathKind, WorkspacePathPolicy> = {
  "review-package-output": {
    label: "reviewPackagePath",
    description: ".bob-review/<review-package-directory> or .custom/<path>",
    allow: (segments) => (
      segmentEquals(segments[0], ".bob-review") &&
      segments.length >= 2 &&
      !["bob-output", "human-triage"].some((reserved) => segmentEquals(segments[1], reserved))
    ) || customPath(segments)
  },
  "bob-output": {
    label: "bobOutputPath",
    description: ".bob-review/bob-output/*.yaml or .custom/*.yaml",
    allow: (segments) => (
      startsWithSegments(segments, [".bob-review", "bob-output"]) && segments.length >= 3 ||
      customPath(segments)
    ) && /\.ya?ml$/i.test(segments[segments.length - 1])
  },
  "human-triage-output": {
    label: "triagePath",
    description: ".bob-review/human-triage/ or .custom/<path>",
    allow: (segments) => startsWithSegments(segments, [".bob-review", "human-triage"]) || customPath(segments)
  },
  "traceability-catalog": {
    label: "traceabilityCatalogPath",
    description: ".bob-trace/*.json outside ai-traceability-draft or .custom/*.json",
    allow: (segments) => segmentEquals(segments[0], ".bob-trace") &&
      !segmentEquals(segments[1], "ai-traceability-draft") &&
      /\.json$/i.test(segments[segments.length - 1]) ||
      customPath(segments) && /\.json$/i.test(segments[segments.length - 1])
  },
  "traceability-gate-report": {
    label: "traceabilityGateReportPath",
    description: ".bob-trace/*.md outside ai-traceability-draft or .custom/*.md",
    allow: (segments) => segmentEquals(segments[0], ".bob-trace") &&
      !segmentEquals(segments[1], "ai-traceability-draft") &&
      /\.md$/i.test(segments[segments.length - 1]) ||
      customPath(segments) && /\.md$/i.test(segments[segments.length - 1])
  },
  "traceability-ai-draft-output": {
    label: "aiTraceabilityDraftPromptPath",
    description: ".bob-trace/ai-traceability-draft/",
    allow: (segments) => startsWithSegments(segments, [".bob-trace", "ai-traceability-draft"])
  },
  "repository-symbol-index-output": {
    label: "repositorySymbolIndexPath",
    description: ".bob/evidence-scope/*.json or .custom/*.json",
    allow: (segments) => (
      startsWithSegments(segments, [".bob", "evidence-scope"]) && segments.length >= 3 ||
      customPath(segments)
    ) && /\.json$/i.test(segments[segments.length - 1])
  },
  "repository-symbol-index-cache": {
    label: "repositorySymbolIndexCachePath",
    description: ".bob/evidence-scope/*.cache.json or .custom/*.cache.json",
    allow: (segments) => (
      startsWithSegments(segments, [".bob", "evidence-scope"]) && segments.length >= 3 ||
      customPath(segments)
    ) && /\.cache\.json$/i.test(segments[segments.length - 1])
  },
  "artifact-ledger": {
    label: "artifactLedgerPath",
    description: ".bob-review/artifact-ledger.json",
    allow: (segments) => startsWithSegments(segments, [".bob-review", "artifact-ledger.json"]) && segments.length === 2
  }
}

export async function readTextFile(filePath: string, encoding = "auto"): Promise<string> {
  return decodeTextBuffer(await fs.readFile(filePath), encoding)
}

export async function writeTextFile(filePath: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, text, "utf8")
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeTextFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export function resolveWorkspacePath(workspaceRoot: string, value: string): string {
  return path.isAbsolute(value) ? value : path.join(workspaceRoot, value)
}

export function resolveWorkspacePathStrict(workspaceRoot: string, value: string, label = "path"): string {
  const root = path.resolve(workspaceRoot)
  const resolved = path.resolve(path.isAbsolute(value) ? value : path.join(root, value))
  // 絶対パスも入力として許すが、最終的な解決先は workspaceRoot 配下に限定する。
  if (!isInsidePath(root, resolved)) throw new Error(`${label} escapes workspace: ${value}`)
  assertRealPathInsideWorkspace(root, resolved, label, value)
  return resolved
}

export function normalizeChangedFilePathStrict(value: string, label = "changed file path"): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is empty`)
  if (/[\0-\x1F\x7F]/u.test(value)) throw new Error(`${label} contains control characters: ${value}`)
  if (value.trim() !== value) throw new Error(`${label} contains outer whitespace: ${value}`)
  const normalizedSlashes = value.replace(/\\/g, "/")
  if (
    normalizedSlashes.startsWith("/") ||
    normalizedSlashes.startsWith("//") ||
    /^[A-Za-z]:/.test(value) ||
    path.win32.isAbsolute(value) ||
    path.posix.isAbsolute(normalizedSlashes)
  ) {
    throw new Error(`${label} must be workspace-relative: ${value}`)
  }
  const segments = normalizedSlashes.split("/")
  if (segments.some((segment) => segment === "..")) throw new Error(`${label} escapes workspace: ${value}`)
  if (segments.some((segment) => segment.trim().length === 0 || segment === ".")) {
    throw new Error(`${label} contains empty or . segments: ${value}`)
  }
  const normalized = path.posix.normalize(normalizedSlashes)
  if (normalized === "." || normalized.startsWith("../") || normalized === "..") {
    throw new Error(`${label} escapes workspace: ${value}`)
  }
  return normalized
}

export function resolveWorkspacePathForKind(workspaceRoot: string, value: string, kind: WorkspacePathKind): string {
  const policy = WORKSPACE_PATH_POLICIES[kind]
  const root = path.resolve(workspaceRoot)
  if (!value.trim()) throw new Error(`${policy.label} is empty`)
  if (/[\0-\x1F\x7F]/u.test(value)) throw new Error(`${policy.label} contains control characters: ${value}`)
  if (value.trim() !== value) throw new Error(`${policy.label} contains outer whitespace: ${value}`)

  const normalizedSlashes = toPosixPath(value)
  if (
    path.win32.isAbsolute(value) ||
    path.posix.isAbsolute(normalizedSlashes) ||
    /^[A-Za-z]:/.test(value)
  ) {
    throw new Error(`${policy.label} must be a workspace-relative path; absolute paths are not allowed: ${value}`)
  }

  const segments = normalizedSlashes.split("/")
  if (segments.some((segment) => segment === "..")) throw new Error(`${policy.label} escapes workspace: ${value}`)
  if (segments.some((segment) => segment.length === 0 || segment === ".")) {
    throw new Error(`${policy.label} contains empty or . segments: ${value}`)
  }
  if (segments.some((segment) => segment.trim() !== segment)) {
    throw new Error(`${policy.label} contains segment whitespace: ${value}`)
  }

  const resolved = path.resolve(root, ...segments)
  if (!isInsidePath(root, resolved)) throw new Error(`${policy.label} escapes workspace: ${value}`)
  const relativePath = toPosixPath(path.relative(root, resolved))
  if (!policy.allow(segments, relativePath)) throw new Error(`${policy.label} must be under ${policy.description}: ${value}`)
  assertRealPathInsideWorkspace(root, resolved, policy.label, value)
  return resolved
}

export function isInsidePath(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

export function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/")
}

export function relativePosix(from: string, to: string): string {
  return toPosixPath(path.relative(from, to)) || "."
}

function startsWithSegments(segments: string[], prefix: string[]): boolean {
  return prefix.every((segment, index) => segmentEquals(segments[index], segment))
}

function segmentEquals(left: string | undefined, right: string): boolean {
  return typeof left === "string" && left.toLowerCase() === right.toLowerCase()
}

function customPath(segments: string[]): boolean {
  return segmentEquals(segments[0], ".custom") && segments.length >= 2
}

function assertRealPathInsideWorkspace(root: string, target: string, label: string, originalValue: string): void {
  const rootRealPath = realpathIfPossible(root) ?? root
  const targetRealBase = realpathIfPossible(target) ?? realpathNearestExistingAncestor(target)
  if (targetRealBase && !isInsidePath(rootRealPath, targetRealBase)) {
    throw new Error(`${label} resolves outside workspace: ${originalValue}`)
  }
}

function realpathNearestExistingAncestor(filePath: string): string | undefined {
  let current = filePath
  while (true) {
    const real = realpathIfPossible(current)
    if (real) return real
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function realpathIfPossible(filePath: string): string | undefined {
  try {
    return fsSync.realpathSync.native(filePath)
  } catch {
    try {
      return fsSync.realpathSync(filePath)
    } catch {
      return undefined
    }
  }
}
