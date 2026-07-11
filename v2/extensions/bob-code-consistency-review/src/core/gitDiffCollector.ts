import {
  normalizeChangedFilePathStrict,
  readTextFile,
  resolveWorkspacePathStrict
} from "./fileSystem"
import { parseDiffFixtureText } from "./diffFixture"
import { classifyLanguageFromPath } from "./languageClassifier"
import { decodeTextBuffer } from "./textEncoding"
import {
  maxVcsProcessBufferBytes,
  normalizeReviewProcessingLimits,
  truncateUtf8Text,
  type ReviewProcessingLimits
} from "./limits"
import { ExternalProcessError, runExternalProcess } from "./externalProcessRunner"
import type { DiffSummary } from "./diffTypes"
import type { ReviewInput } from "./reviewTypes"

type VcsKind = "git" | "bazaar"
const MAX_BAZAAR_REVISION_SPEC_LENGTH = 128
const MIN_VCS_COMMAND_TIMEOUT_MS = 1_000
const DEFAULT_VCS_COMMAND_TIMEOUT_MS = 120_000
const MAX_VCS_COMMAND_TIMEOUT_MS = 600_000

export async function collectGitDiff(reviewInput: ReviewInput, options: {
  workspaceRoot: string
  diffFixturePath?: string
  bzrPath?: string
  textEncoding?: string
  limits?: Partial<ReviewProcessingLimits>
  commandTimeoutMs?: number
  signal?: AbortSignal
}): Promise<DiffSummary> {
  const limits = normalizeReviewProcessingLimits(options.limits)
  if (options.diffFixturePath) {
    const fixturePath = resolveWorkspacePathStrict(options.workspaceRoot, options.diffFixturePath, "diffFixturePath")
    const fixture = parseDiffFixtureText(await readTextFile(fixturePath, options.textEncoding))
    return applyDiffLimits(fixture, limits)
  }

  const vcs = normalizeVcs(reviewInput.review.vcs)
  const vcsRoot = resolveVcsRoot(options.workspaceRoot, reviewInput.review.vcs_root)
  const diff = vcs === "bazaar"
    ? await collectBazaarDiff(reviewInput, { ...options, vcsRoot, limits })
    : await collectStandardGitDiff(reviewInput, { ...options, vcsRoot, limits })
  return applyDiffLimits(diff, limits)
}

async function collectStandardGitDiff(reviewInput: ReviewInput, options: {
  workspaceRoot: string
  vcsRoot: string
  textEncoding?: string
  limits: ReviewProcessingLimits
  commandTimeoutMs?: number
  signal?: AbortSignal
}): Promise<DiffSummary> {
  const base = await resolveGitRevision(reviewInput.review.base, options.vcsRoot, options.textEncoding, options.commandTimeoutMs, options.signal)
  const head = await resolveGitRevision(reviewInput.review.head, options.vcsRoot, options.textEncoding, options.commandTimeoutMs, options.signal)
  const processBufferBytes = maxVcsProcessBufferBytes(options.limits.maxRawDiffBytes)
  const nameStatus = await runGitText(["diff", "--find-renames", "--name-status", "-z", base, head], options.vcsRoot, processBufferBytes, options.textEncoding, options.commandTimeoutMs, options.signal)
  const numstat = await runGitText(["diff", "--find-renames", "--numstat", "-z", base, head], options.vcsRoot, processBufferBytes, options.textEncoding, options.commandTimeoutMs, options.signal)
  const unifiedDiff = await runGitText(["diff", "--find-renames", "--unified=80", base, head], options.vcsRoot, processBufferBytes, options.textEncoding, options.commandTimeoutMs, options.signal)

  const counts = parseNumstatZ(numstat)
  const files = parseNameStatusZ(nameStatus).map(({ statusToken, filePath }) => {
    const normalizedPath = normalizeChangedFilePathStrict(filePath)
    return buildChangedFile(normalizedPath, statusFromGit(statusToken), counts.get(normalizedPath))
  })

  return { vcs: "git", vcsRoot: options.vcsRoot, base, head, files, unifiedDiff, warnings: [] }
}

async function collectBazaarDiff(reviewInput: ReviewInput, options: {
  workspaceRoot: string
  vcsRoot: string
  bzrPath?: string
  textEncoding?: string
  limits: ReviewProcessingLimits
  commandTimeoutMs?: number
  signal?: AbortSignal
}): Promise<DiffSummary> {
  const bzrPath = options.bzrPath?.trim() || "bzr"
  const base = validateBazaarRevision(reviewInput.review.base)
  const head = validateBazaarRevision(reviewInput.review.head)
  const revisionRange = `${base}..${head}`
  const processBufferBytes = maxVcsProcessBufferBytes(options.limits.maxRawDiffBytes)
  // Bazaar の alias は差分本文と副作用を変え得るため、収集系でも bzr --no-aliases を必ず先頭に置く。
  const unifiedDiff = await runCommandText(
    bzrPath,
    ["--no-aliases", "diff", "-r", revisionRange],
    options.vcsRoot,
    processBufferBytes,
    [0, 1],
    options.textEncoding,
    { BZR_PROGRESS_BAR: "none" },
    options.commandTimeoutMs,
    options.signal
  )
  const files = parseBazaarDiffFiles(unifiedDiff)
  return { vcs: "bazaar", vcsRoot: options.vcsRoot, base, head, files, unifiedDiff, warnings: [] }
}

