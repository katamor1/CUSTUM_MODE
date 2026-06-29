import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as vscode from "vscode"

export interface InitializeCodeConsistencyWorkspaceOptions {
  context: vscode.ExtensionContext
  workspaceRoot: string
}

export interface InitializeCodeConsistencyWorkspaceResult {
  status: "created" | "updated" | "unchanged"
  workspaceRoot: string
  workflowPath: string
  backupPath?: string
  message: string
}

const WORKFLOW_RELATIVE_PATH = path.join(".bob", "workflows", "code-consistency-review", "WORKFLOW.md")
const WORKFLOW_TEMPLATE_RELATIVE_PATH = path.join("templates", ".bob", "workflows", "code-consistency-review", "WORKFLOW.md")

export async function initializeCodeConsistencyWorkspace(options: InitializeCodeConsistencyWorkspaceOptions): Promise<InitializeCodeConsistencyWorkspaceResult> {
  const workflowPath = path.join(options.workspaceRoot, WORKFLOW_RELATIVE_PATH)
  const templatePath = options.context.asAbsolutePath(WORKFLOW_TEMPLATE_RELATIVE_PATH)
  const template = await fs.readFile(templatePath, "utf8")

  await fs.mkdir(path.dirname(workflowPath), { recursive: true })

  const current = await readIfExists(workflowPath)
  if (current === template) {
    return {
      status: "unchanged",
      workspaceRoot: options.workspaceRoot,
      workflowPath,
      message: `コード整合プレレビュー workflow は既に最新です: ${workflowPath}`
    }
  }

  let backupPath: string | undefined
  if (current !== undefined) {
    backupPath = `${workflowPath}.bak-${timestampForFileName(new Date())}`
    await fs.writeFile(backupPath, current, "utf8")
  }

  await fs.writeFile(workflowPath, template, "utf8")
  const status = current === undefined ? "created" : "updated"
  return {
    status,
    workspaceRoot: options.workspaceRoot,
    workflowPath,
    backupPath,
    message: status === "created"
      ? `コード整合プレレビュー workflow を作成しました: ${workflowPath}`
      : `コード整合プレレビュー workflow を更新しました: ${workflowPath}`
  }
}

async function readIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8")
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined
    throw error
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error
}

function timestampForFileName(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}
