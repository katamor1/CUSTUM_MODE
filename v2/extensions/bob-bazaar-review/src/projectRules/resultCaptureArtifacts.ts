import { createHash, randomUUID } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { EXTENSION_NAME, EXTENSION_VERSION } from "../shared/extensionMetadata"
import { renderReviewResultMarkdown } from "./markdown"
import type { CaptureReviewResultOptions, SavedReviewResultArtifacts } from "./resultCaptureTypes"
import type { ReviewResult } from "./types"

export async function saveReviewResultArtifacts(
  workspaceRoot: string,
  result: ReviewResult,
  options: CaptureReviewResultOptions = {}
): Promise<SavedReviewResultArtifacts> {
  const resultsDir = path.join(workspaceRoot, ".bob", "review", "results")
  await fs.mkdir(resultsDir, { recursive: true })

  const baseName = sanitizeFilename(result.review_id || buildFallbackReviewId(result))
  const jsonPath = path.join(resultsDir, `${baseName}.json`)
  const markdownPath = path.join(resultsDir, `${baseName}.md`)
  const metadataPath = path.join(resultsDir, `${baseName}.artifact-metadata.json`)
  const backupPaths = [
    await backupExistingFile(jsonPath),
    await backupExistingFile(markdownPath),
    await backupExistingFile(metadataPath)
  ].filter((backupPath): backupPath is string => Boolean(backupPath))
  await writeFileAtomic(jsonPath, `${JSON.stringify(result, null, 2)}\n`)
  await writeFileAtomic(markdownPath, `${renderReviewResultMarkdown(result)}\n`)
  await writeFileAtomic(metadataPath, `${JSON.stringify(buildArtifactMetadata(result, options), null, 2)}\n`)
  return { jsonPath, markdownPath, metadataPath, backupPaths }
}

function buildArtifactMetadata(result: ReviewResult, options: CaptureReviewResultOptions): Record<string, unknown> {
  return {
    producer_extension: EXTENSION_NAME,
    producer_version: EXTENSION_VERSION,
    workflow_run_id: options.workflowRunId ?? "",
    source_vcs: result.vcs.type || "bazaar",
    source_revision: sourceRevision(result),
    input_hash: sha256Prefixed(result),
    contains_sensitive_context: true,
    human_review_required: true
  }
}

function sourceRevision(result: ReviewResult): string {
  if (result.vcs.revision) return result.vcs.revision
  if (result.vcs.base_revision && result.vcs.target_revision) return `${result.vcs.base_revision}..${result.vcs.target_revision}`
  return result.vcs.target_revision || result.vcs.base_revision || ""
}

function sha256Prefixed(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`
}

async function backupExistingFile(filePath: string): Promise<string | undefined> {
  if (!(await fileExists(filePath))) return undefined
  const suffix = new Date().toISOString().replace(/[:.]/g, "-")
  const backupPath = `${filePath}.bak-${suffix}-${randomUUID()}`
  await fs.copyFile(filePath, backupPath)
  return backupPath
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`
  try {
    await fs.writeFile(tempPath, content, "utf8")
    await fs.rename(tempPath, filePath)
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath)
    return true
  } catch (error: any) {
    if (error?.code === "ENOENT") return false
    throw error
  }
}

function sanitizeFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "") || "review-result"
}

function buildFallbackReviewId(result: ReviewResult): string {
  const revision = result.vcs.revision || result.vcs.target_revision || result.vcs.base_revision || "unknown"
  return `bazaar-${revision}-project-rule-review`
}
