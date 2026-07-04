import * as vscode from "vscode"
import { resolveBzrPath } from "../bazaar/bzrPathTrust"
import { configureWorkspaceMcpServer } from "../mcp/mcpConfig"
import { initializeProjectRules } from "../projectRules/io"
import { resolveBazaarWorkspaceFolder, resolveBobWorkspaceFolder } from "./workspaceResolver"

/**
 * 選択した Bob workspace に Bazaar MCP server 設定を書き込む。
 *
 * allowedRoots と bzrPath は外部コマンド境界に直結するため、GUI 選択と信頼済み設定からだけ組み立てる。
 *
 * @param context MCP 設定で使う拡張リソース解決用の VS Code extension context。
 * @returns 設定保存または folder 選択 cancel 後に解決する Promise。
 */
export async function configureMcp(context: vscode.ExtensionContext): Promise<void> {
  const folder = await pickBobWorkspaceFolder(undefined, true)
  if (!folder) return

  const config = vscode.workspace.getConfiguration("bobBazaar")
  const bzrPath = resolveBzrPath(config, vscode.workspace.isTrusted)
  const textEncoding = config.get<string>("textEncoding", "auto")
  const serverName = config.get<string>("mcpServerName", "bazaar")
  const bazaarFolder = await resolveBazaarWorkspaceFolder({ workflowRoot: folder.uri.fsPath, allowPick: false })

  const result = await configureWorkspaceMcpServer({
    workspaceFolder: folder,
    extensionContext: context,
    serverName,
    bzrPath,
    textEncoding,
    allowedRoots: bazaarFolder ? [bazaarFolder.uri.fsPath] : undefined
  })

  await vscode.window.showInformationMessage(
    `Bob MCP サーバー '${result.serverName}' を ${result.configPath} に設定しました。すでに起動中の場合は Bob MCP サーバーを Refresh / Restart してください。`
  )
}

/**
 * 選択した Bob workspace に project review rule file を初期化する。
 *
 * 生成 file は以後 Bob output validation の契約になるため、既定 template を workspace 内へ配置する。
 *
 * @returns scaffold 作成または folder 選択 cancel 後に解決する Promise。
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
 * workflow input または interactive picker から Bob workspace folder を解決する。
 *
 * @param workflowRoot workflow-register から渡される workspace root path。
 * @param allowPick root がない場合に interactive picker を表示するか。
 * @returns 選択された workspace folder。利用できない場合は undefined。
 */
async function pickBobWorkspaceFolder(workflowRoot?: string, allowPick = true): Promise<vscode.WorkspaceFolder | undefined> {
  return resolveBobWorkspaceFolder({ workflowRoot, allowPick, title: "Bob ワークスペースを選択" })
}
