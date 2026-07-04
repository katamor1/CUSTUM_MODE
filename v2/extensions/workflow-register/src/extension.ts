import * as vscode from "vscode"
import type { ActionProvider } from "./core/actionRegistry"
import type { AgentProvider, CoreWorkflowDefinition } from "./core/model"
import type { ResultSinkRegistry } from "./core/resultSinkRegistry"
import { WorkflowRegisterService } from "./workflowRegisterService"
import type { StepCompletionOptions } from "./workflowRegisterService"

/**
 * Public API exported by the workflow-register extension for other Bob extensions.
 */
export interface WorkflowRegisterApi {
  /**
   * Registers a workflow action provider that can execute custom action steps.
   *
   * @param provider Action provider implementation to expose to the workflow runtime.
   * @returns Nothing.
   */
  registerActionProvider: (provider: ActionProvider) => void
  /**
   * Registers an agent provider that can execute agent-backed workflow steps.
   *
   * @param provider Agent provider implementation to expose to the workflow runtime.
   * @returns Nothing.
   */
  registerAgentProvider: (provider: AgentProvider) => void
  /**
   * Registers a result sink handler for persisting or forwarding workflow outputs.
   *
   * @param type Result sink type identifier used by workflow definitions.
   * @param handler Handler invoked when a workflow step emits a matching result sink payload.
   * @returns Nothing.
   */
  registerResultSink: (type: string, handler: Parameters<ResultSinkRegistry["register"]>[1]) => void
  /**
   * Lists the workflow definitions currently known to the registration service.
   *
   * @returns Registered core workflow definitions.
   */
  listWorkflows: () => CoreWorkflowDefinition[]
  /**
   * Runs a registered workflow, optionally passing workflow inputs.
   *
   * @param workflowId Optional workflow identifier. When omitted, the user may be prompted to choose one.
   * @param inputs Optional workflow input values keyed by input id.
   * @returns The workflow execution result returned by the runtime.
   */
  runWorkflow: (workflowId?: string, inputs?: Record<string, unknown>) => Promise<unknown>
  /**
   * Runs a single step from a registered workflow.
   *
   * @param workflowId Optional workflow identifier. When omitted, the user may be prompted to choose one.
   * @param stepId Optional step identifier. When omitted, the user may be prompted to choose one.
   * @param inputs Optional workflow input values keyed by input id.
   * @returns The step execution result returned by the runtime.
   */
  runWorkflowStep: (workflowId?: string, stepId?: string, inputs?: Record<string, unknown>) => Promise<unknown>
  /**
   * Continues a workflow run by executing its next runnable step.
   *
   * @param runId Optional run identifier. When omitted, the active or selectable run is used.
   * @returns The next-step execution result returned by the runtime.
   */
  runNextStep: (runId?: string) => Promise<unknown>
  /**
   * Approves a pending branch checkpoint and extends the loop allowance.
   *
   * @param runId Optional run identifier. When omitted, the active or selectable run is used.
   * @returns The updated workflow run.
   */
  approveBranchCheckpoint: (runId?: string) => Promise<unknown>
  /**
   * Aborts a workflow run that is waiting at a branch checkpoint.
   *
   * @param runId Optional run identifier. When omitted, the active or selectable run is used.
   * @returns The updated workflow run.
   */
  abortBranchCheckpoint: (runId?: string) => Promise<unknown>
  /**
   * Shows branching loop/checkpoint/history diagnostics for a workflow run.
   *
   * @param runId Optional run identifier. When omitted, the active or selectable run is used.
   * @returns The inspected workflow run, or an explanatory message.
   */
  inspectBranching: (runId?: string) => Promise<unknown>
}

/**
 * Activates the workflow-register extension and wires VS Code commands to the registration service.
 *
 * @param context VS Code extension context that owns command registrations and disposables.
 * @returns Public API object consumed by workflow-aware companion extensions.
 */
