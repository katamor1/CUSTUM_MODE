import * as vscode from "vscode"
import { createMockWorkflowAiProvider } from "../core/mockWorkflowAiProvider"
import { formatWorkflowDiagnosticExplanation, WorkflowAiProvider } from "../core/workflowAiProvider"
import { buildWorkflowRepairContext, formatWorkflowRepairContext } from "../core/workflowRepairContext"
import { formatWorkflowDiagnostics, validateWorkflowText } from "../core/workflowValidator"

export interface ExplainWorkflowDiagnosticsOptions {
  sourceId: string
  showMarkdownReport: (title: string, summary: string, lines: string[]) => Promise<void>
  provider?: WorkflowAiProvider
}

export async function explainWorkflowDiagnostics(options: ExplainWorkflowDiagnosticsOptions): Promise<void> {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    await vscode.window.showErrorMessage("No active editor is open.")
    return
  }
  const filePath = vscode.workspace.asRelativePath(editor.document.uri, false)
  const validation = validateWorkflowText({ sourceId: options.sourceId, filePath, text: editor.document.getText() })
  const context = buildWorkflowRepairContext(filePath, validation)
  const provider = options.provider ?? createMockWorkflowAiProvider()
  const explanation = await Promise.resolve(provider.explainDiagnostics({ filePath, repairContext: context }))
  const errorCount = validation.diagnostics.filter((item) => item.severity === "error").length
  const warningCount = validation.diagnostics.filter((item) => item.severity === "warning").length
  await options.showMarkdownReport("Workflow Diagnostics Explained", `${errorCount} error(s); ${warningCount} warning(s). Provider: ${provider.id}.`, [
    "## Diagnostics",
    "",
    ...formatWorkflowDiagnostics(validation),
    "",
    ...formatWorkflowRepairContext(context),
    "",
    ...formatWorkflowDiagnosticExplanation(explanation)
  ])
}
