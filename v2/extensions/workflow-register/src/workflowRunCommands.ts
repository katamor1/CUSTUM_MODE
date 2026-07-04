import * as vscode from "vscode"
import type { CoreWorkflowDefinition } from "./core/model"
import type { MarkerRootCandidate } from "./core/workspaceRoots"
import { requireTrustedWorkspace } from "./workspaceTrust"
import { collectCoreWorkflowInputs } from "./workflowInputPrompt"
import {
  findRunSelection,
  pickRunSelection
} from "./workflowRunSelection"
import { WorkflowRuntimeFactory } from "./workflowRuntimeFactory"

export interface WorkflowRunCommandServiceOptions {
  coreWorkflows: Map<string, CoreWorkflowDefinition>
  runtimeFactory: WorkflowRuntimeFactory
  ensureWorkflowsLoaded: () => Promise<void>
  workflowRootCandidates: () => Promise<MarkerRootCandidate[]>
}

export class WorkflowRunCommandService {
  constructor(private readonly options: WorkflowRunCommandServiceOptions) {}

  listCoreWorkflows(): CoreWorkflowDefinition[] {
    return Array.from(this.options.coreWorkflows.values()).sort((a, b) => a.label.localeCompare(b.label))
  }

  async runWorkflow(workflowId?: string, inputs: Record<string, unknown> = {}): Promise<unknown> {
    const trustError = await requireTrustedWorkspace("run workflow")
    if (trustError) return trustError
    await this.ensureWorkflowsLoaded()
    const workflow = workflowId
      ? this.options.coreWorkflows.get(workflowId)
      : await this.pickCoreWorkflow()
    if (!workflow) return "No workflow selected."
    const root = workflow.workflowRoot ?? await this.pickWorkflowRoot("Select workflow workspace")
    if (!root) {
      const message = "No workspace folder is open."
      await vscode.window.showErrorMessage(message)
      return message
    }
    const resolvedInputs = await collectCoreWorkflowInputs(workflow, inputs)
    if (!resolvedInputs) return "Workflow input was cancelled."
    const engine = this.options.runtimeFactory.createEngine(root)
    const run = await engine.runWorkflow(workflow, resolvedInputs)
    await vscode.window.showInformationMessage(`Workflow run ${run.status}: ${run.runId}`)
    return run
  }

  async runWorkflowStep(
    workflowId?: string,
    stepId?: string,
    inputs: Record<string, unknown> = {}
  ): Promise<unknown> {
    const trustError = await requireTrustedWorkspace("run workflow step")
    if (trustError) return trustError
    await this.ensureWorkflowsLoaded()
    const workflow = workflowId
      ? this.options.coreWorkflows.get(workflowId)
      : await this.pickCoreWorkflow()
    if (!workflow) return "No workflow selected."
    const step = stepId
      ? workflow.engineSteps.find((candidate) => candidate.id === stepId)
      : await this.pickWorkflowStep(workflow)
    if (!step) return stepId ? `Workflow step not found: ${stepId}` : "No workflow step selected."
    const root = workflow.workflowRoot ?? await this.pickWorkflowRoot("Select workflow workspace")
    if (!root) {
      const message = "No workspace folder is open."
      await vscode.window.showErrorMessage(message)
      return message
    }
    const resolvedInputs = await collectCoreWorkflowInputs(workflow, inputs)
    if (!resolvedInputs) return "Workflow input was cancelled."
    const engine = this.options.runtimeFactory.createEngine(root)
    const run = await engine.runWorkflow(workflow, resolvedInputs, {
      executionMode: "singleStep",
      stepId: step.id,
      allowOutOfOrder: workflow.stepExecution.allowOutOfOrder
    })
    await vscode.window.showInformationMessage(`Workflow run ${run.status}: ${run.runId}`)
    return run
  }

