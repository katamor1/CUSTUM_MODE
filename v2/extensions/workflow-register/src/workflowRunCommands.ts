import * as vscode from "vscode"
import type { ActiveStep } from "./bobWorkflowTypes"
import type { CoreWorkflowDefinition } from "./core/model"
import { formatBranchingDiagnostics } from "./core/runDiagnostics"
import { pendingReviewTransitionStepId } from "./core/engine/runState"
import type { MarkerRootCandidate } from "./core/workspaceRoots"
import { showMarkdownReport } from "./reports"
import type { ManualStepPanelInput } from "./webview/manualStepViewModel"
import { requireTrustedWorkspace } from "./workspaceTrust"
import { collectCoreWorkflowInputs } from "./workflowInputPrompt"
import {
  findRunSelection,
  listRunSelections,
  pickRunSelection
} from "./workflowRunSelection"
import { WorkflowRuntimeFactory } from "./workflowRuntimeFactory"

export type RunCommandArg = string | { runId?: string; run?: { runId?: string } } | undefined

export interface WorkflowRunCommandServiceOptions {
  coreWorkflows: Map<string, CoreWorkflowDefinition>
  runtimeFactory: WorkflowRuntimeFactory
  ensureWorkflowsLoaded: () => Promise<void>
  workflowRootCandidates: () => Promise<MarkerRootCandidate[]>
  activeSteps: () => ActiveStep[]
  showManualStepPanel: (input: ManualStepPanelInput) => Promise<void>
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
    if (run.status === "checkpoint") {
      return this.warnStepGate("Current run is waiting at a branch checkpoint. Approve or abort the checkpoint before running the next step.")
    }
    if (run.status === "failed") {
      return this.warnStepGate("Current step failed. Retry the current step before running the next step.")
    }
    const workflow = this.options.coreWorkflows.get(run.workflowId)
    if (!workflow) throw new Error(`Workflow definition is not loaded: ${run.workflowId}`)
    const pendingTransitionStepId = pendingReviewTransitionStepId(run)
    if (pendingTransitionStepId) {
      const engine = this.options.runtimeFactory.createEngine(selection.root)
      const result = await engine.runWorkflow(workflow, run.inputs, {
        executionMode: "singleStep",
        stepId: pendingTransitionStepId,
        allowOutOfOrder: workflow.stepExecution.allowOutOfOrder
      })
      await vscode.window.showInformationMessage(`Workflow run ${result.status}: ${result.runId}`)
      return result
    }
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

  async openManualStepPanel(runArg?: RunCommandArg): Promise<string> {
    const trustError = await requireTrustedWorkspace("open manual step panel")
    if (trustError) return trustError
    await this.ensureWorkflowsLoaded()
    const roots = await this.options.workflowRootCandidates()
    if (roots.length === 0) {
      const message = "No workspace folder is open."
      await vscode.window.showWarningMessage(message)
      return message
    }
    const runId = resolveRunId(runArg)
    const selection = runId
      ? await findRunSelection(runId, roots, (root) => this.options.runtimeFactory.createRunStore(root))
      : await pickRunSelection(roots, (root) => this.options.runtimeFactory.createRunStore(root))
    if (!selection) {
      const message = runId ? `Workflow run not found: ${runId}` : "No workflow run selected."
      await vscode.window.showWarningMessage(message)
      return message
    }
    const runStore = this.options.runtimeFactory.createRunStore(selection.root)
    const run = selection.run ?? await runStore.loadRun(selection.runId)
    if (!run) {
      const message = `Workflow run not found: ${selection.runId}`
      await vscode.window.showWarningMessage(message)
      return message
    }
    const workflow = this.options.coreWorkflows.get(run.workflowId)
    if (!workflow) {
      const message = `Workflow definition is not loaded: ${run.workflowId}`
      await vscode.window.showWarningMessage(message)
      return message
    }
    const stepId = run.currentStep ?? run.steps.find((candidate) => candidate.status === "held")?.id
    const step = stepId ? workflow.engineSteps.find((candidate) => candidate.id === stepId) : undefined
    if (!step) {
      const message = `Workflow run has no current manual step: ${run.runId}`
      await vscode.window.showWarningMessage(message)
      return message
    }
    const active = this.options.activeSteps().find((candidate) => (
      candidate.runId === run.runId &&
      candidate.workflowId === run.workflowId &&
      candidate.stepId === step.id
    ))
    await this.options.showManualStepPanel({ workflow, run, step, active })
    return `Opened manual step panel: ${run.runId}`
  }

