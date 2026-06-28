import * as path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { readTextFile, toPosixPath } from "./fileSystem"
import type { DiffSummary, ReviewInput } from "./types"

const execFileAsync = promisify(execFile)

export async function collectGitDiff(reviewInput: ReviewInput, options: { workspaceRoot: string; diffFixturePath?: string }): Promise<DiffSummary> {
  if (options.diffFixturePath) {
    const fixture = JSON.parse(await readTextFile(options.diffFixturePath)) as DiffSummary
    return normalizeDiffLanguages(fixture)
  }

  const { stdout: nameStatus } = await execFileAsync("git", ["diff", "--name-status", reviewInput.review.base, reviewInput.review.head], { cwd: options.workspaceRoot, maxBuffer: 20 * 1024 * 1024 })
  const { stdout: numstat } = await execFileAsync("git", ["diff", "--numstat", reviewInput.review.base, reviewInput.review.head], { cwd: options.workspaceRoot, maxBuffer: 20 * 1024 * 1024 })
  const { stdout: unifiedDiff } = await execFileAsync("git", ["diff", "--unified=80", reviewInput.review.base, reviewInput.review.head], { cwd: options.workspaceRoot, maxBuffer: 50 * 1024 * 1024 })

  const counts = parseNumstat(numstat)
  const files = nameStatus.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return []
    const parts = line.split(/\t/)
    const statusToken = parts[0] ?? ""
    const filePath = statusToken.startsWith("R") ? parts[2] : parts[1]
    if (!filePath) return []
    const count = counts.get(toPosixPath(filePath))
    return [{
      path: toPosixPath(filePath),
      status: statusFromGit(statusToken),
      additions: count?.additions ?? 0,
      deletions: count?.deletions ?? 0,
      language: languageFromPath(filePath),
      is_test: /(^|[\\/])(test|tests|spec)([\\/]|$)|\btest\b/i.test(filePath),
      is_interface_candidate: /\.(h|hpp|hh)$/i.test(filePath)
    }]
  })

  return { base: reviewInput.review.base, head: reviewInput.review.head, files, unifiedDiff, warnings: [] }
}

function parseNumstat(text: string): Map<string, { additions: number; deletions: number }> {
  const result = new Map<string, { additions: number; deletions: number }>()
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split(/\t/)
    if (parts.length < 3) continue
    const additions = Number.parseInt(parts[0], 10)
    const deletions = Number.parseInt(parts[1], 10)
    const filePath = parts[2]
    result.set(toPosixPath(filePath), {
      additions: Number.isFinite(additions) ? additions : 0,
      deletions: Number.isFinite(deletions) ? deletions : 0
    })
  }
  return result
}

function statusFromGit(status: string): DiffSummary["files"][number]["status"] {
  if (status.startsWith("A")) return "added"
  if (status.startsWith("M")) return "modified"
  if (status.startsWith("D")) return "deleted"
  if (status.startsWith("R")) return "renamed"
  return "unknown"
}

function normalizeDiffLanguages(diff: DiffSummary): DiffSummary {
  return {
    ...diff,
    files: diff.files.map((file) => ({ ...file, path: toPosixPath(file.path), language: file.language ?? languageFromPath(file.path) }))
  }
}

export function languageFromPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === ".c") return "c"
  if ([".cc", ".cpp", ".cxx"].includes(extension)) return "cpp"
  if (extension === ".h") return "h"
  if ([".hh", ".hpp", ".hxx"].includes(extension)) return "hpp"
  return extension.replace(/^\./, "") || "unknown"
}
