import * as vscode from "vscode"
import {
  runApplyAiReviewInputDraft,
  runCreateReviewInput,
  runExplainReviewInputDiagnostics,
  runPrepareAiReviewInputDraft,
  runRepairReviewInput
} from "./commands/reviewInputCommands"
import { runInitializeWorkspace } from "./commands/workspaceCommands"
import {
  runCaptureBobOutput,
  runPreprocess,
  runTriage,
  runValidateOutput
} from "./reviewExecutionCommands"
import { startRetryRegistrationController } from "./retryRegistrationController"
import {
  runApplyAiTraceabilityDraft,
  runCaptureAiTraceabilityDraft,
  runCreateReviewInputFromTraceability,
  runOpenTraceabilityPrep,
  runPrepareAiTraceabilityDraft,
  runValidateTraceabilityCatalog
} from "./traceabilityCommands"
import { openConsistencyHumanTriageGui } from "./webview/consistencyHumanTriage"
import { openConsistencyResultCaptureGui } from "./webview/consistencyResultCapture"
import { openConsistencyReviewWizard } from "./webview/consistencyReviewWizard"
import {
  registerWorkflowProviders,
  type CodeConsistencyWorkflowHandlers,
  type WorkflowRegisterApi
} from "./workflowProviderRegistration"

const WORKFLOW_REGISTER_EXTENSION_ID = "local.workflow-register"
const WORKFLOW_PROVIDER_RETRY_DELAYS_MS = [1000, 3000, 10000] as const

/** Bob コード整合プレレビュー拡張を有効化する。 */
export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "bobCodeConsistency.openReviewWizard",
      () => openConsistencyReviewWizard(context)
    ),
    vscode.commands.registerCommand(
      "bobCodeConsistency.openResultCaptureGui",
      () => openConsistencyResultCaptureGui(context)
    ),
    vscode.commands.registerCommand(
      "bobCodeConsistency.openHumanTriageGui",
      () => openConsistencyHumanTriageGui(context)
    ),
    vscode.commands.registerCommand(
      "bobCodeConsistency.initializeWorkspace",
      (options?: unknown) => runInitializeWorkspace(context, options)
    ),
    vscode.commands.registerCommand(
      "bobCodeConsistency.createReviewInput",
      (options?: unknown) => runCreateReviewInput(options)
    ),
    vscode.commands.registerCommand(
      "bobCodeConsistency.prepareAiReviewInputDraft",
      (options?: unknown) => runPrepareAiReviewInputDraft(options)
    ),
    vscode.commands.registerCommand(
      "bobCodeConsistency.applyAiReviewInputDraft",
      (textOrOptions?: unknown) => runApplyAiReviewInputDraft(textOrOptions)
    ),
    vscode.commands.registerCommand(
      "bobCodeConsistency.prepareAiTraceabilityDraft",
      (options?: unknown) => runPrepareAiTraceabilityDraft(options)
    ),
    vscode.commands.registerCommand(
      "bobCodeConsistency.applyAiTraceabilityDraft",
      (textOrOptions?: unknown) => runApplyAiTraceabilityDraft(textOrOptions)
    ),
    vscode.commands.registerCommand(
      "bobCodeConsistency.captureAiTraceabilityDraft",
      (textOrOptions?: unknown) => runCaptureAiTraceabilityDraft(textOrOptions)
    ),
    vscode.commands.registerCommand(
      "bobCodeConsistency.openTraceabilityPrep",
      (options?: unknown) => runOpenTraceabilityPrep(context, options)
    ),
    vscode.commands.registerCommand(
      "bobCodeConsistency.validateTraceabilityCatalog",
      (options?: unknown) => runValidateTraceabilityCatalog(options)
    ),
    vscode.commands.registerCommand(
      "bobCodeConsistency.createReviewInputFromTraceability",
      (options?: unknown) => runCreateReviewInputFromTraceability(options)
    ),
    vscode.commands.registerCommand(
      "bobCodeConsistency.repairReviewInput",
      (options?: unknown) => runRepairReviewInput(options)
    ),
    vscode.commands.registerCommand(
      "bobCodeConsistency.explainReviewInputDiagnostics",
      (options?: unknown) => runExplainReviewInputDiagnostics(options)
    ),
    vscode.commands.registerCommand("bobCodeConsistency.preprocess", (options?: unknown) => runPreprocess(options)),
    vscode.commands.registerCommand(
      "bobCodeConsistency.captureBobOutput",
      (textOrOptions?: unknown) => runCaptureBobOutput(textOrOptions)
    ),
    vscode.commands.registerCommand("bobCodeConsistency.validateOutput", (options?: unknown) => runValidateOutput(options)),
    vscode.commands.registerCommand("bobCodeConsistency.triage", (options?: unknown) => runTriage(options))
  )

  registerWorkflowProvidersWithRetry(context, {
    initializeWorkspace: (options) => runInitializeWorkspace(context, options),
    createReviewInput: runCreateReviewInput,
    prepareAiReviewInputDraft: runPrepareAiReviewInputDraft,
    applyAiReviewInputDraft: runApplyAiReviewInputDraft,
    prepareAiTraceabilityDraft: runPrepareAiTraceabilityDraft,
    captureAiTraceabilityDraft: runCaptureAiTraceabilityDraft,
    applyAiTraceabilityDraft: runApplyAiTraceabilityDraft,
    openTraceabilityPrep: (options) => runOpenTraceabilityPrep(context, options),
    validateTraceabilityCatalog: runValidateTraceabilityCatalog,
    createReviewInputFromTraceability: runCreateReviewInputFromTraceability,
    repairReviewInput: runRepairReviewInput,
    explainReviewInputDiagnostics: runExplainReviewInputDiagnostics,
    preprocess: runPreprocess,
    captureBobOutput: runCaptureBobOutput,
    validateOutput: runValidateOutput,
    triage: runTriage
  })
}

/** workflow-registerの遅延導入・再起動へ追随してproviderを再登録する。 */
export function registerWorkflowProvidersWithRetry(
  context: vscode.ExtensionContext,
  handlers: CodeConsistencyWorkflowHandlers
): void {
  startRetryRegistrationController<WorkflowRegisterApi>({
    retryDelaysMs: WORKFLOW_PROVIDER_RETRY_DELAYS_MS,
    register: () => registerWorkflowProviders(handlers),
    currentApi: currentWorkflowRegisterApi,
    subscribeChanges: (listener) => vscode.extensions.onDidChange(listener),
    own: (...registrations) => context.subscriptions.push(...registrations),
    reportError: (error) => console.warn("Bob コード整合ワークフロー provider の登録に失敗しました", error)
  })
}

function currentWorkflowRegisterApi(): WorkflowRegisterApi | undefined {
  const extension = vscode.extensions.getExtension<WorkflowRegisterApi>(WORKFLOW_REGISTER_EXTENSION_ID)
  return extension?.isActive ? extension.exports : undefined
}

/** Bob コード整合プレレビュー拡張を無効化する。 */
export function deactivate(): void {
  // retry timer、provider 登録、listener は extension context subscriptions が破棄する。
}
