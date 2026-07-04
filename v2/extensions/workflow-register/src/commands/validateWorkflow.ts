import * as vscode from "vscode"
import { formatWorkflowDiagnostics, validateWorkflowText } from "../core/workflowValidator"
import { WorkflowDiagnosticsReporter } from "./workflowDiagnostics"

export interface ValidateWorkflowCommandOptions {
  sourceId: string
  showMarkdownReport: (title: string, summary: string, lines: string[]) => Promise<void>
  diagnostics?: WorkflowDiagnosticsReporter
}

export async function validateCurrentWorkflow(options: ValidateWorkflowCommandOptions): Promise<void> {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    await vscode.window.showErrorMessage("No active editor is open.")
    return
  }
  const result = validateTextDocument(editor.document, options)
  const errors = result.diagnostics.filter((item) => item.severity === "error").length
  const warnings = result.diagnostics.filter((item) => item.severity === "warning").length
  const summary = `1 workflow file; ${errors} error(s); ${warnings} warning(s).`
  await options.showMarkdownReport("Current Workflow Validation", summary, formatWorkflowDiagnostics(result))
}

export async function validateWorkspaceWorkflows(options: ValidateWorkflowCommandOptions): Promise<void> {
  const files = await vscode.workspace.findFiles(".bob/workflows/*/WORKFLOW.md")
  const lines: string[] = []
  let errors = 0
  let warnings = 0
  options.diagnostics?.clear()
  for (const file of files) {
    const filePath = vscode.workspace.asRelativePath(file, false)
    const text = new TextDecoder("utf-8").decode(await vscode.workspace.fs.readFile(file)).replace(/^\uFEFF/, "")
    const result = validateWorkflowText({ sourceId: options.sourceId, filePath, text, strict: true })
    options.diagnostics?.set(file, result)
    errors += result.diagnostics.filter((item) => item.severity === "error").length
    warnings += result.diagnostics.filter((item) => item.severity === "warning").length
    lines.push(...formatWorkflowDiagnostics(result))
  }
  await options.showMarkdownReport("Workspace Workflow Validation", `${files.length} workflow file(s); ${errors} error(s); ${warnings} warning(s).`, lines.length > 0 ? lines : ["- ok: No workflow diagnostics."])
}

export function validateTextDocument(document: vscode.TextDocument, options: Pick<ValidateWorkflowCommandOptions, "sourceId" | "diagnostics">) {
  const filePath = vscode.workspace.asRelativePath(document.uri, false)
  const result = validateWorkflowText({ sourceId: options.sourceId, filePath, text: document.getText() })
  options.diagnostics?.set(document.uri, result)
  return result
}

export function isWorkflowDocument(document: vscode.TextDocument): boolean {
  const filePath = vscode.workspace.asRelativePath(document.uri, false).replace(/\\/g, "/")
  return filePath.match(/^\.bob\/workflows\/[^/]+\/WORKFLOW\.md$/) !== null
}
