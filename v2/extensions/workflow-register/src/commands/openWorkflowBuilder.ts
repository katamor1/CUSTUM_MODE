import * as vscode from "vscode"
import { WorkflowBuilderPanel } from "../webview/workflowBuilderPanel"
import { pickWorkflowRoot } from "./workspaceRootPicker"

export interface OpenWorkflowBuilderOptions {
  extensionUri: vscode.Uri
  sourceId: string
}

export async function openWorkflowBuilder(options: OpenWorkflowBuilderOptions): Promise<void> {
  const workflowRoot = await pickWorkflowRoot("Select workflow workspace")
  if (!workflowRoot) {
    await vscode.window.showErrorMessage("No workspace folder is open.")
    return
  }
  WorkflowBuilderPanel.createOrShow({ extensionUri: options.extensionUri, workflowRoot, sourceId: options.sourceId })
}
