import * as vscode from "vscode"
import { activate as activateCore, deactivate, WorkflowRegisterApi } from "./extension"
import { createWorkflowFromTemplate } from "./commands/createWorkflow"
import { designWorkflowWithAi } from "./commands/designWorkflowWithAi"
import { explainWorkflowDiagnostics } from "./commands/explainWorkflowDiagnostics"
import { improveWorkflowWithAi } from "./commands/improveWorkflowWithAi"
import { inspectRunDiagnostics } from "./commands/inspectRunDiagnostics"
import { isWorkflowDocument, validateCurrentWorkflow, validateTextDocument, validateWorkspaceWorkflows } from "./commands/validateWorkflow"
import { createConfiguredWorkflowAiProvider } from "./core/workflowAiProviderFactory"
import { WorkflowDiagnosticsReporter } from "./commands/workflowDiagnostics"

export { deactivate }

export function activate(context: vscode.ExtensionContext): WorkflowRegisterApi {
  const api = activateCore(context)
  const diagnostics = new WorkflowDiagnosticsReporter()
  const config = () => vscode.workspace.getConfiguration("workflowRegister")
  const sourceId = () => config().get<string>("sourceId", "workflow-register")
  const aiProvider = () => createConfiguredWorkflowAiProvider({
    command: config().get<string>("aiProviderCommand", ""),
    executeCommand: (command, input) => vscode.commands.executeCommand(command, input)
  })
  context.subscriptions.push(
    diagnostics,
    vscode.commands.registerCommand("workflowRegister.validateCurrentWorkflow", () => validateCurrentWorkflow({ sourceId: sourceId(), showMarkdownReport, diagnostics })),
    vscode.commands.registerCommand("workflowRegister.validateWorkspaceWorkflows", () => validateWorkspaceWorkflows({ sourceId: sourceId(), showMarkdownReport, diagnostics })),
    vscode.commands.registerCommand("workflowRegister.createWorkflowFromTemplate", () => createWorkflowFromTemplate({ sourceId: sourceId(), showMarkdownReport })),
    vscode.commands.registerCommand("workflowRegister.inspectRunDiagnostics", () => inspectRunDiagnostics({ showMarkdownReport })),
    vscode.commands.registerCommand("workflowRegister.designWorkflowWithAi", () => designWorkflowWithAi({ sourceId: sourceId(), showMarkdownReport, provider: aiProvider() })),
    vscode.commands.registerCommand("workflowRegister.improveWorkflowWithAi", () => improveWorkflowWithAi({ sourceId: sourceId(), showMarkdownReport, provider: aiProvider() })),
    vscode.commands.registerCommand("workflowRegister.explainWorkflowDiagnostics", () => explainWorkflowDiagnostics({ sourceId: sourceId(), showMarkdownReport, provider: aiProvider() })),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (isWorkflowDocument(document)) validateTextDocument(document, { sourceId: sourceId(), diagnostics })
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && isWorkflowDocument(editor.document)) validateTextDocument(editor.document, { sourceId: sourceId(), diagnostics })
    })
  )
  for (const document of vscode.workspace.textDocuments) if (isWorkflowDocument(document)) validateTextDocument(document, { sourceId: sourceId(), diagnostics })
  return api
}

async function showMarkdownReport(title: string, summary: string, lines: string[]): Promise<void> {
  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: [`# ${title}`, "", summary, "", ...lines].join("\n")
  })
  await vscode.window.showTextDocument(document, { preview: false })
}
