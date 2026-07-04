import * as fs from "node:fs/promises"
import * as path from "node:path"
import { decodeTextBuffer } from "../textEncoding"
import { DEFAULT_CHECKLIST, REVIEW_RESULT_SCHEMA } from "./defaults"
import { ProjectChecklist } from "./types"

export interface ProjectRulesPaths {
  reviewDir: string
  checklistPath: string
  schemaPath: string
}

const ALLOW_EXTERNAL_REVIEW_RULES_ENV = "BOB_BAZAAR_ALLOW_EXTERNAL_REVIEW_RULES"

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
    const raw = await readJsonText(checklistPath)
    const parsed = JSON.parse(raw)
    assertChecklist(parsed, checklistPath)
    return parsed
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return DEFAULT_CHECKLIST
    }
    throw new Error(`プロジェクト review checklist の読み込みに失敗しました ${checklistPath}: ${error?.message ?? String(error)}`)
  }
}

export async function loadProjectChecklistRequired(workspaceRoot: string, explicitPath?: string): Promise<ProjectChecklist> {
  const checklistPath = explicitPath ? resolveWorkspacePath(workspaceRoot, explicitPath) : getProjectRulesPaths(workspaceRoot).checklistPath
  try {
    const raw = await readJsonText(checklistPath)
    const parsed = JSON.parse(raw)
    assertChecklist(parsed, checklistPath)
    return parsed
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      throw new Error(`Project checklist file not found: ${checklistPath}。プロジェクト review checklist ファイルが見つかりません。`)
    }
    throw new Error(`プロジェクト review checklist の読み込みに失敗しました ${checklistPath}: ${error?.message ?? String(error)}`)
  }
}

export async function loadReviewResultSchema(workspaceRoot: string, explicitPath?: string): Promise<unknown> {
  const schemaPath = explicitPath ? resolveWorkspacePath(workspaceRoot, explicitPath) : getProjectRulesPaths(workspaceRoot).schemaPath
  try {
    const raw = await readJsonText(schemaPath)
    return JSON.parse(raw)
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return REVIEW_RESULT_SCHEMA
    }
    throw new Error(`レビュー結果 schema の読み込みに失敗しました ${schemaPath}: ${error?.message ?? String(error)}`)
  }
}

export async function loadReviewResultSchemaRequired(workspaceRoot: string, explicitPath?: string): Promise<unknown> {
  const schemaPath = explicitPath ? resolveWorkspacePath(workspaceRoot, explicitPath) : getProjectRulesPaths(workspaceRoot).schemaPath
  try {
    const raw = await readJsonText(schemaPath)
    return JSON.parse(raw)
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      throw new Error(`Review result schema file not found: ${schemaPath}。レビュー結果 schema ファイルが見つかりません。`)
    }
    throw new Error(`レビュー結果 schema の読み込みに失敗しました ${schemaPath}: ${error?.message ?? String(error)}`)
  }
}

export function resolveWorkspacePath(workspaceRoot: string, maybeRelativePath: string): string {
  const root = path.resolve(workspaceRoot)
  const target = path.isAbsolute(maybeRelativePath)
    ? path.resolve(maybeRelativePath)
    : path.resolve(root, maybeRelativePath)
  const relative = path.relative(root, target)
  if (isWorkspaceEscapingPath(relative) && process.env[ALLOW_EXTERNAL_REVIEW_RULES_ENV] !== "1") {
    throw new Error(`Project review rule path escapes the workspace: ${maybeRelativePath}。プロジェクト review rule のパスがワークスペース外を指しています。外部パスを明示的に許可する場合は ${ALLOW_EXTERNAL_REVIEW_RULES_ENV}=1 を設定してください。`)
  }
  return target
}

function isWorkspaceEscapingPath(relativePath: string): boolean {
  return relativePath.startsWith("..") || path.isAbsolute(relativePath)
}

async function readJsonText(filePath: string): Promise<string> {
  return decodeTextBuffer(await fs.readFile(filePath))
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
    throw new Error(`${filePath} には JSON object が必要です。`)
  }
  if (typeof value.version !== "string" || typeof value.project !== "string" || !Array.isArray(value.rules)) {
    throw new Error(`${filePath} には version, project, rules[] が必要です。`)
  }
  for (const [index, rule] of value.rules.entries()) {
    if (!rule || typeof rule !== "object") {
      throw new Error(`${filePath}.rules[${index}] は object である必要があります。`)
    }
    for (const key of ["id", "category", "title", "description", "severity_on_fail"]) {
      if (typeof rule[key] !== "string" || !rule[key]) {
        throw new Error(`${filePath}.rules[${index}].${key} は空でない string である必要があります。`)
      }
    }
  }
}

