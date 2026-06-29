import * as path from "node:path"
import YAML from "yaml"
import { pathExists, readTextFile, resolveWorkspacePath } from "./fileSystem"
import { formatSchemaErrors, loadSchemaValidator } from "./schemaLoader"
import type { ReviewInput } from "./types"

export async function validateReviewInput(inputPath: string, workspaceRoot = process.cwd(), textEncoding = "auto"): Promise<ReviewInput> {
  const raw = await readTextFile(inputPath, textEncoding)
  const parsed = YAML.parse(raw) as unknown

  const validate = await loadSchemaValidator("review-input")
  if (!validate(parsed)) {
    const errors = formatSchemaErrors(validate)
    throw new Error(`Invalid review-input.yaml:\n${errors.map((error) => `- ${error}`).join("\n")}`)
  }

  const reviewInput = parsed as ReviewInput
  const missing = await missingArtifactPaths(reviewInput, workspaceRoot)
  if (missing.length > 0) {
    throw new Error(`review-input.yaml references missing artifact file(s):\n${missing.map((file) => `- ${file}`).join("\n")}`)
  }

  return reviewInput
}

async function missingArtifactPaths(reviewInput: ReviewInput, workspaceRoot: string): Promise<string[]> {
  const result: string[] = []
  for (const value of Object.values(reviewInput.artifacts)) {
    if (!Array.isArray(value)) continue
    for (const item of value as Array<{ path?: string }>) {
      if (!item.path) continue
      const resolved = resolveWorkspacePath(workspaceRoot, item.path)
      if (!(await pathExists(resolved))) result.push(path.normalize(item.path))
    }
  }
  return result
}
