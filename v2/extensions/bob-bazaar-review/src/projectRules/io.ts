import * as fs from "node:fs/promises"
import * as path from "node:path"
import { DEFAULT_CHECKLIST, REVIEW_RESULT_SCHEMA } from "./defaults"
import { ProjectChecklist } from "./types"

export interface ProjectRulesPaths {
  reviewDir: string
  checklistPath: string
  schemaPath: string
}

export function getProjectRulesPaths(workspaceRoot: string): ProjectRulesPaths {
  const reviewDir = path.join(workspaceRoot, ".bob", "review")
  return {
    reviewDir,
    checklistPath: path.join(reviewDir, "checklist.json"),
    schemaPath: path.join(reviewDir, "review-result.schema.json")
  }
}

export async function initializeProjectRules(workspaceRoot: string): Promise<ProjectRulesPaths> {
  const paths = getProjectRulesPaths(workspaceRoot)
  await fs.mkdir(paths.reviewDir, { recursive: true })
  await writeJsonIfMissing(paths.checklistPath, DEFAULT_CHECKLIST)
  await writeJsonIfMissing(paths.schemaPath, REVIEW_RESULT_SCHEMA)
  return paths
}

export async function loadProjectChecklist(workspaceRoot: string, explicitPath?: string): Promise<ProjectChecklist> {
  const checklistPath = explicitPath ? resolveWorkspacePath(workspaceRoot, explicitPath) : getProjectRulesPaths(workspaceRoot).checklistPath
  try {
    const raw = await fs.readFile(checklistPath, "utf8")
    const parsed = JSON.parse(raw)
    assertChecklist(parsed, checklistPath)
    return parsed
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return DEFAULT_CHECKLIST
    }
    throw new Error(`Failed to load project checklist ${checklistPath}: ${error?.message ?? String(error)}`)
  }
}

export async function loadReviewResultSchema(workspaceRoot: string, explicitPath?: string): Promise<unknown> {
  const schemaPath = explicitPath ? resolveWorkspacePath(workspaceRoot, explicitPath) : getProjectRulesPaths(workspaceRoot).schemaPath
  try {
    const raw = await fs.readFile(schemaPath, "utf8")
    return JSON.parse(raw)
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return REVIEW_RESULT_SCHEMA
    }
    throw new Error(`Failed to load review result schema ${schemaPath}: ${error?.message ?? String(error)}`)
  }
}

export function resolveWorkspacePath(workspaceRoot: string, maybeRelativePath: string): string {
  if (path.isAbsolute(maybeRelativePath)) {
    return maybeRelativePath
  }
  return path.join(workspaceRoot, maybeRelativePath)
}

async function writeJsonIfMissing(filePath: string, value: unknown): Promise<void> {
  try {
    await fs.access(filePath)
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
  }
}

function assertChecklist(value: any, filePath: string): asserts value is ProjectChecklist {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${filePath} must contain a JSON object`)
  }
  if (typeof value.version !== "string" || typeof value.project !== "string" || !Array.isArray(value.rules)) {
    throw new Error(`${filePath} must contain version, project, and rules[]`)
  }
  for (const [index, rule] of value.rules.entries()) {
    if (!rule || typeof rule !== "object") {
      throw new Error(`${filePath}.rules[${index}] must be an object`)
    }
    for (const key of ["id", "category", "title", "description", "severity_on_fail"]) {
      if (typeof rule[key] !== "string" || !rule[key]) {
        throw new Error(`${filePath}.rules[${index}].${key} must be a non-empty string`)
      }
    }
  }
}