  async inspectRuns(): Promise<void> {
    const roots = await this.options.workflowRootCandidates()
    if (roots.length === 0) {
      await vscode.window.showErrorMessage("No workspace folder is open.")
      return
    }
    const runsByRoot = await listRunSelections(roots, (root) => this.options.runtimeFactory.createRunStore(root))
    const lines = runsByRoot.length === 0
      ? ["- No workflow runs were found."]
      : runsByRoot.map(({ root, run }) => [
        `- ${run?.runId}: ${run?.status}`,
        `workflow=${run?.workflowId}`,
        `root=${root}`,
        `currentStep=${run?.currentStep ?? "none"}`,
        `updatedAt=${run?.updatedAt}`
      ].join("; "))
    await showMarkdownReport("Workflow Runs", `${runsByRoot.length} run(s).`, lines)
  }

  async resumeRun(runId?: string): Promise<unknown> {
    return this.resumeOrRetryRun("resume", runId)
  }

  async retryCurrentStep(runId?: string): Promise<unknown> {
    return this.resumeOrRetryRun("retry", runId)
  }

  async approveBranchCheckpoint(runId?: string): Promise<unknown> {
    const trustError = await requireTrustedWorkspace("approve branch checkpoint")
    if (trustError) return trustError
    await this.ensureWorkflowsLoaded()
    const selection = await this.selectRun(runId)
    if (!selection) return runId ? `Workflow run not found: ${runId}` : "No workflow run selected."
    const runStore = this.options.runtimeFactory.createRunStore(selection.root)
    const run = selection.run ?? await runStore.loadRun(selection.runId)
    if (!run) throw new Error(`Workflow run not found: ${selection.runId}`)
    const workflow = this.options.coreWorkflows.get(run.workflowId)
    if (!workflow) throw new Error(`Workflow definition is not loaded: ${run.workflowId}`)
    const engine = this.options.runtimeFactory.createEngine(selection.root)
    const result = await engine.approveBranchCheckpoint(selection.runId, workflow)
    await vscode.window.showInformationMessage(`Branch checkpoint approved: ${result.runId}`)
    return result
  }

  async abortBranchCheckpoint(runId?: string): Promise<unknown> {
    const trustError = await requireTrustedWorkspace("abort branch checkpoint")
    if (trustError) return trustError
    const selection = await this.selectRun(runId)
    if (!selection) return runId ? `Workflow run not found: ${runId}` : "No workflow run selected."
    const engine = this.options.runtimeFactory.createEngine(selection.root)
    const result = await engine.abortBranchCheckpoint(selection.runId)
    await vscode.window.showInformationMessage(`Branch checkpoint aborted: ${result.runId}`)
    return result
  }

  async inspectBranching(runId?: string): Promise<unknown> {
    const selection = await this.selectRun(runId)
    if (!selection) {
      const message = runId ? `Workflow run not found: ${runId}` : "No workflow run selected."
      await vscode.window.showWarningMessage(message)
      return message
    }
    const run = selection.run ?? await this.options.runtimeFactory.createRunStore(selection.root).loadRun(selection.runId)
    if (!run) throw new Error(`Workflow run not found: ${selection.runId}`)
    const lines = [
      `- runId: ${run.runId}`,
      `- status: ${run.status}`,
      `- currentStep: ${run.currentStep ?? "none"}`,
      `- root: ${selection.root}`
    ]
    const branchingLines = formatBranchingDiagnostics(run)
    lines.push("", ...(branchingLines.length > 0 ? branchingLines : ["Branch loops:", "- No branch loops recorded."]))
    await showMarkdownReport("Workflow Branching", `${run.runId}: ${run.status}`, lines)
    return run
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
    if (mode === "resume" && run.status === "checkpoint") {
      return this.warnStepGate("Current run is waiting at a branch checkpoint. Approve or abort the checkpoint before resuming.")
    }
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

  private async selectRun(runId?: string) {
    const roots = await this.options.workflowRootCandidates()
    if (roots.length === 0) return undefined
    return runId
      ? findRunSelection(runId, roots, (root) => this.options.runtimeFactory.createRunStore(root))
      : pickRunSelection(roots, (root) => this.options.runtimeFactory.createRunStore(root))
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

function resolveRunId(value: RunCommandArg): string | undefined {
  if (typeof value === "string") return value
  if (!value || typeof value !== "object") return undefined
  if (typeof value.runId === "string") return value.runId
  if (value.run && typeof value.run.runId === "string") return value.run.runId
  return undefined
}
