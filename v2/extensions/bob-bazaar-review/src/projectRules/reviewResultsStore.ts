import * as fs from "node:fs/promises"
import * as path from "node:path"

export interface StoredReviewResult {
  path: string
  result: unknown
}

export async function getReviewResult(workspaceRoot: string, reviewId: string): Promise<StoredReviewResult> {
  const normalized = normalizeReviewId(reviewId)
  const filePath = path.join(resultsDirectory(workspaceRoot), `${normalized}.json`)
  return readReviewResultFile(filePath)
}

export async function getLatestReviewResult(workspaceRoot: string): Promise<StoredReviewResult> {
  const dir = resultsDirectory(workspaceRoot)
  let entries: Array<{ path: string; mtimeMs: number }>
  try {
    const files = await fs.readdir(dir, { withFileTypes: true })
    entries = await Promise.all(files
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
      .map(async (entry) => {
        const filePath = path.join(dir, entry.name)
        const stat = await fs.stat(filePath)
        return { path: filePath, mtimeMs: stat.mtimeMs }
      }))
  } catch (error: any) {
    if (error?.code === "ENOENT") throw new Error(`Review results directory not found: ${dir}`)
    throw error
  }

  entries.sort((left, right) => right.mtimeMs - left.mtimeMs || right.path.localeCompare(left.path))
  const latest = entries[0]
  if (!latest) throw new Error(`No review result JSON files found in ${dir}`)
  return readReviewResultFile(latest.path)
}

function resultsDirectory(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".bob", "review", "results")
}

function normalizeReviewId(reviewId: string): string {
  const trimmed = reviewId.trim().replace(/\.json$/i, "")
  if (!trimmed) throw new Error("reviewId is required")
  if (/[\\/]/.test(trimmed)) throw new Error("reviewId must not contain path separators")
  return trimmed
}

async function readReviewResultFile(filePath: string): Promise<StoredReviewResult> {
  try {
    const raw = await fs.readFile(filePath, "utf8")
    return { path: filePath, result: JSON.parse(raw) }
  } catch (error: any) {
    if (error?.code === "ENOENT") throw new Error(`Review result file not found: ${filePath}`)
    throw new Error(`Failed to read review result ${filePath}: ${error?.message ?? String(error)}`)
  }
}