async function resolveGitRevision(
  revision: string,
  cwd: string,
  textEncoding = "auto",
  commandTimeoutMs?: number,
  signal?: AbortSignal
): Promise<string> {
  const trimmed = revision.trim()
  if (!trimmed) throw new Error("Invalid Git revision: revision is empty")

  try {
    // Git revision は rev-parse --verify --end-of-options で commit SHA に固定し、以降の diff へ曖昧指定を渡さない。
    const output = await runGitText(["rev-parse", "--verify", "--end-of-options", `${trimmed}^{commit}`], cwd, 1024 * 1024, textEncoding, commandTimeoutMs, signal)
    const sha = output.trim().split(/\r?\n/).at(-1) ?? ""
    if (/^[0-9a-f]{40}$/i.test(sha)) return sha.toLowerCase()
  } catch (error) {
    if (!(error instanceof ExternalProcessError) || error.kind !== "nonZeroExit") throw error
    // rev-parse が対象を解決できない場合だけ、下の正規化済み validation error に揃える。
  }

  throw new Error(`Invalid Git revision: ${formatRevisionForError(revision)}`)
}

export function validateBazaarRevision(revision: string): string {
  const trimmed = revision.trim()
  if (/[\0-\x1F\x7F]/u.test(revision)) {
    throw new Error(`安全でない Bazaar リビジョン指定です: ${formatRevisionForError(revision)}`)
  }
  if (!trimmed) throw new Error("リビジョンを入力してください。")
  if (trimmed.length > MAX_BAZAAR_REVISION_SPEC_LENGTH) {
    throw new Error(`Bazaar リビジョン指定が長すぎます: ${formatRevisionForError(revision)}`)
  }
  if (trimmed.startsWith("-") || trimmed.includes("..")) {
    throw new Error(`安全でない Bazaar リビジョン指定です: ${formatRevisionForError(revision)}`)
  }
  if (!/^[A-Za-z0-9_.:+@/=-]+$/.test(trimmed)) {
    throw new Error(`安全でない Bazaar リビジョン指定です: ${formatRevisionForError(revision)}`)
  }
  return trimmed
}

function formatRevisionForError(revision: string): string {
  return revision.replace(/[\0-\x1F\x7F]/g, " ").trim()
}

async function runGitText(
  args: string[],
  cwd: string,
  maxBuffer: number,
  textEncoding = "auto",
  commandTimeoutMs?: number,
  signal?: AbortSignal
): Promise<string> {
  return runCommandText("git", args, cwd, maxBuffer, [0], textEncoding, undefined, commandTimeoutMs, signal)
}

async function runCommandText(
  command: string,
  args: string[],
  cwd: string,
  maxBuffer: number,
  allowedExitCodes: number[],
  textEncoding = "auto",
  env?: Record<string, string>,
  commandTimeoutMs?: number,
  signal?: AbortSignal
): Promise<string> {
  const result = await runExternalProcess({
    command,
    args,
    cwd,
    maxBufferBytes: maxBuffer,
    timeoutMs: normalizeCommandTimeout(commandTimeoutMs),
    allowedExitCodes,
    signal,
    env: { ...process.env, ...env }
  })
  return decodeTextBuffer(result.stdout, textEncoding)
}

function normalizeCommandTimeout(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return DEFAULT_VCS_COMMAND_TIMEOUT_MS
  return Math.max(MIN_VCS_COMMAND_TIMEOUT_MS, Math.min(MAX_VCS_COMMAND_TIMEOUT_MS, Math.floor(value)))
}

function parseNameStatusZ(text: string): Array<{ statusToken: string; filePath: string }> {
  const fields = nulFields(text)
  const records: Array<{ statusToken: string; filePath: string }> = []
  let index = 0

  while (index < fields.length) {
    const statusToken = fields[index++]
    if (!statusToken) continue
    if (statusToken.startsWith("R") || statusToken.startsWith("C")) {
      const previousPath = fields[index++]
      const filePath = fields[index++]
      if (previousPath === undefined || filePath === undefined) {
        throw new Error(`Malformed Git name-status rename record: ${statusToken}`)
      }
      records.push({ statusToken, filePath })
      continue
    }

    const filePath = fields[index++]
    if (filePath === undefined) throw new Error(`Malformed Git name-status record: ${statusToken}`)
    records.push({ statusToken, filePath })
  }

  return records
}

