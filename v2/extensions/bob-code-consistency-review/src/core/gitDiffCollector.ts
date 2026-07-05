import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { readTextFile, resolveWorkspacePathStrict, toPosixPath } from "./fileSystem"
import { classifyLanguageFromPath } from "./languageClassifier"
import { decodeTextBuffer } from "./textEncoding"
import { normalizeReviewProcessingLimits, truncateUtf8Text, type ReviewProcessingLimits } from "./limits"
import type { DiffSummary } from "./diffTypes"
import type { ReviewInput } from "./reviewTypes"

const execFileAsync = promisify(execFile)

type VcsKind = "git" | "bazaar"
const MAX_BAZAAR_REVISION_SPEC_LENGTH = 128

export async function collectGitDiff(reviewInput: ReviewInput, options: { workspaceRoot: string; diffFixturePath?: string; bzrPath?: string; textEncoding?: string; limits?: Partial<ReviewProcessingLimits> }): Promise<DiffSummary> {
  const limits = normalizeReviewProcessingLimits(options.limits)
  if (options.diffFixturePath) {
    const fixturePath = resolveWorkspacePathStrict(options.workspaceRoot, options.diffFixturePath, "diffFixturePath")
    const fixture = JSON.parse(await readTextFile(fixturePath, options.textEncoding)) as DiffSummary
    return applyDiffLimits(normalizeDiffLanguages(fixture), limits)
  }

  const vcs = normalizeVcs(reviewInput.review.vcs)
  const vcsRoot = resolveVcsRoot(options.workspaceRoot, reviewInput.review.vcs_root)
  const diff = vcs === "bazaar"
    ? await collectBazaarDiff(reviewInput, { ...options, vcsRoot })
    : await collectStandardGitDiff(reviewInput, { ...options, vcsRoot })
  return applyDiffLimits(diff, limits)
}

async function collectStandardGitDiff(reviewInput: ReviewInput, options: { workspaceRoot: string; vcsRoot: string; textEncoding?: string }): Promise<DiffSummary> {
  const base = await resolveGitRevision(reviewInput.review.base, options.vcsRoot, options.textEncoding)
  const head = await resolveGitRevision(reviewInput.review.head, options.vcsRoot, options.textEncoding)
  const nameStatus = await runGitText(["diff", "--find-renames", "--name-status", base, head], options.vcsRoot, 20 * 1024 * 1024, options.textEncoding)
  const numstat = await runGitText(["diff", "--find-renames", "--numstat", base, head], options.vcsRoot, 20 * 1024 * 1024, options.textEncoding)
  const unifiedDiff = await runGitText(["diff", "--find-renames", "--unified=80", base, head], options.vcsRoot, 50 * 1024 * 1024, options.textEncoding)

  const counts = parseNumstat(numstat)
  const files = nameStatus.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return []
    const parts = line.split(/\t/)
    const statusToken = parts[0] ?? ""
    const filePath = statusToken.startsWith("R") ? parts[2] : parts[1]
    if (!filePath) return []
    const count = counts.get(toPosixPath(filePath))
    return [buildChangedFile(filePath, statusFromGit(statusToken), count)]
  })

  return { vcs: "git", vcsRoot: options.vcsRoot, base, head, files, unifiedDiff, warnings: [] }
}

async function collectBazaarDiff(reviewInput: ReviewInput, options: { workspaceRoot: string; vcsRoot: string; bzrPath?: string; textEncoding?: string }): Promise<DiffSummary> {
  const bzrPath = options.bzrPath?.trim() || "bzr"
  const base = validateBazaarRevision(reviewInput.review.base)
  const head = validateBazaarRevision(reviewInput.review.head)
  const revisionRange = `${base}..${head}`
  // Bazaar の alias は差分本文と副作用を変え得るため、収集系でも bzr --no-aliases を必ず先頭に置く。
  const unifiedDiff = await runCommandText(
    bzrPath,
    ["--no-aliases", "diff", "-r", revisionRange],
    options.vcsRoot,
    50 * 1024 * 1024,
    [0, 1],
    options.textEncoding,
    { BZR_PROGRESS_BAR: "none" }
  )
  const files = parseBazaarDiffFiles(unifiedDiff)
  return { vcs: "bazaar", vcsRoot: options.vcsRoot, base, head, files, unifiedDiff, warnings: [] }
}

