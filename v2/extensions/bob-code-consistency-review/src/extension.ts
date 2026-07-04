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
import {
  runApplyAiTraceabilityDraft,
  runCreateReviewInputFromTraceability,
  runOpenTraceabilityPrep,
  runPrepareAiTraceabilityDraft,
  runValidateTraceabilityCatalog
} from "./traceabilityCommands"
import { registerWorkflowProviders } from "./workflowProviderRegistration"

/**
 * Activates the Bob code-consistency review extension and registers command plus workflow entry points.
 *
 * @param context VS Code extension context used for command registration and workspace initialization resources.
 * @returns Nothing.
 */
export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
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

  registerWorkflowProviders({
    initializeWorkspace: (options) => runInitializeWorkspace(context, options),
    createReviewInput: runCreateReviewInput,
    prepareAiReviewInputDraft: runPrepareAiReviewInputDraft,
    applyAiReviewInputDraft: runApplyAiReviewInputDraft,
    prepareAiTraceabilityDraft: runPrepareAiTraceabilityDraft,
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
  }).catch((error) => console.warn("Bob コード整合ワークフロー provider の登録に失敗しました", error))
}

/**
 * Deactivates the Bob code-consistency review extension.
 *
 * @returns Nothing.
 */
export function deactivate(): void {
  // No background resources are held by this extension.
}