  async runNextStep(runId?: string): Promise<unknown> {
    const trustError = await requireTrustedWorkspace("run next workflow step")
    if (trustError) return trustError
    await this.ensureWorkflowsLoaded()
    const roots = await this.options.workflowRootCandidates()
    if (roots.length === 0) {
      const message = "No workspace folder is open."
      await vscode.window.showErrorMessage(message)
      return message
    }
    const selection = runId
      ? await findRunSelection(runId, roots, (root) => this.options.runtimeFactory.createRunStore(root))
      : await pickRunSelection(roots, (root) => this.options.runtimeFactory.createRunStore(root))
    if (!selection) {
      const message = runId ? `Workflow run not found: ${runId}` : "No workflow run selected."
      if (runId) await vscode.window.showWarningMessage(message)
      return message
    }
    const runStore = this.options.runtimeFactory.createRunStore(selection.root)
    const run = selection.run ?? await runStore.loadRun(selection.runId)
    if (!run) throw new Error(`Workflow run not found: ${selection.runId}`)
    if (run.status === "reviewing") {
      return this.warnStepGate("Current step is waiting for review. Accept or retry it before running the next step.")
    }
    if (run.status === "held") {
      return this.warnStepGate("Current step is held. Complete the held step before running the next step.")
    }
    if (run.status === "failed") {
      return this.warnStepGate("Current step failed. Retry the current step before running the next step.")
    }
    const workflow = this.options.coreWorkflows.get(run.workflowId)
    if (!workflow) throw new Error(`Workflow definition is not loaded: ${run.workflowId}`)
    const next = run.steps.find((step) => step.status === "pending")
    if (!next) {
      if (run.status !== "completed" && run.steps.every((step) => step.status === "completed")) {
        run.status = "completed"
        run.currentStep = undefined
        run.error = undefined
        await runStore.saveRun(run)
      }
      const message = run.status === "completed"
        ? `Workflow run completed: ${run.runId}`
        : `No pending workflow step: ${run.runId}`
      await vscode.window.showInformationMessage(message)
      return run
    }
    const engine = this.options.runtimeFactory.createEngine(selection.root)
    const result = await engine.runWorkflow(workflow, run.inputs, {
      executionMode: "singleStep",
      stepId: next.id,
      allowOutOfOrder: workflow.stepExecution.allowOutOfOrder
    })
    await vscode.window.showInformationMessage(`Workflow run ${result.status}: ${result.runId}`)
    return result
  }

  async resumeRun(runId?: string): Promise<unknown> {
    return this.resumeOrRetryRun("resume", runId)
  }

  async retryCurrentStep(runId?: string): Promise<unknown> {
    return this.resumeOrRetryRun("retry", runId)
  }

  private async resumeOrRetryRun(mode: "resume" | "retry", runId?: string): Promise<unknown> {
    const trustError = await requireTrustedWorkspace(`${mode} workflow run`)
    if (trustError) return trustError
    await this.ensureWorkflowsLoaded()
    const roots = await this.options.workflowRootCandidates()
    const selection = runId
      ? await findRunSelection(runId, roots, (root) => this.options.runtimeFactory.createRunStore(root))
      : await pickRunSelection(roots, (root) => this.options.runtimeFactory.createRunStore(root))
    if (!selection) {
      const message = "No workspace folder is open."
      if (!runId) return "No workflow run selected."
      await vscode.window.showErrorMessage(`Workflow run not found: ${runId}`)
      return message
    }
    const runStore = this.options.runtimeFactory.createRunStore(selection.root)
    const targetRunId = selection.runId
    const run = selection.run ?? await runStore.loadRun(targetRunId)
    if (!run) throw new Error(`Workflow run not found: ${targetRunId}`)
    const workflow = this.options.coreWorkflows.get(run.workflowId)
    if (!workflow) throw new Error(`Workflow definition is not loaded: ${run.workflowId}`)
    const engine = this.options.runtimeFactory.createEngine(selection.root)
    const result = mode === "resume"
      ? await engine.resumeRun(targetRunId, { workflow, completeHeldStep: true })
      : await engine.retryCurrentStep(targetRunId, workflow)
    await vscode.window.showInformationMessage(`Workflow run ${result.status}: ${result.runId}`)
    return result
  }

  private async ensureWorkflowsLoaded(): Promise<void> {
    if (this.options.coreWorkflows.size === 0) await this.options.ensureWorkflowsLoaded()
  }

  private async pickWorkflowRoot(title: string): Promise<string | undefined> {
    const candidates = await this.options.workflowRootCandidates()
    if (candidates.length === 0) return undefined
    if (candidates.length === 1) return candidates[0].root
    const picked = await vscode.window.showQuickPick(candidates.map((candidate) => ({
      label: candidate.name,
      description: candidate.root,
      detail: `${candidate.marker}; ${candidate.depth}; workspace=${candidate.workspaceFolderName}`,
      candidate
    })), { title })
    return picked?.candidate.root
  }

  private async pickCoreWorkflow(): Promise<CoreWorkflowDefinition | undefined> {
    const workflows = this.listCoreWorkflows()
    if (workflows.length === 0) return undefined
    if (workflows.length === 1) return workflows[0]
    const picked = await vscode.window.showQuickPick(workflows.map((workflow) => ({
      label: workflow.label,
      description: workflow.name,
      detail: workflow.description,
      workflow
    })), { title: "Run Workflow" })
    return picked?.workflow
  }

  private async pickWorkflowStep(
    workflow: CoreWorkflowDefinition
  ): Promise<CoreWorkflowDefinition["engineSteps"][number] | undefined> {
    if (workflow.engineSteps.length === 0) return undefined
    if (workflow.engineSteps.length === 1) return workflow.engineSteps[0]
    const picked = await vscode.window.showQuickPick(workflow.engineSteps.map((step, index) => ({
      label: step.title,
      description: step.id,
      detail: `${index + 1}. ${step.type}`,
      step
    })), { title: `Run Workflow Step: ${workflow.label}` })
    return picked?.step
  }

  private async warnStepGate(message: string): Promise<string> {
    await vscode.window.showWarningMessage(message)
    return message
  }
}