export function activate(context: vscode.ExtensionContext): WorkflowRegisterApi {
  const service = new WorkflowRegisterService(String(context.extension.packageJSON.version ?? "unknown"))
  context.subscriptions.push(service)
  context.subscriptions.push(
    vscode.commands.registerCommand("workflowRegister.reload", () => service.reload({ showReport: true })),
    vscode.commands.registerCommand("workflowRegister.inspect", () => service.inspect()),
    vscode.commands.registerCommand("workflowRegister.completeCurrentStep", (options?: StepCompletionOptions) => service.completeCurrentStep(options)),
    vscode.commands.registerCommand("workflowRegister.completeStep", (options?: StepCompletionOptions) => service.completeCurrentStep(options)),
    vscode.commands.registerCommand("workflowRegister.inspectActiveSteps", () => service.inspectActiveSteps()),
    vscode.commands.registerCommand(
      "workflowRegister.runWorkflow",
      (workflowId?: string, inputs?: Record<string, unknown>) => service.runWorkflow(workflowId, inputs)
    ),
    vscode.commands.registerCommand(
      "workflowRegister.runWorkflowStep",
      (workflowId?: string, stepId?: string, inputs?: Record<string, unknown>) => {
        return service.runWorkflowStep(workflowId, stepId, inputs)
      }
    ),
    vscode.commands.registerCommand("workflowRegister.runNextStep", (runId?: string) => service.runNextStep(runId)),
    vscode.commands.registerCommand("workflowRegister.openManualStepPanel", (runArg?: unknown) => service.openManualStepPanel(runArg as Parameters<WorkflowRegisterService["openManualStepPanel"]>[0])),
    vscode.commands.registerCommand("workflowRegister.inspectRuns", () => service.inspectRuns()),
    vscode.commands.registerCommand("workflowRegister.resumeRun", (runId?: string) => service.resumeRun(runId)),
    vscode.commands.registerCommand("workflowRegister.retryCurrentStep", (runId?: string) => service.retryCurrentStep(runId)),
    vscode.commands.registerCommand("workflowRegister.approveBranchCheckpoint", (runId?: string) => service.approveBranchCheckpoint(runId)),
    vscode.commands.registerCommand("workflowRegister.abortBranchCheckpoint", (runId?: string) => service.abortBranchCheckpoint(runId)),
    vscode.commands.registerCommand("workflowRegister.inspectBranching", (runId?: string) => service.inspectBranching(runId))
  )
  service.reload({ showReport: false }).catch((error) => console.warn("Bob workflow registration failed", error))
  const retryDelaysMs = [3000, 10000]
  for (const delayMs of retryDelaysMs) {
    const timer = setTimeout(
      () => service.reload({ showReport: false }).catch((error) => {
        console.warn("Bob workflow registration retry failed", error)
      }),
      delayMs
    )
    context.subscriptions.push({ dispose: () => clearTimeout(timer) })
  }
  return {
    registerActionProvider: (provider) => service.registerActionProvider(provider),
    registerAgentProvider: (provider) => service.registerAgentProvider(provider),
    registerResultSink: (type, handler) => service.registerResultSink(type, handler),
    listWorkflows: () => service.listCoreWorkflows(),
    runWorkflow: (workflowId, inputs) => service.runWorkflow(workflowId, inputs),
    runWorkflowStep: (workflowId, stepId, inputs) => service.runWorkflowStep(workflowId, stepId, inputs),
    runNextStep: (runId) => service.runNextStep(runId),
    approveBranchCheckpoint: (runId) => service.approveBranchCheckpoint(runId),
    abortBranchCheckpoint: (runId) => service.abortBranchCheckpoint(runId),
    inspectBranching: (runId) => service.inspectBranching(runId)
  }
}

/**
 * Deactivates the workflow-register extension.
 *
 * @returns Nothing.
 */
export function deactivate(): void {
  // Nothing to dispose beyond context subscriptions.
}
