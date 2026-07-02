import * as vscode from "vscode"

export interface BobWorkflowApi {
  registerSource?: (id: string, name?: string) => unknown
}

export interface BobSourceLike {
  registerWorkflow?: (workflow: unknown) => unknown
  log?: (message: string) => unknown
  deactivate?: () => unknown
}

export async function loadBobApi(extensionId: string): Promise<{ found: boolean; active: boolean; activationError: string; exportsValue: unknown }> {
  const ext = vscode.extensions.getExtension<unknown>(extensionId)
  let exportsValue: unknown
  let activationError = "none"
  if (ext) {
    try {
      exportsValue = ext.isActive ? ext.exports : await ext.activate()
    } catch (error) {
      activationError = error instanceof Error ? error.message : String(error)
    }
  }
  return { found: Boolean(ext), active: Boolean(ext?.isActive), activationError, exportsValue }
}

export function asSource(value: unknown): BobSourceLike | undefined {
  return typeof value === "object" && value !== null ? value as BobSourceLike : undefined
}
