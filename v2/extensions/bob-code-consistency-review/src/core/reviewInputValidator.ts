import * as fs from "node:fs/promises"
import * as path from "node:path"
import YAML from "yaml"
import { pathExists, resolveWorkspacePathStrict } from "./fileSystem"
import { DEFAULT_REVIEW_PROCESSING_LIMITS, normalizeReviewProcessingLimits } from "./limits"
import { formatSchemaErrors, loadSchemaValidator } from "./schemaLoader"
import { decodeTextBuffer } from "./textEncoding"
import type { ReviewInput } from "./reviewTypes"

export const MAX_REVIEW_INPUT_ARTIFACT_REFERENCES = 500

export async function validateReviewInput(
  inputPath: string,
  workspaceRoot = process.cwd(),
  textEncoding = "auto",
  maxInputBytes = DEFAULT_REVIEW_PROCESSING_LIMITS.maxDocumentBytes
): Promise<ReviewInput> {
  const resolvedInputPath = resolveWorkspacePathStrict(workspaceRoot, inputPath, "reviewInputPath")
  const inputByteLimit = normalizeReviewProcessingLimits({ maxDocumentBytes: maxInputBytes }).maxDocumentBytes
  const raw = await readReviewInputWithinLimit(resolvedInputPath, textEncoding, inputByteLimit)
  const parsed = YAML.parse(raw) as unknown

  const validate = await loadSchemaValidator("review-input")
  if (!validate(parsed)) {
    const errors = formatSchemaErrors(validate)
    throw new Error(`Invalid review-input.yaml:\n${errors.map((error) => `- ${error}`).join("\n")}`)
  }

  const reviewInput = parsed as ReviewInput
  const artifactReferences = countArtifactReferences(reviewInput)
  if (artifactReferences > MAX_REVIEW_INPUT_ARTIFACT_REFERENCES) {
    throw new Error(
      `review-input.yaml artifact references exceed maximum (${artifactReferences} > ${MAX_REVIEW_INPUT_ARTIFACT_REFERENCES})`
    )
  }

  const artifactValidation = await validateArtifactPaths(reviewInput, workspaceRoot)
  if (artifactValidation.escaped.length > 0) {
    throw new Error(`review-input.yaml artifact path escapes workspace:\n${artifactValidation.escaped.map((file) => `- ${file}`).join("\n")}`)
  }
  if (artifactValidation.missing.length > 0) {
    throw new Error(`review-input.yaml references missing artifact file(s):\n${artifactValidation.missing.map((file) => `- ${file}`).join("\n")}`)
  }

  return reviewInput
}

async function readReviewInputWithinLimit(filePath: string, textEncoding: string, maxBytes: number): Promise<string> {
  const handle = await fs.open(filePath, "r")
  try {
    const before = await handle.stat()
    if (before.size > maxBytes) {
      throw new Error(`review-input.yaml exceeded maxDocumentBytes (${before.size} > ${maxBytes})`)
    }

    const buffer = Buffer.alloc(before.size)
    let offset = 0
    while (offset < buffer.length) {
      const read = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (read.bytesRead === 0) break
      offset += read.bytesRead
    }

    const after = await handle.stat()
    if (after.size > maxBytes) {
      throw new Error(`review-input.yaml exceeded maxDocumentBytes (${after.size} > ${maxBytes})`)
    }
    return decodeTextBuffer(buffer.subarray(0, offset), textEncoding)
  } finally {
    await handle.close()
  }
}

function countArtifactReferences(reviewInput: ReviewInput): number {
  return Object.values(reviewInput.artifacts).reduce<number>(
    (total, value) => total + (Array.isArray(value) ? value.length : 0),
    0
  )
}

async function validateArtifactPaths(reviewInput: ReviewInput, workspaceRoot: string): Promise<{ escaped: string[]; missing: string[] }> {
  const escaped: string[] = []
  const missing: string[] = []
  for (const value of Object.values(reviewInput.artifacts)) {
    if (!Array.isArray(value)) continue
    for (const item of value as Array<{ path?: string }>) {
      if (!item.path) continue
      let resolved: string
      try {
        resolved = resolveWorkspacePathStrict(workspaceRoot, item.path, "artifact path")
      } catch {
        escaped.push(path.normalize(item.path))
        continue
      }
      if (!(await pathExists(resolved))) missing.push(path.normalize(item.path))
    }
  }
  return { escaped, missing }
}
