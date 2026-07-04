import * as path from "node:path"
import YAML from "yaml"
import { pathExists, readTextFile, resolveWorkspacePathStrict } from "./fileSystem"
import { formatSchemaErrors, loadSchemaValidator } from "./schemaLoader"
import type { ReviewInput } from "./reviewTypes"

export async function validateReviewInput(inputPath: string, workspaceRoot = process.cwd(), textEncoding = "auto"): Promise<ReviewInput> {
  const resolvedInputPath = resolveWorkspacePathStrict(workspaceRoot, inputPath, "reviewInputPath")
  const raw = await readTextFile(resolvedInputPath, textEncoding)
  const parsed = YAML.parse(raw) as unknown

  const validate = await loadSchemaValidator("review-input")
  if (!validate(parsed)) {
    const errors = formatSchemaErrors(validate)
    throw new Error(`Invalid review-input.yaml:\n${errors.map((error) => `- ${error}`).join("\n")}`)
  }

  const reviewInput = parsed as ReviewInput
  const artifactValidation = await validateArtifactPaths(reviewInput, workspaceRoot)
  if (artifactValidation.escaped.length > 0) {
    throw new Error(`review-input.yaml artifact path escapes workspace:\n${artifactValidation.escaped.map((file) => `- ${file}`).join("\n")}`)
  }
  if (artifactValidation.missing.length > 0) {
    throw new Error(`review-input.yaml references missing artifact file(s):\n${artifactValidation.missing.map((file) => `- ${file}`).join("\n")}`)
  }

  return reviewInput
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
