import * as vscode from "vscode"
import { notifyInfo, requireBobWorkspaceRoot, stringOption } from "../extensionCommandOptions"
import { initializeCodeConsistencyWorkspace } from "../workspaceInitializer"
import { optionRecord } from "../workflowProviderRegistration"

/**
 * Initializes workflow definitions and review-input scaffolding for the selected workspace.
 *
 * @param context VS Code extension context used to resolve packaged templates.
 * @param options Optional command or workflow options for workspace and output paths.
 * @returns Workspace initialization result suitable for command output or workflow chaining.
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
