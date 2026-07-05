import * as path from "path"
import * as vscode from "vscode"
import { activate as activateCore, deactivate, WorkflowRegisterApi } from "./extension"
import { createWorkflowFromTemplate } from "./commands/createWorkflow"
import { designWorkflowWithAi } from "./commands/designWorkflowWithAi"
import { editWorkflowInBuilder } from "./commands/editWorkflowInBuilder"
import { explainWorkflowDiagnostics } from "./commands/explainWorkflowDiagnostics"
import { improveWorkflowWithAi } from "./commands/improveWorkflowWithAi"
import { inspectRunDiagnostics } from "./commands/inspectRunDiagnostics"
import {
  collectEvidenceCommand,
  generateCampaignSummaryCommand,
  loadProcessInputCommand,
  validateCatalogCommand,
  validateReviewResultCommand,
  writeProcessRecordCommand
} from "./commands/processCommands"
import {
  checkReadinessCommand,
  generateWorkflowCommand,
  validateCustomizationCommand,
  validateLibraryCommand,
  validateProjectProfileCommand
} from "./commands/templateCommands"
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
import { openTemplateCustomizationStudio } from "./commands/openTemplateCustomizationStudio"
import { createConfiguredWorkflowAiProvider } from "./core/workflowAiProviderFactory"
import { OperationHubProvider } from "./gui/operationHubProvider"
import { WorkflowDiagnosticsReporter } from "./commands/workflowDiagnostics"
import { showMarkdownReport } from "./reports"

export { deactivate }

/**
 * authoring、diagnostics、run-control、builder command を含む workflow-register 拡張を有効化する。
 *
 * 追加 command も既存 command ID と同じ registration service を通し、runtime と authoring の入口を分離しない。
 *
 * @param context command、view、document listener の登録に使う VS Code extension context。
 * @returns core activation path が返す public workflow-register API。
 */
export function activate(context: vscode.ExtensionContext): WorkflowRegisterApi {
  const api = activateCore(context)
  const diagnostics = new WorkflowDiagnosticsReporter()
  const runControlView = new WorkflowRunControlView()
  const operationHub = new OperationHubProvider({ api, extensionUri: context.extensionUri })
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
  const processCommandOptions = (input: unknown) => ({ workspaceRoot: workspaceRootFromCommandInput(input, "bobProcess") })
  const templateCommandOptions = (input: unknown) => ({ workspaceRoot: workspaceRootFromCommandInput(input, "bobTemplate") })
  context.subscriptions.push(
    diagnostics,
    runControlView,
    operationHub,
    vscode.window.registerTreeDataProvider("workflowRegister.runs", runControlView),
    vscode.window.registerWebviewViewProvider("workflowRegister.operationHub", operationHub),
    vscode.commands.registerCommand("workflowRegister.openOperationHub", () => operationHub.open()),
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
    vscode.commands.registerCommand("bobProcess.validateCatalog", (input) => validateCatalogCommand(input, processCommandOptions(input))),
    vscode.commands.registerCommand("bobProcess.loadProcessInput", (input) => loadProcessInputCommand(input, processCommandOptions(input))),
    vscode.commands.registerCommand("bobProcess.collectEvidence", (input) => collectEvidenceCommand(input, processCommandOptions(input))),
    vscode.commands.registerCommand("bobProcess.validateReviewResult", (input) => validateReviewResultCommand(input, processCommandOptions(input))),
    vscode.commands.registerCommand("bobProcess.writeProcessRecord", (input) => writeProcessRecordCommand(input, processCommandOptions(input))),
    vscode.commands.registerCommand("bobProcess.generateCampaignSummary", (input) => generateCampaignSummaryCommand(input, processCommandOptions(input))),
    vscode.commands.registerCommand("bobTemplate.validateLibrary", (input) => validateLibraryCommand(input, templateCommandOptions(input))),
    vscode.commands.registerCommand("bobTemplate.validateProjectProfile", (input) => validateProjectProfileCommand(input, templateCommandOptions(input))),
    vscode.commands.registerCommand("bobTemplate.validateCustomization", (input) => validateCustomizationCommand(input, templateCommandOptions(input))),
    vscode.commands.registerCommand("bobTemplate.generateWorkflow", (input) => generateWorkflowCommand(input, templateCommandOptions(input))),
    vscode.commands.registerCommand("bobTemplate.checkReadiness", (input) => checkReadinessCommand(input, templateCommandOptions(input))),
    vscode.commands.registerCommand(
      "bobTemplate.openCustomizationStudio",
      () => openTemplateCustomizationStudio({ extensionUri: context.extensionUri, workspaceRoot: requireTemplateWorkspaceRoot() })
    ),
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

function workspaceRootFromCommandInput(input: unknown, commandGroup: "bobProcess" | "bobTemplate"): string {
  const requested = commandInputWorkspaceRoot(input)
  if (requested) return validateOpenWorkspaceRoot(requested, commandGroup)
  return requireWorkspaceRoot(commandGroup)
}

function commandInputWorkspaceRoot(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined
  for (const key of ["workspaceRoot", "workflowRoot"] as const) {
    const value = input[key]
    if (typeof value === "string" && value.trim()) return value
  }
  return undefined
}

function validateOpenWorkspaceRoot(value: string, commandGroup: "bobProcess" | "bobTemplate"): string {
  const folders = vscode.workspace.workspaceFolders ?? []
  if (folders.length === 0) {
    throw new Error(`${commandGroup} commands require an open workspace folder`)
  }
  const resolved = path.resolve(value)
  if (!folders.some((folder) => isInsideOrSame(folder.uri.fsPath, resolved))) {
    throw new Error(`${commandGroup} workspaceRoot must be inside an open workspace folder: ${value}`)
  }
  return resolved
}

function requireWorkspaceRoot(commandGroup: "bobProcess" | "bobTemplate" = "bobProcess"): string {
  const folders = vscode.workspace.workspaceFolders ?? []
  const folder = folders[0]
  if (!folder) {
    throw new Error(`${commandGroup} commands require an open workspace folder`)
  }
  if (folders.length > 1) {
    throw new Error(`${commandGroup} commands require workspaceRoot when multiple workspace folders are open`)
  }
  return folder.uri.fsPath
}

function requireTemplateWorkspaceRoot(): string {
  return requireWorkspaceRoot("bobTemplate")
}

function isInsideOrSame(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