function parseNumstatZ(text: string): Map<string, { additions: number; deletions: number }> {
  const fields = nulFields(text)
  const result = new Map<string, { additions: number; deletions: number }>()
  let index = 0

  while (index < fields.length) {
    const record = fields[index++]
    if (!record) continue
    const firstTab = record.indexOf("\t")
    const secondTab = firstTab >= 0 ? record.indexOf("\t", firstTab + 1) : -1
    if (firstTab < 0 || secondTab < 0) throw new Error(`Malformed Git numstat record: ${record}`)

    const additionsToken = record.slice(0, firstTab)
    const deletionsToken = record.slice(firstTab + 1, secondTab)
    let filePath = record.slice(secondTab + 1)
    if (!filePath) {
      const previousPath = fields[index++]
      const renamedPath = fields[index++]
      if (previousPath === undefined || renamedPath === undefined) {
        throw new Error("Malformed Git numstat rename record.")
      }
      filePath = renamedPath
    }

    const normalizedPath = normalizeChangedFilePathStrict(filePath)
    const additions = Number.parseInt(additionsToken, 10)
    const deletions = Number.parseInt(deletionsToken, 10)
    result.set(normalizedPath, {
      additions: Number.isFinite(additions) ? additions : 0,
      deletions: Number.isFinite(deletions) ? deletions : 0
    })
  }

  return result
}

function nulFields(text: string): string[] {
  const fields = text.split("\0")
  if (fields.at(-1) === "") fields.pop()
  return fields
}

function parseBazaarDiffFiles(text: string): DiffSummary["files"] {
  const files = new Map<string, DiffSummary["files"][number]>()
  let current: DiffSummary["files"][number] | undefined

  for (const line of text.split(/\r?\n/)) {
    const header = line.match(/^===\s+(.+?)\s+file '(.+?)'(?:\s+=>\s+'(.+)')?$/)
    if (header) {
      const status = statusFromBazaar(header[1])
      const filePath = status === "renamed" ? header[3] ?? header[2] : header[2]
      current = buildChangedFile(filePath, status)
      files.set(current.path, current)
      continue
    }

    const plusFile = line.match(/^\+\+\+\s+(.+?)(?:\t.*)?$/)
    if (plusFile && plusFile[1] !== "/dev/null") {
      const filePath = plusFile[1]
      const normalizedPath = normalizeChangedFilePathStrict(filePath)
      current = files.get(normalizedPath) ?? buildChangedFile(normalizedPath, "modified")
      files.set(current.path, current)
      continue
    }

    if (!current || line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("=== ") || line.startsWith("@@")) continue
    if (line.startsWith("+")) current.additions = (current.additions ?? 0) + 1
    else if (line.startsWith("-")) current.deletions = (current.deletions ?? 0) + 1
  }

  return Array.from(files.values())
}

function buildChangedFile(filePath: string, status: DiffSummary["files"][number]["status"], count?: { additions: number; deletions: number }): DiffSummary["files"][number] {
  const normalizedPath = normalizeChangedFilePathStrict(filePath)
  return {
    path: normalizedPath,
    status,
    additions: count?.additions ?? 0,
    deletions: count?.deletions ?? 0,
    language: languageFromPath(normalizedPath),
    is_test: /(^|[\\/])(test|tests|spec)([\\/]|$)|\btest\b/i.test(normalizedPath),
    is_interface_candidate: /\.(h|hpp|hh)$/i.test(normalizedPath)
  }
}

function statusFromGit(status: string): DiffSummary["files"][number]["status"] {
  if (status.startsWith("A")) return "added"
  if (status.startsWith("M")) return "modified"
  if (status.startsWith("D")) return "deleted"
  if (status.startsWith("R")) return "renamed"
  return "unknown"
}

function statusFromBazaar(status: string): DiffSummary["files"][number]["status"] {
  const normalized = status.toLowerCase()
  if (normalized.includes("added")) return "added"
  if (normalized.includes("modified")) return "modified"
  if (normalized.includes("removed") || normalized.includes("deleted")) return "deleted"
  if (normalized.includes("renamed")) return "renamed"
  return "unknown"
}

function applyDiffLimits(diff: DiffSummary, limits: ReviewProcessingLimits): DiffSummary {
  if (!diff.unifiedDiff) return diff
  const suffix = "\n\n[truncated: maxRawDiffBytes]\n"
  const limited = truncateUtf8Text(diff.unifiedDiff, limits.maxRawDiffBytes, suffix)
  if (!limited.truncated) return diff
  return {
    ...diff,
    unifiedDiff: limited.text,
    warnings: [
      ...(diff.warnings ?? []),
      `unified diff exceeded maxRawDiffBytes (${limited.originalBytes} > ${limits.maxRawDiffBytes}); raw diff truncated.`
    ]
  }
}

function normalizeVcs(value: ReviewInput["review"]["vcs"]): VcsKind {
  if (value === "bazaar" || value === "bzr") return "bazaar"
  return "git"
}

function resolveVcsRoot(workspaceRoot: string, value: string | undefined): string {
  return value ? resolveWorkspacePathStrict(workspaceRoot, value, "vcsRoot") : workspaceRoot
}

export function languageFromPath(filePath: string): string {
  return classifyLanguageFromPath(filePath)
}
