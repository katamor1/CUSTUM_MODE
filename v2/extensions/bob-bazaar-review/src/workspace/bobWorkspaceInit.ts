import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as vscode from "vscode"
import { configureWorkspaceMcpServer } from "../mcp/mcpConfig"
import { refreshTemplateFile, type TemplateRefreshOptions, type TemplateRefreshPreview } from "./templateRefresh"

export interface BobWorkspaceStatus {
  initialized: boolean
  missing: string[]
  present: string[]
  bobDir: string
}

const REQUIRED_FILES = [
  ".bob/mcp.json",
  ".bob/custom_modes.yaml",
  ".bob/review/checklist.json",
  ".bob/review/review-result.schema.json",
  ".bob/review/review-prompt-template.md",
  ".bob/review/examples/review-result.example.json",
  ".bob/skills/project-review-checklist/SKILL.md",
  ".bob/workflows/bazaar-project-rule-review/WORKFLOW.md"
]

const REFRESHABLE_TEMPLATE_FILES = [
  ".bob/workflows/bazaar-project-rule-review/WORKFLOW.md"
]

export async function getBobWorkspaceStatus(workspaceFolder: vscode.WorkspaceFolder, serverName = "bazaar"): Promise<BobWorkspaceStatus> {
  const root = workspaceFolder.uri.fsPath
  const missing: string[] = []
  const present: string[] = []

  for (const relative of REQUIRED_FILES) {
    const absolute = path.join(root, relative)
    if (await exists(absolute)) {
      present.push(relative)
    } else {
      missing.push(relative)
    }
  }

  const workflowPath = path.join(root, ".bob", "workflows", "bazaar-project-rule-review", "WORKFLOW.md")
  if (await exists(workflowPath)) {
    const staleReason = await workflowTemplateStaleReason(workflowPath)
    if (staleReason && !missing.includes(".bob/workflows/bazaar-project-rule-review/WORKFLOW.md")) {
      missing.push(`.bob/workflows/bazaar-project-rule-review/WORKFLOW.md#${staleReason}`)
    }
  }

  const mcpPath = path.join(root, ".bob", "mcp.json")
  if (await exists(mcpPath)) {
    const hasServer = await mcpContainsServer(mcpPath, serverName)
    if (!hasServer && !missing.includes(".bob/mcp.json")) {
      missing.push(`.bob/mcp.json#mcpServers.${serverName}`)
    }
  }

  return {
    initialized: missing.length === 0,
    missing,
    present,
    bobDir: path.join(root, ".bob")
  }
}

export async function initializeBobWorkspaceFromTemplates(options: {
  context: vscode.ExtensionContext
  workspaceFolder: vscode.WorkspaceFolder
  allowedRoots?: string[]
  bzrPath: string
  serverName: string
  textEncoding?: string
}): Promise<BobWorkspaceStatus> {
  const root = options.workspaceFolder.uri.fsPath
  const templateRoot = options.context.asAbsolutePath(path.join("templates", ".bob"))
  const targetRoot = path.join(root, ".bob")

  await copyDirectoryMissingOnly(templateRoot, targetRoot, new Set(["mcp.json.template"]))
  await refreshTemplateFiles(templateRoot, root, { confirmOverwrite: confirmTemplateRefresh })
  await configureWorkspaceMcpServer({
    workspaceFolder: options.workspaceFolder,
    extensionContext: options.context,
    serverName: options.serverName,
    bzrPath: options.bzrPath,
    textEncoding: options.textEncoding,
    allowedRoots: options.allowedRoots
  })

  return getBobWorkspaceStatus(options.workspaceFolder, options.serverName)
}

async function copyDirectoryMissingOnly(sourceDir: string, targetDir: string, skipBasenames: Set<string>): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true })
  const entries = await fs.readdir(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    if (skipBasenames.has(entry.name)) continue

    const sourcePath = path.join(sourceDir, entry.name)
    const targetPath = path.join(targetDir, entry.name)
    if (entry.isDirectory()) {
      await copyDirectoryMissingOnly(sourcePath, targetPath, skipBasenames)
    } else if (entry.isFile()) {
      if (!(await exists(targetPath))) {
        await fs.mkdir(path.dirname(targetPath), { recursive: true })
        await fs.copyFile(sourcePath, targetPath)
      }
    }
  }
}

async function refreshTemplateFiles(templateRoot: string, workspaceRoot: string, options: TemplateRefreshOptions = {}): Promise<void> {
  for (const relative of REFRESHABLE_TEMPLATE_FILES) {
    const source = path.join(templateRoot, relative.replace(/^\.bob[\\/]/, ""))
    const target = path.join(workspaceRoot, relative)
    if (!(await exists(source))) continue
    await refreshTemplateFile(source, target, options)
  }
}

async function confirmTemplateRefresh(preview: TemplateRefreshPreview): Promise<boolean> {
  const document = await vscode.workspace.openTextDocument({ language: "markdown", content: renderTemplateRefreshPreviewMarkdown(preview) })
  await vscode.window.showTextDocument(document, { preview: false })
  const updateLabel = "更新"
  const skipLabel = "スキップ"
  const message = `既存の ${path.basename(preview.targetPath)} をテンプレートで更新します。現在のファイルはバックアップ後に上書きされます。`
  const choice = await vscode.window.showWarningMessage(message, { modal: true }, updateLabel, skipLabel)
  return choice === updateLabel
}

function renderTemplateRefreshPreviewMarkdown(preview: TemplateRefreshPreview): string {
  return [
    "# Bob template refresh preview",
    "",
    `Target: \`${preview.targetPath}\``,
    `Template: \`${preview.sourcePath}\``,
    "",
    "````diff",
    preview.diffPreview,
    "````",
    ""
  ].join("\n")
}

async function workflowTemplateStaleReason(workflowPath: string): Promise<string | undefined> {
  try {
    const text = await fs.readFile(workflowPath, "utf8")
    if (/^workspaceRequired:\s*true\s*$/m.test(text)) return "workspaceRequired-true"
    if (!/^workspaceRequired:\s*false\s*$/m.test(text)) return "workspaceRequired-missing"
    if (!/title:\s*Bazaar プロジェクト規約レビュー/.test(text)) return "template-stale"
    return undefined
  } catch {
    return undefined
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function mcpContainsServer(mcpPath: string, serverName: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(mcpPath, "utf8")
    const parsed = JSON.parse(raw)
    return Boolean(parsed?.mcpServers?.[serverName])
  } catch {
    return false
  }
}
