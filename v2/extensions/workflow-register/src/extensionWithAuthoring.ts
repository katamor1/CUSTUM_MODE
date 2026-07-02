import * as vscode from "vscode"
import { activate as activateCore, deactivate, WorkflowRegisterApi } from "./extension"
import { createWorkflowFromTemplate } from "./commands/createWorkflow"
import { designWorkflowWithAi } from "./commands/designWorkflowWithAi"
import { editWorkflowInBuilder } from "./commands/editWorkflowInBuilder"
import { explainWorkflowDiagnostics } from "./commands/explainWorkflowDiagnostics"
import { improveWorkflowWithAi } from "./commands/improveWorkflowWithAi"
import { inspectRunDiagnostics } from "./commands/inspectRunDiagnostics"
import {
  inspectRunControl,
  pauseAfterCurrentStep,
  pauseBeforeNextAiCall,
  pauseCurrentRun,
  resumePausedRun
} from "./commands/runControl"
import { WorkflowRunControlView } from "./commands/runControlView"
import {
  acceptAndRunNextStep,
  acceptCurrentStep,
  inspectCurrentStep,
  openCurrentStepInBuilder
} from "./commands/stepReview"
import {
  isWorkflowDocument,
  validateCurrentWorkflow,
  validateTextDocument,
  validateWorkspaceWorkflows
} from "./commands/validateWorkflow"
import { openWorkflowBuilder } from "./commands/openWorkflowBuilder"
import { createConfiguredWorkflowAiProvider } from "./core/workflowAiProviderFactory"
import { WorkflowDiagnosticsReporter } from "./commands/workflowDiagnostics"
import { showMarkdownReport } from "./reports"

export { deactivate }

export function activate(context: vscode.ExtensionContext): WorkflowRegisterApi {
  const api = activateCore(context)
  const diagnostics = new WorkflowDiagnosticsReporter()
  const runControlView = new WorkflowRunControlView()
  runControlView.start()
  const config = () => vscode.workspace.getConfiguration("workflowRegister")
  const sourceId = () => config().get<string>("sourceId", "workflow-register")
  const aiProvider = () => createConfiguredWorkflowAiProvider({
    command: config().get<string>("aiProviderCommand", ""),
    executeCommand: (command, input) => vscode.commands.executeCommand(command, input)
  })
  const stepReviewOptions = { showMarkdownReport }
  const stepReviewBuilderOptions = { showMarkdownReport, sourceId: sourceId(), extensionUri: context.extensionUri }
  const runControlOptions = { showMarkdownReport }
  context.subscriptions.push(
    diagnostics,
    runControlView,
    vscode.window.registerTreeDataProvider("workflowRegister.runs", runControlView),
    vscode.commands.registerCommand("workflowRegister.refreshRunsView", () => runControlView.refresh()),
    vscode.commands.registerCommand(
      "workflowRegister.validateCurrentWorkflow",
      () => validateCurrentWorkflow({ sourceId: sourceId(), showMarkdownReport, diagnostics })
    ),
    vscode.commands.registerCommand(
      "workflowRegister.validateWorkspaceWorkflows",
      () => validateWorkspaceWorkflows({ sourceId: sourceId(), showMarkdownReport, diagnostics })
    ),
    vscode.commands.registerCommand(
      "workflowRegister.createWorkflowFromTemplate",
      () => createWorkflowFromTemplate({ sourceId: sourceId(), showMarkdownReport })
    ),
    vscode.commands.registerCommand(
      "workflowRegister.openWorkflowBuilder",
      () => openWorkflowBuilder({ sourceId: sourceId(), extensionUri: context.extensionUri })
    ),
    vscode.commands.registerCommand(
      "workflowRegister.editWorkflowInBuilder",
      (uri?: vscode.Uri) => editWorkflowInBuilder({ sourceId: sourceId(), extensionUri: context.extensionUri }, uri)
    ),
    vscode.commands.registerCommand("workflowRegister.inspectRunDiagnostics", () => inspectRunDiagnostics({ showMarkdownReport })),
    vscode.commands.registerCommand("workflowRegister.acceptCurrentStep", (runId?: string) => acceptCurrentStep(stepReviewOptions, runId)),
    vscode.commands.registerCommand("workflowRegister.acceptAndRunNextStep", (runId?: string) => acceptAndRunNextStep(stepReviewOptions, runId)),
    vscode.commands.registerCommand("workflowRegister.inspectCurrentStep", (runId?: string) => inspectCurrentStep(stepReviewOptions, runId)),
    vscode.commands.registerCommand("workflowRegister.pauseCurrentRun", (runId?: string) => pauseCurrentRun(runControlOptions, runId)),
    vscode.commands.registerCommand("workflowRegister.pauseAfterCurrentStep", (runId?: string) => pauseAfterCurrentStep(runControlOptions, runId)),
    vscode.commands.registerCommand("workflowRegister.pauseBeforeNextAiCall", (runId?: string) => pauseBeforeNextAiCall(runControlOptions, runId)),
    vscode.commands.registerCommand("workflowRegister.resumePausedRun", (runId?: string) => resumePausedRun(runControlOptions, runId)),
    vscode.commands.registerCommand("workflowRegister.inspectRunControl", (runId?: string) => inspectRunControl(runControlOptions, runId)),
    vscode.commands.registerCommand(
      "workflowRegister.openCurrentStepInBuilder",
      (runId?: string) => openCurrentStepInBuilder(stepReviewBuilderOptions, runId)
    ),
    vscode.commands.registerCommand(
      "workflowRegister.designWorkflowWithAi",
      () => designWorkflowWithAi({ sourceId: sourceId(), showMarkdownReport, provider: aiProvider() })
    ),
    vscode.commands.registerCommand(
      "workflowRegister.improveWorkflowWithAi",
      () => improveWorkflowWithAi({ sourceId: sourceId(), showMarkdownReport, provider: aiProvider() })
    ),
    vscode.commands.registerCommand(
      "workflowRegister.explainWorkflowDiagnostics",
      () => explainWorkflowDiagnostics({ sourceId: sourceId(), showMarkdownReport, provider: aiProvider() })
    ),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (isWorkflowDocument(document)) validateTextDocument(document, { sourceId: sourceId(), diagnostics })
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && isWorkflowDocument(editor.document)) validateTextDocument(editor.document, { sourceId: sourceId(), diagnostics })
    })
  )
  for (const document of vscode.workspace.textDocuments) {
    if (isWorkflowDocument(document)) validateTextDocument(document, { sourceId: sourceId(), diagnostics })
  }
  return api
}
