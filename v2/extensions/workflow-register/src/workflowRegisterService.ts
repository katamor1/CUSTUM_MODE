import * as vscode from "vscode"
import { StepRuntime, type StepCompletionExpectation } from "./bobStepRuntime"
import type { WorkflowDefinition } from "./bobWorkflowTypes"
import type { BobSourceLike } from "./bobApi"
import { ActionProvider, createDefaultActionRegistry } from "./core/actionRegistry"
import type { AgentProvider, CoreWorkflowDefinition } from "./core/model"
import type { ResultSinkRegistry } from "./core/resultSinkRegistry"
import {
  fallbackWorkspaceRootCandidates,
  findWorkflowRootCandidates,
  MarkerRootCandidate
} from "./core/workspaceRoots"
import { showMarkdownReport } from "./reports"
import {
  findRunSelection,
  listRunSelections,
  pickRunSelection
} from "./workflowRunSelection"
import {
  deactivateRegisteredSource,
  registerWorkflows as registerWorkflowDefinitions,
  type RegistrationResult
} from "./workflowRegistrationService"
import { WorkflowRuntimeFactory } from "./workflowRuntimeFactory"
import {
  collectBobWorkflowInputs,
  collectCoreWorkflowInputs
} from "./workflowInputPrompt"
import { requireTrustedWorkspace } from "./workspaceTrust"

const WORKFLOW_GLOB = "**/.bob/workflows/*/WORKFLOW.md"

export interface StepCompletionOptions extends StepCompletionExpectation {
  silent?: boolean
}

