import * as vscode from "vscode"
import { resolveBzrPath } from "../bazaar/bzrPathTrust"
import { configureWorkspaceMcpServer } from "../mcp/mcpConfig"
import { initializeProjectRules } from "../projectRules/io"
import { resolveBobWorkspaceFolder } from "./workspaceResolver"

/**
 * Writes the Bazaar MCP server configuration for the selected Bob workspace.
 *
 * @param context VS Code extension context used to locate extension resources for MCP configuration.
 * @returns A promise that resolves after configuration is saved or the user cancels folder selection.
 */
export async function configureMcp(context: vscode.ExtensionContext): Promise<void> {
  const folder = await pickBobWorkspaceFolder(undefined, true)
  if (!folder) return

  const config = vscode.workspace.getConfiguration("bobBazaar")
  const bzrPath = resolveBzrPath(config, vscode.workspace.isTrusted)
  const textEncoding = config.get<string>("textEncoding", "auto")
  const serverName = config.get<string>("mcpServerName", "bazaar")

  const result = await configureWorkspaceMcpServer({
    workspaceFolder: folder,
    extensionContext: context,
    serverName,
    bzrPath,
    textEncoding
  })

  await vscode.window.showInformationMessage(
    `Bob MCP サーバー '${result.serverName}' を ${result.configPath} に設定しました。すでに起動中の場合は Bob MCP サーバーを Refresh / Restart してください。`
  )
}

/**
 * Initializes project review rule files in the selected Bob workspace.
 *
 * @returns A promise that resolves after the rule scaffold is created or the user cancels folder selection.
 */
export async function initProjectRules(): Promise<void> {
  const folder = await pickBobWorkspaceFolder(undefined, true)
  if (!folder) return

  const paths = await initializeProjectRules(folder.uri.fsPath)
  await vscode.window.showInformationMessage(`プロジェクトレビュー規約を初期化しました: ${paths.reviewDir}`)

  const checklistDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(paths.checklistPath))
  await vscode.window.showTextDocument(checklistDoc, { preview: false })
}

/**
 * Resolves the Bob workspace folder from workflow input or an interactive picker.
 *
 * @param workflowRoot Optional workspace root path supplied by workflow-register.
 * @param allowPick Whether to show an interactive picker when the root is not supplied.
 * @returns The selected workspace folder, or undefined when no folder is available.
 */
async function pickBobWorkspaceFolder(workflowRoot?: string, allowPick = true): Promise<vscode.WorkspaceFolder | undefined> {
  return resolveBobWorkspaceFolder({ workflowRoot, allowPick, title: "Bob ワークスペースを選択" })
}
