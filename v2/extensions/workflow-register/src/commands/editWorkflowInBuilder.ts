import * as vscode from "vscode"
import { loadAuthoringModelFromMarkdown } from "../core/workflowAuthoringLoader"
import { WorkflowBuilderPanel } from "../webview/workflowBuilderPanel"
import { pickWorkflowRootForUri, workflowRelativePath } from "./workspaceRootPicker"

export interface EditWorkflowInBuilderOptions {
  extensionUri: vscode.Uri
  sourceId: string
}

export interface EditWorkflowInBuilderRequest {
  uri?: vscode.Uri
  focusStepId?: string
}

export async function editWorkflowInBuilder(options: EditWorkflowInBuilderOptions, request?: vscode.Uri | EditWorkflowInBuilderRequest): Promise<void> {
  const uri = request instanceof vscode.Uri ? request : request?.uri
  const focusStepId = request instanceof vscode.Uri ? undefined : request?.focusStepId
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri ?? await pickWorkflowFile()
  if (!targetUri) {
    await vscode.window.showErrorMessage("Open or select a WORKFLOW.md file to edit in the GUI builder.")
    return
  }

  const workflowRoot = await pickWorkflowRootForUri(targetUri, "Select workflow workspace")
  if (!workflowRoot) {
    await vscode.window.showErrorMessage("No workspace folder is open.")
    return
  }

  const bytes = await vscode.workspace.fs.readFile(targetUri)
  const text = new TextDecoder().decode(bytes)
  const filePath = workflowRelativePath(targetUri)

  try {
    const loaded = loadAuthoringModelFromMarkdown({ sourceId: options.sourceId, filePath, text })
    WorkflowBuilderPanel.createOrShow({
      extensionUri: options.extensionUri,
      workflowRoot,
      sourceId: options.sourceId,
      mode: "edit",
      editingFilePath: targetUri.fsPath,
      originalText: loaded.originalText,
      initialModel: loaded.model,
      focusStepId
    })
  } catch (error) {
    await vscode.window.showErrorMessage(`Cannot edit workflow in GUI: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function pickWorkflowFile(): Promise<vscode.Uri | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    title: "Select WORKFLOW.md to edit",
    filters: { Markdown: ["md"] }
  })
  return picked?.[0]
}
