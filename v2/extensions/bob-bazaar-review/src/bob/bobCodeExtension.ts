import * as vscode from "vscode"

export const BOB_CODE_EXTENSION_ID = "IBM.bob-code"

export function isBobCodeExtensionAvailable(): boolean {
  return Boolean(vscode.extensions.getExtension(BOB_CODE_EXTENSION_ID))
}
