import * as vscode from "vscode"
import { notifyInfo, requireBobWorkspaceRoot, stringOption } from "../extensionCommandOptions"
import { initializeCodeConsistencyWorkspace } from "../workspaceInitializer"
import { optionRecord } from "../workflowProviderRegistration"

/**
 * 選択した workspace に workflow definition と review-input scaffold を初期化する。
 *
 * 同梱 template を workspace 内へ展開し、既存 workflow file は initializer 側で backup する。
 *
 * @param context package 済み template を解決する VS Code extension context。
 * @param options workspace と出力 path を上書きし得る command / workflow options。
 * @returns command output または workflow chaining に使える workspace initialization result。
 */
export async function runInitializeWorkspace(context: vscode.ExtensionContext, options?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(options)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const reviewInputPath = stringOption(record, "reviewInputPath") ?? config.get<string>("reviewInputPath", "review-input.yaml")
  const result = await initializeCodeConsistencyWorkspace({ context, workspaceRoot, reviewInputPath })
  const suffix = result.backupPath ? `\n既存 workflow ファイルのバックアップ: ${result.backupPath}` : ""
  notifyInfo(`${result.message}${suffix}`)
  return result
}
