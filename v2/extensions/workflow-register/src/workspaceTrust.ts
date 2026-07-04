import * as vscode from "vscode"
import { workspaceTrustError } from "./core/workspaceTrust"

export interface RequireTrustedWorkspaceOptions {
  showWarning?: boolean
}

export async function requireTrustedWorkspace(action: string, options: RequireTrustedWorkspaceOptions = {}): Promise<string | undefined> {
  if (vscode.workspace.isTrusted) return undefined
  const message = workspaceTrustError(action)
  if (options.showWarning !== false) await vscode.window.showWarningMessage(message)
  return message
}

export function requireTrustedCommandExecution(action: string): void {
  if (!vscode.workspace.isTrusted) throw new Error(workspaceTrustError(action))
}