export class WorkflowRegisterService implements vscode.Disposable {
  private readonly registeredIds = new Set<string>()
  private readonly watcher = vscode.workspace.createFileSystemWatcher(WORKFLOW_GLOB)
  private readonly stepRuntime = new StepRuntime()
  private readonly coreWorkflows = new Map<string, CoreWorkflowDefinition>()
  private readonly actionRegistry = createDefaultActionRegistry({
    isWorkspaceTrusted: () => vscode.workspace.isTrusted,
    executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args)
  })
  private readonly customResultSinks: Array<{ type: string; handler: Parameters<ResultSinkRegistry["register"]>[1] }> = []
  private readonly runtimeFactory: WorkflowRuntimeFactory
  private agentProvider?: AgentProvider
  private registeredSource?: BobSourceLike
  private lastResult: RegistrationResult = { summary: "No workflow registration has run yet.", lines: [] }

  constructor(private readonly engineVersion: string) {
    this.runtimeFactory = new WorkflowRuntimeFactory({
      engineVersion,
      actionRegistry: this.actionRegistry,
      customResultSinks: this.customResultSinks,
      stepRuntime: this.stepRuntime,
      agentProvider: () => this.agentProvider,
      inputsProvider: (workflow, provided) => collectBobWorkflowInputs(workflow, provided)
    })
    this.watcher.onDidCreate(() => this.reload({ showReport: false }))
    this.watcher.onDidChange(() => this.reload({ showReport: false }))
    this.watcher.onDidDelete(() => this.reload({ showReport: false }))
  }

  dispose(): void {
    this.watcher.dispose()
    const source = this.registeredSource
    this.registeredSource = undefined
    void deactivateRegisteredSource(source)
  }

  async inspect(): Promise<void> {
    await showMarkdownReport("Bob Workflow Register", this.lastResult.summary, this.lastResult.lines)
  }

  async inspectActiveSteps(): Promise<void> {
    const steps = this.stepRuntime.list()
    const lines = steps.length === 0
      ? ["- No active Bob workflow steps."]
      : steps.map((step) => [
        `- key=${step.key}`,
        `workflowId=${step.workflowId}`,
        `workflowTitle=${step.workflowLabel}`,
        `stepId=${step.stepId}`,
        `stepTitle=${step.title}`
      ].join("; "))
    await showMarkdownReport("Active Bob Workflow Steps", `${steps.length} active step(s).`, lines)
  }

  async completeCurrentStep(options: StepCompletionOptions = {}): Promise<string> {
    const trustError = await requireTrustedWorkspace("complete workflow step", { showWarning: !options.silent })
    if (trustError) return trustError
    const message = await this.stepRuntime.completeCurrentStep({
      expectedRunId: options.expectedRunId,
      expectedStepId: options.expectedStepId,
      stateUpdates: options.stateUpdates
    })
    if (!options.silent) await vscode.window.showInformationMessage(message)
    return message
  }

  registerActionProvider(provider: ActionProvider): void {
    this.actionRegistry.register(provider)
  }

  registerAgentProvider(provider: AgentProvider): void {
    this.agentProvider = provider
  }

  registerResultSink(type: string, handler: Parameters<ResultSinkRegistry["register"]>[1]): void {
    this.customResultSinks.push({ type, handler })
  }

  listCoreWorkflows(): CoreWorkflowDefinition[] {
    return Array.from(this.coreWorkflows.values()).sort((a, b) => a.label.localeCompare(b.label))
  }

  async runWorkflow(workflowId?: string, inputs: Record<string, unknown> = {}): Promise<unknown> {
    const trustError = await requireTrustedWorkspace("run workflow")
    if (trustError) return trustError
    if (this.coreWorkflows.size === 0) await this.reload({ showReport: false })
    const workflow = workflowId
      ? this.coreWorkflows.get(workflowId)
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
    const engine = this.runtimeFactory.createEngine(root)
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
    if (this.coreWorkflows.size === 0) await this.reload({ showReport: false })
    const workflow = workflowId
      ? this.coreWorkflows.get(workflowId)
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
    const engine = this.runtimeFactory.createEngine(root)
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
    if (this.coreWorkflows.size === 0) await this.reload({ showReport: false })
    const roots = await this.workflowRootCandidates()
    if (roots.length === 0) {
      const message = "No workspace folder is open."
      await vscode.window.showErrorMessage(message)
      return message
    }
    const selection = runId
      ? await findRunSelection(runId, roots, (root) => this.runtimeFactory.createRunStore(root))
      : await pickRunSelection(roots, (root) => this.runtimeFactory.createRunStore(root))
    if (!selection) {
      const message = runId ? `Workflow run not found: ${runId}` : "No workflow run selected."
      if (runId) await vscode.window.showWarningMessage(message)
      return message
    }
    const runStore = this.runtimeFactory.createRunStore(selection.root)
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
    const workflow = this.coreWorkflows.get(run.workflowId)
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
    const engine = this.runtimeFactory.createEngine(selection.root)
    const result = await engine.runWorkflow(workflow, run.inputs, {
      executionMode: "singleStep",
      stepId: next.id,
      allowOutOfOrder: workflow.stepExecution.allowOutOfOrder
    })
    await vscode.window.showInformationMessage(`Workflow run ${result.status}: ${result.runId}`)
    return result
  }

  async inspectRuns(): Promise<void> {
    const roots = await this.workflowRootCandidates()
    if (roots.length === 0) {
      await vscode.window.showErrorMessage("No workspace folder is open.")
      return
    }
    const runsByRoot = await listRunSelections(roots, (root) => this.runtimeFactory.createRunStore(root))
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

  private async resumeOrRetryRun(mode: "resume" | "retry", runId?: string): Promise<unknown> {
    const trustError = await requireTrustedWorkspace(`${mode} workflow run`)
    if (trustError) return trustError
    if (this.coreWorkflows.size === 0) await this.reload({ showReport: false })
    const roots = await this.workflowRootCandidates()
    const selection = runId
      ? await findRunSelection(runId, roots, (root) => this.runtimeFactory.createRunStore(root))
      : await pickRunSelection(roots, (root) => this.runtimeFactory.createRunStore(root))
    if (!selection) {
      const message = "No workspace folder is open."
      if (!runId) return "No workflow run selected."
      await vscode.window.showErrorMessage(`Workflow run not found: ${runId}`)
      return message
    }
    const runStore = this.runtimeFactory.createRunStore(selection.root)
    const targetRunId = selection.runId
    const run = selection.run ?? await runStore.loadRun(targetRunId)
    if (!run) throw new Error(`Workflow run not found: ${targetRunId}`)
    const workflow = this.coreWorkflows.get(run.workflowId)
    if (!workflow) throw new Error(`Workflow definition is not loaded: ${run.workflowId}`)
    const engine = this.runtimeFactory.createEngine(selection.root)
    const result = mode === "resume"
      ? await engine.resumeRun(targetRunId, { workflow, completeHeldStep: true })
      : await engine.retryCurrentStep(targetRunId, workflow)
    await vscode.window.showInformationMessage(`Workflow run ${result.status}: ${result.runId}`)
    return result
  }

  private async workflowRootCandidates(): Promise<MarkerRootCandidate[]> {
    const folders = vscode.workspace.workspaceFolders ?? []
    if (folders.length === 0) return []
    const markerRoots = await findWorkflowRootCandidates(folders)
    return markerRoots.length > 0 ? markerRoots : fallbackWorkspaceRootCandidates(folders)
  }

  private async pickWorkflowRoot(title: string): Promise<string | undefined> {
    const candidates = await this.workflowRootCandidates()
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

  async reload(options: { showReport: boolean }): Promise<void> {
    const trustError = await requireTrustedWorkspace("reload registration", { showWarning: options.showReport })
    if (trustError) {
      this.lastResult = { summary: "Workspace is not trusted.", lines: [`- fail: ${trustError}`] }
      if (options.showReport) await showMarkdownReport("Bob Workflow Register", this.lastResult.summary, this.lastResult.lines)
      return
    }
    const result = await this.registerWorkflows()
    this.lastResult = result
    if (options.showReport) await showMarkdownReport("Bob Workflow Register", result.summary, result.lines)
  }

  private async registerWorkflows(): Promise<RegistrationResult> {
    const update = await registerWorkflowDefinitions({
      previousSource: this.registeredSource,
      createRunner: (workflow) => this.runtimeFactory.createBobWorkflowRunner(workflow)
    })
    this.coreWorkflows.clear()
    for (const workflow of update.coreWorkflows) this.coreWorkflows.set(workflow.id, workflow)
    if (update.sourceChanged) this.registeredSource = update.registeredSource
    if (update.idsChanged) {
      this.registeredIds.clear()
      for (const id of update.registeredIds ?? []) this.registeredIds.add(id)
    }
    return update.result
  }
}