async function resolveGitRevision(revision: string, cwd: string, textEncoding = "auto"): Promise<string> {
  const trimmed = revision.trim()
  if (!trimmed) throw new Error("Invalid Git revision: revision is empty")

  try {
    // Git revision は rev-parse --verify --end-of-options で commit SHA に固定し、以降の diff へ曖昧指定を渡さない。
    const output = await runGitText(["rev-parse", "--verify", "--end-of-options", `${trimmed}^{commit}`], cwd, 1024 * 1024, textEncoding)
    const sha = output.trim().split(/\r?\n/).at(-1) ?? ""
    if (/^[0-9a-f]{40}$/i.test(sha)) return sha.toLowerCase()
  } catch {
    // git の詳細 error はそのまま出さず、下の正規化済み validation error に揃える。
  }

  throw new Error(`Invalid Git revision: ${formatRevisionForError(revision)}`)
}

export function validateBazaarRevision(revision: string): string {
  const trimmed = revision.trim()
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
  return revision.replace(/[\0\r\n\t]/g, " ").trim()
}

async function runGitText(args: string[], cwd: string, maxBuffer: number, textEncoding = "auto"): Promise<string> {
  const result = await execFileAsync("git", args, { cwd, maxBuffer, encoding: "buffer" } as any) as { stdout?: Buffer | string }
  return decodeTextBuffer(toBuffer(result.stdout), textEncoding)
}

function runCommandText(command: string, args: string[], cwd: string, maxBuffer: number, allowedExitCodes: number[], textEncoding = "auto", env?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      cwd,
      maxBuffer,
      encoding: "buffer",
      shell: false,
      env: { ...process.env, ...env }
    } as any, (error, stdout, stderr) => {
      const code = exitCode(error)
      if (error && !allowedExitCodes.includes(code)) {
        const stderrText = decodeTextBuffer(toBuffer(stderr), textEncoding)
        const stdoutText = decodeTextBuffer(toBuffer(stdout), textEncoding)
        reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}\n${stderrText || stdoutText}`.trim()))
        return
      }
      resolve(decodeTextBuffer(toBuffer(stdout), textEncoding))
    })
  })
}

function exitCode(error: unknown): number {
  if (!error) return 0
  if (typeof error === "object" && error !== null && "code" in error && typeof (error as { code?: unknown }).code === "number") {
    return (error as { code: number }).code
  }
  return -1
}

function toBuffer(value: Buffer | string | undefined): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value ?? "", "utf8")
}

function parseNumstat(text: string): Map<string, { additions: number; deletions: number }> {
  const result = new Map<string, { additions: number; deletions: number }>()
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split(/\t/)
    if (parts.length < 3) continue
    const additions = Number.parseInt(parts[0], 10)
    const deletions = Number.parseInt(parts[1], 10)
    const filePath = normalizeNumstatPath(parts.slice(2).join("\t"))
    result.set(toPosixPath(filePath), {
      additions: Number.isFinite(additions) ? additions : 0,
      deletions: Number.isFinite(deletions) ? deletions : 0
    })
  }
  return result
}

function normalizeNumstatPath(filePath: string): string {
  const renamed = filePath.match(/^(.*)\{(.+?) => (.+?)\}(.*)$/)
  if (!renamed) return filePath
  return `${renamed[1]}${renamed[3]}${renamed[4]}`
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
      const filePath = normalizeDiffPath(plusFile[1])
      current = files.get(filePath) ?? buildChangedFile(filePath, "modified")
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
  return {
    path: toPosixPath(normalizeDiffPath(filePath)),
    status,
    additions: count?.additions ?? 0,
    deletions: count?.deletions ?? 0,
    language: languageFromPath(filePath),
    is_test: /(^|[\\/])(test|tests|spec)([\\/]|$)|\btest\b/i.test(filePath),
    is_interface_candidate: /\.(h|hpp|hh)$/i.test(filePath)
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

function normalizeDiffLanguages(diff: DiffSummary): DiffSummary {
  return {
    ...diff,
    files: diff.files.map((file) => ({ ...file, path: toPosixPath(file.path), language: file.language ?? languageFromPath(file.path) }))
  }
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

function normalizeDiffPath(filePath: string): string {
  return filePath.replace(/^a\//, "").replace(/^b\//, "")
}

export function languageFromPath(filePath: string): string {
  return classifyLanguageFromPath(filePath)
}
