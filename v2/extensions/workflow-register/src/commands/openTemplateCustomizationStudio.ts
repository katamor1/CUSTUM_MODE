import * as vscode from "vscode"
import { TemplateCustomizationStudioPanel } from "../webview/templateCustomizationStudioPanel"

export interface OpenTemplateCustomizationStudioOptions {
  extensionUri: vscode.Uri
  workspaceRoot: string
}

export async function openTemplateCustomizationStudio(options: OpenTemplateCustomizationStudioOptions): Promise<void> {
  await TemplateCustomizationStudioPanel.createOrShow(options)
}
