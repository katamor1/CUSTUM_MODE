import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import type { ActiveStep } from "./bobWorkflowTypes"
import { BobWorkflowGateRegistry, type BobWorkflowGateDecision } from "./bobWorkflowGateRegistry"
import { bobTaskSyncRegistry, type BobTaskSyncReason } from "./bobTaskSync"
import {
  hydrateWorkflowStateFromArtifacts,
  importArtifactsFromTaskSnapshots as importTaskSnapshotArtifacts,
  parseWorkflowArtifactManifest,
  seedWorkflowRunFromArtifacts,
  stateKeysProducedBeforeStep,
  validateWorkflowArtifactManifest,
  type TaskSnapshotArtifactImportIssue,
  type WorkflowArtifactManifest
} from "./core/artifacts"
import type { CoreWorkflowDefinition, WorkflowRunState } from "./core/model"
import { formatBranchingDiagnostics } from "./core/runDiagnostics"
import { assertWorkflowRunStateWritable, isWorkflowRunStateWritable } from "./core/runStateStore"
import { pendingReviewTransitionStepId } from "./core/engine/runState"
import {
  coordinateWorkflowRunExecution,
  workflowRunExecutionActiveForWorkspace
} from "./core/engine/runExecutionCoordinator"
import { FileRunControlStore } from "./core/runControlStore"
import { FileTaskSnapshotStore } from "./core/taskSnapshots"
import { readContainedRunArtifactManifest } from "./core/runtime/runStatePath"
import type { MarkerRootCandidate } from "./core/workspaceRoots"
import {
  assertOperationHubRunRevision,
  canonicalOperationHubWorkspaceRoot,
  isOperationHubRunMutationTarget,
  isOperationHubWorkflowMutationTarget,
  OperationHubRunMutationTarget,
  OperationHubWorkflowMutationTarget,
  validateOperationHubRunMutationTarget
} from "./operationHubMutationTarget"
import { showMarkdownReport } from "./reports"
import type { ManualStepPanelInput } from "./webview/manualStepViewModel"
import { writeWorkspaceFilesAtomically } from "./core/runtime/workspaceFileTransaction"
import { requireTrustedWorkspace } from "./workspaceTrust"
import { collectCoreWorkflowInputs } from "./workflowInputPrompt"
import {
  findRunSelection,
  listRunSelections,
  pickRunSelection,
  RunSelection
} from "./workflowRunSelection"
import { WorkflowRuntimeFactory } from "./workflowRuntimeFactory"
import { reviewTaskRegistry } from "./reviewTaskRegistry"
import type { ReviewAcceptanceOperationKind } from "./reviewAcceptanceCoordinator"

export type RunCommandArg = string | OperationHubRunMutationTarget | { runId?: string; run?: { runId?: string } } | undefined
export type WorkflowCommandArg = string | OperationHubWorkflowMutationTarget | undefined
export type ArtifactSourceRunArg = string | OperationHubRunMutationTarget | undefined

interface ArtifactSourceRunSelection {
  root: string
  run: WorkflowRunState
  manifest: WorkflowArtifactManifest
}

export interface WorkflowRunCommandServiceOptions {
  coreWorkflows: Map<string, CoreWorkflowDefinition>
  runtimeFactory: WorkflowRuntimeFactory
  ensureWorkflowsLoaded: () => Promise<void>
  workflowRootCandidates: () => Promise<MarkerRootCandidate[]>
  activeSteps: () => ActiveStep[]
  showManualStepPanel: (input: ManualStepPanelInput) => Promise<void>
  gateRegistry: BobWorkflowGateRegistry
  coordinateGateDecision: <T>(
    workspaceRoot: string,
    runId: string,
    kind: ReviewAcceptanceOperationKind,
    operation: () => Promise<T>
  ) => Promise<T>
}

const CHECKPOINT_ABORT_REASON = "Bob workflow run aborted at branch checkpoint."

export class WorkflowRunCommandService {
  constructor(private readonly options: WorkflowRunCommandServiceOptions) {}

  listCoreWorkflows(): CoreWorkflowDefinition[] {
    return Array.from(this.options.coreWorkflows.values()).sort((a, b) => a.label.localeCompare(b.label))
  }

  async runWorkflow(workflowArg?: WorkflowCommandArg, inputs: Record<string, unknown> = {}): Promise<unknown> {
    const trustError = await requireTrustedWorkspace("run workflow")
    if (trustError) return trustError
    await this.ensureWorkflowsLoaded()
    const operationHubTarget = isOperationHubWorkflowMutationTarget(workflowArg) ? workflowArg : undefined
    const workflowId = operationHubTarget?.workflowId ?? (typeof workflowArg === "string" ? workflowArg : undefined)
    const workflow = workflowId
      ? this.options.coreWorkflows.get(workflowId)
      : await this.pickCoreWorkflow()
    if (!workflow) return "No workflow selected."
    const root = operationHubTarget
      ? await this.validateOperationHubWorkflowRoot(operationHubTarget, workflow)
      : workflow.workflowRoot ?? await this.pickWorkflowRoot("Select workflow workspace")
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

  async startFromStepWithArtifacts(
    workflowId?: string,
    stepId?: string,
    sourceRunArg?: ArtifactSourceRunArg,
    inputs: Record<string, unknown> = {}
  ): Promise<unknown> {
    const trustError = await requireTrustedWorkspace("start workflow from artifacts")
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
    const sourceTarget = isOperationHubRunMutationTarget(sourceRunArg) ? sourceRunArg : undefined
    const sourceRunId = sourceTarget?.runId ?? (typeof sourceRunArg === "string" ? sourceRunArg : undefined)
    let root = workflow.workflowRoot ?? await this.pickWorkflowRoot("Select workflow workspace")
    if (!root) {
      const message = "No workspace folder is open."
      await vscode.window.showErrorMessage(message)
      return message
    }
    const resolvedInputs = await collectCoreWorkflowInputs(workflow, inputs)
    if (!resolvedInputs) return "Workflow input was cancelled."

    if (sourceTarget) {
      const roots = await this.options.workflowRootCandidates()
      const validated = await validateOperationHubRunMutationTarget(
        sourceTarget,
        roots.map((candidate) => candidate.root)
      )
      if (workflow.workflowRoot) {
        await canonicalOperationHubWorkspaceRoot(workflow.workflowRoot, [validated.workspaceRoot])
      }
      root = validated.workspaceRoot
    }

    if (sourceTarget) {
      await assertOperationHubRunRevision(root, sourceTarget.runId, sourceTarget.expectedRevision)
    }

    const source = await this.pickArtifactSourceRun(root, workflow, resolvedInputs, sourceRunId)
    if (!source) {
      const message = sourceRunId
        ? `Workflow artifact source run not found or not compatible: ${sourceRunId}`
        : "No compatible workflow artifact source run selected."
      await vscode.window.showWarningMessage(message)
      return message
    }

    const runStore = this.options.runtimeFactory.createRunStore(root)
    const seeded = await runStore.createRun(workflow, resolvedInputs)
    seeded.currentStep = step.id
    const stateKeys = stateKeysProducedBeforeStep(workflow, step.id)
    const hydration = await hydrateWorkflowStateFromArtifacts({
      workflow,
      run: seeded,
      manifest: source.manifest,
      stateKeys,
      readFile: (relativePath) => readPhysicallyContainedWorkspaceFile(root, relativePath)
    })
    if (!hydration.ok) {
      const message = `Workflow artifact hydration failed: ${hydration.issues.map((issue) => issue.message).join("; ")}`
      await vscode.window.showErrorMessage(message)
      return message
    }

    const seededRun = seedWorkflowRunFromArtifacts({
      workflow,
      run: seeded,
      manifest: source.manifest,
      startStepId: step.id,
      hydratedKeys: hydration.hydratedKeys
    })
    if (!seededRun.ok) {
      const message = seededRun.error ?? "Workflow artifact run seeding failed."
      await vscode.window.showErrorMessage(message)
      return message
    }
    await runStore.saveRun(seeded)
    const engine = this.options.runtimeFactory.createEngine(root)
    const result = await engine.resumeRun(seeded.runId, { workflow })
    await vscode.window.showInformationMessage(`Workflow run ${result.status}: ${result.runId}; reused ${seededRun.reusedStepIds.length} step(s) from ${source.run.runId}`)
    return result
  }

  async importArtifactsFromTaskSnapshots(runId?: string): Promise<unknown> {
    const trustError = await requireTrustedWorkspace("import artifacts from task snapshots")
    if (trustError) return trustError
    await this.ensureWorkflowsLoaded()
    const selection = await this.selectRun(runId)
    if (!selection) return runId ? `Workflow run not found: ${runId}` : "No workflow run selected."
    const runStore = this.options.runtimeFactory.createRunStore(selection.root)
    if (workflowRunExecutionActiveForWorkspace(selection.root, selection.runId)) {
      throw new Error(`Cannot import task snapshot artifacts while workflow run is executing: ${selection.runId}`)
    }
    const imported = await this.options.coordinateGateDecision(
      selection.root,
      selection.runId,
      "artifact-import",
      () => coordinateWorkflowRunExecution(runStore, selection.runId, "importTaskSnapshotArtifacts", async () => {
        const run = await runStore.loadRun(selection.runId)
        if (!run) throw new Error(`Workflow run not found: ${selection.runId}`)
        const workflow = this.options.coreWorkflows.get(run.workflowId)
        if (!workflow) throw new Error(`Workflow definition is not loaded: ${run.workflowId}`)
        const result = await importTaskSnapshotArtifacts({
          workflow,
          run,
          snapshotStore: new FileTaskSnapshotStore({ workspaceRoot: selection.root }),
          persistStateRollback: () => runStore.saveRun(run),
          writeFiles: (writes, commitState) => writeWorkspaceFilesAtomically(selection.root, writes, async () => {
            await Promise.resolve(commitState())
            await runStore.saveRun(run)
          })
        })
        return { result, run, workflow }
      })
    )
    const { result, run, workflow } = imported
    const lines = [
      `- runId: ${run.runId}`,
      `- workflow: ${workflow.id}`,
      `- imported: ${result.importedCount}`,
      `- manifest: ${result.manifest ? "updated" : "not updated"}`,
      "",
      "Issues:",
      ...formatSnapshotImportIssues(result.issues)
    ]
    await showMarkdownReport("Task Snapshot Artifact Import", result.ok ? "Imported artifacts from task snapshots." : "No artifacts were imported from task snapshots.", lines)
    return result
  }

  async runNextStep(runArg?: RunCommandArg): Promise<unknown> {
    const trustError = await requireTrustedWorkspace("run next workflow step")
    if (trustError) return trustError
    await this.ensureWorkflowsLoaded()
    const roots = await this.options.workflowRootCandidates()
    if (roots.length === 0) {
      const message = "No workspace folder is open."
      await vscode.window.showErrorMessage(message)
      return message
    }
    const runId = resolveRunId(runArg)
    const selection = await this.selectRunArgument(runArg, roots)
    if (!selection) {
      const message = runId ? `Workflow run not found: ${runId}` : "No workflow run selected."
      if (runId) await vscode.window.showWarningMessage(message)
      return message
    }
    if (workflowRunExecutionActiveForWorkspace(selection.root, selection.runId)) {
      throw new Error(`Cannot run the next step while workflow run is executing: ${selection.runId}`)
    }
    return this.options.coordinateGateDecision(
      selection.root,
      selection.runId,
      "run-next",
      () => this.runNextStepOnce(
        selection.root,
        selection.runId,
        isOperationHubRunMutationTarget(runArg) ? runArg.expectedRevision : undefined
      )
    )
  }

  private async runNextStepOnce(root: string, runId: string, expectedRevision?: string): Promise<unknown> {
    if (expectedRevision) await assertOperationHubRunRevision(root, runId, expectedRevision)
    const runStore = this.options.runtimeFactory.createRunStore(root)
    const run = await runStore.loadRun(runId)
    if (!run) throw new Error(`Workflow run not found: ${runId}`)
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
    const agentProvider = reviewTaskRegistry.agentProviderForRun(root, run.runId, workflow)
    const pendingTransitionStepId = pendingReviewTransitionStepId(run)
    if (pendingTransitionStepId) {
      const engine = this.options.runtimeFactory.createEngine(root, agentProvider)
      const result = await engine.runWorkflow(workflow, run.inputs, {
        executionMode: "singleStep",
        stepId: pendingTransitionStepId,
        allowOutOfOrder: workflow.stepExecution.allowOutOfOrder
      })
      await this.reconcileBobTask(root, result, workflow, "operation-hub-next")
      await vscode.window.showInformationMessage(`Workflow run ${result.status}: ${result.runId}`)
      return result
    }
    const next = run.steps.find((step) => step.status === "pending")
    if (!next) {
      if (run.status !== "completed" && run.steps.every((step) => step.status === "completed")) {
        run.status = "completed"
        run.currentStep = undefined
        run.error = undefined
        await this.reconcileBobTask(root, run, workflow, "operation-hub-next")
      } else {
        await runStore.saveRun(run)
      }
      const message = run.status === "completed"
        ? `Workflow run completed: ${run.runId}`
        : `No pending workflow step: ${run.runId}`
      await vscode.window.showInformationMessage(message)
      return run
    }
    const engine = this.options.runtimeFactory.createEngine(root, agentProvider)
    const result = await engine.runWorkflow(workflow, run.inputs, {
      executionMode: "singleStep",
      stepId: next.id,
      allowOutOfOrder: workflow.stepExecution.allowOutOfOrder
    })
    await this.reconcileBobTask(root, result, workflow, "operation-hub-next")
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
        `bobTaskSync=${run?.bobTaskSync?.drift?.status ?? "unknown"}`,
        `updatedAt=${run?.updatedAt}`
      ].join("; "))
    await showMarkdownReport("Workflow Runs", `${runsByRoot.length} run(s).`, lines)
  }

  async resumeRun(runArg?: RunCommandArg): Promise<unknown> {
    return this.resumeOrRetryRun("resume", runArg)
  }

  async retryCurrentStep(runArg?: RunCommandArg): Promise<unknown> {
    return this.resumeOrRetryRun("retry", runArg)
  }

  async approveBranchCheckpoint(runId?: string): Promise<unknown> {
    const trustError = await requireTrustedWorkspace("approve branch checkpoint")
    if (trustError) return trustError
    await this.ensureWorkflowsLoaded()
    const selection = await this.selectRun(runId)
    if (!selection) return runId ? `Workflow run not found: ${runId}` : "No workflow run selected."
    return this.options.coordinateGateDecision(selection.root, selection.runId, "checkpoint-approve", async () => {
      const runStore = this.options.runtimeFactory.createRunStore(selection.root)
      const run = await runStore.loadRun(selection.runId)
      if (!run) throw new Error(`Workflow run not found: ${selection.runId}`)
      const workflow = this.options.coreWorkflows.get(run.workflowId)
      if (!workflow) throw new Error(`Workflow definition is not loaded: ${run.workflowId}`)
      const engine = this.options.runtimeFactory.createEngine(selection.root)
      const result = await engine.approveBranchCheckpoint(selection.runId, workflow)
      if (this.options.gateRegistry.pendingForRun(selection.root, selection.runId)) {
        this.options.gateRegistry.acceptPending(selection.root, selection.runId)
      }
      await vscode.window.showInformationMessage(`Branch checkpoint approved: ${result.runId}`)
      return result
    })
  }

  async abortBranchCheckpoint(runId?: string): Promise<unknown> {
    const trustError = await requireTrustedWorkspace("abort branch checkpoint")
    if (trustError) return trustError
    const selection = await this.selectRun(runId)
    if (!selection) return runId ? `Workflow run not found: ${runId}` : "No workflow run selected."
    return this.options.coordinateGateDecision(selection.root, selection.runId, "checkpoint-abort", async () => {
      const engine = this.options.runtimeFactory.createEngine(selection.root)
      const result = await engine.abortBranchCheckpoint(selection.runId, CHECKPOINT_ABORT_REASON)
      this.options.gateRegistry.abortPending(selection.root, selection.runId, CHECKPOINT_ABORT_REASON)
      await vscode.window.showInformationMessage(`Branch checkpoint aborted: ${result.runId}`)
      return result
    })
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

  private async resumeOrRetryRun(mode: "resume" | "retry", runArg?: RunCommandArg): Promise<unknown> {
    const trustError = await requireTrustedWorkspace(`${mode} workflow run`)
    if (trustError) return trustError
    await this.ensureWorkflowsLoaded()
    const roots = await this.options.workflowRootCandidates()
    const runId = resolveRunId(runArg)
    const selection = await this.selectRunArgument(runArg, roots)
    if (!selection) {
      const message = "No workspace folder is open."
      if (!runId) return "No workflow run selected."
      await vscode.window.showErrorMessage(`Workflow run not found: ${runId}`)
      return message
    }
    return this.options.coordinateGateDecision(
      selection.root,
      selection.runId,
      mode === "resume" ? "run-resume" : "run-retry",
      () => (
        this.resumeOrRetryRunOnce(
          mode,
          selection.root,
          selection.runId,
          isOperationHubRunMutationTarget(runArg) ? runArg.expectedRevision : undefined
        )
      )
    )
  }

  private async resumeOrRetryRunOnce(
    mode: "resume" | "retry",
    root: string,
    runId: string,
    expectedRevision?: string
  ): Promise<unknown> {
    if (expectedRevision) await assertOperationHubRunRevision(root, runId, expectedRevision)
    const runStore = this.options.runtimeFactory.createRunStore(root)
    const run = await runStore.loadRun(runId)
    if (!run) throw new Error(`Workflow run not found: ${runId}`)
    if (mode === "resume" && run.status === "checkpoint") {
      return this.warnStepGate("Current run is waiting at a branch checkpoint. Approve or abort the checkpoint before resuming.")
    }
    const workflow = this.options.coreWorkflows.get(run.workflowId)
    if (!workflow) throw new Error(`Workflow definition is not loaded: ${run.workflowId}`)
    const liveGate = this.options.gateRegistry.pendingForRun(root, runId)
    if (mode === "resume" && run.status === "paused" && liveGate?.status === "paused" && ownerStepCompleted(run, liveGate)) {
      await new FileRunControlStore({ workspaceRoot: root }).clearPause(runId)
      run.status = "running"
      run.error = undefined
      await runStore.saveRun(run)
      this.options.gateRegistry.acceptPending(root, runId)
      await vscode.window.showInformationMessage(`Workflow run ${run.status}: ${run.runId}`)
      return run
    }

    const agentProvider = reviewTaskRegistry.agentProviderForRun(root, run.runId, workflow)
    const engine = this.options.runtimeFactory.createEngine(root, agentProvider)
    const result = mode === "resume"
      ? await engine.resumeRun(runId, {
        workflow,
        completeHeldStep: true,
        executionMode: liveGate ? "singleStep" : undefined
      })
      : await engine.retryCurrentStep(runId, workflow, {
        executionMode: liveGate ? "singleStep" : undefined
      })
    if (liveGate) {
      this.updateLiveGateAfterCommand(root, result, liveGate)
    } else {
      await this.reconcileBobTask(root, result, workflow, mode === "resume" ? "operation-hub-resume" : "operation-hub-retry")
    }
    await vscode.window.showInformationMessage(`Workflow run ${result.status}: ${result.runId}`)
    return result
  }

  private updateLiveGateAfterCommand(
    root: string,
    run: WorkflowRunState,
    gate: BobWorkflowGateDecision & { ownerStepId: string }
  ): void {
    const stepId = run.currentStep ?? gate.stepId
    if (isHumanGateStatus(run.status)) {
      this.options.gateRegistry.rebind(root, run.runId, { stepId, status: run.status })
      return
    }
    if (ownerStepCompleted(run, gate) || run.status === "completed") {
      this.options.gateRegistry.acceptPending(root, run.runId)
      return
    }
    this.options.gateRegistry.rebind(root, run.runId, { stepId, status: run.status })
  }

  private async pickArtifactSourceRun(
    root: string,
    workflow: CoreWorkflowDefinition,
    inputs: Record<string, unknown>,
    sourceRunId?: string
  ): Promise<ArtifactSourceRunSelection | undefined> {
    const runStore = this.options.runtimeFactory.createRunStore(root)
    const runs = await runStore.listRuns()
    const candidates: ArtifactSourceRunSelection[] = []
    for (const run of runs) {
      if (sourceRunId && run.runId !== sourceRunId) continue
      if (!isWorkflowRunStateWritable(run)) {
        if (sourceRunId) assertWorkflowRunStateWritable(run)
        continue
      }
      const manifest = await loadArtifactManifest(root, run)
      if (!manifest) continue
      const issues = validateWorkflowArtifactManifest({ manifest, workflow, inputs })
      if (issues.some((issue) => issue.severity === "error")) continue
      candidates.push({ root, run, manifest })
    }
    if (sourceRunId) return candidates[0]
    if (candidates.length === 0) return undefined
    if (candidates.length === 1) return candidates[0]
    const picked = await vscode.window.showQuickPick(candidates.map((candidate) => ({
      label: candidate.run.runId,
      description: candidate.run.status,
      detail: `${candidate.manifest.artifacts.length} artifact(s); updated=${candidate.run.updatedAt}`,
      candidate
    })), { title: `Artifact source run: ${workflow.label}` })
    return picked?.candidate
  }

  private async reconcileBobTask(root: string, run: WorkflowRunState, workflow: CoreWorkflowDefinition, reason: BobTaskSyncReason): Promise<void> {
    const sync = await bobTaskSyncRegistry.reconcileRun(root, run, workflow, {
      reason,
      task: reviewTaskRegistry.taskForRun(root, run.runId)
    })
    if (sync.status !== "synced") console.warn(sync.message)
    await this.options.runtimeFactory.createRunStore(root).saveRun(run)
  }

  private async ensureWorkflowsLoaded(): Promise<void> {
    if (this.options.coreWorkflows.size === 0) await this.options.ensureWorkflowsLoaded()
  }

  private async selectRunArgument(
    runArg: RunCommandArg,
    roots: MarkerRootCandidate[]
  ): Promise<RunSelection | undefined> {
    if (isOperationHubRunMutationTarget(runArg)) {
      const validated = await validateOperationHubRunMutationTarget(
        runArg,
        roots.map((candidate) => candidate.root)
      )
      return {
        root: validated.workspaceRoot,
        runId: runArg.runId,
        run: validated.snapshot.run
      }
    }
    const runId = resolveRunId(runArg)
    return runId
      ? findRunSelection(runId, roots, (root) => this.options.runtimeFactory.createRunStore(root))
      : pickRunSelection(roots, (root) => this.options.runtimeFactory.createRunStore(root))
  }

  private async validateOperationHubWorkflowRoot(
    target: OperationHubWorkflowMutationTarget,
    workflow: CoreWorkflowDefinition
  ): Promise<string> {
    const roots = await this.options.workflowRootCandidates()
    const workspaceRoot = await canonicalOperationHubWorkspaceRoot(
      target.workspaceRoot,
      roots.map((candidate) => candidate.root)
    )
    if (workflow.workflowRoot) {
      await canonicalOperationHubWorkspaceRoot(workflow.workflowRoot, [workspaceRoot])
    }
    return workspaceRoot
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

async function loadArtifactManifest(root: string, run: WorkflowRunState): Promise<WorkflowArtifactManifest | undefined> {
  const fromState = parseWorkflowArtifactManifest(run.state["workflow.artifactManifest"])
  if (fromState) return fromState
  try {
    const snapshot = await readContainedRunArtifactManifest(root, run.runId)
    return parseWorkflowArtifactManifest(snapshot.bytes.toString("utf8"))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

async function readPhysicallyContainedWorkspaceFile(root: string, relativePath: string): Promise<string> {
  const lexicalRoot = path.resolve(root)
  const lexicalTarget = path.resolve(lexicalRoot, relativePath)
  assertContainedWorkspacePath(lexicalRoot, lexicalTarget, relativePath)
  const [physicalRoot, physicalTarget] = await Promise.all([
    fs.realpath(lexicalRoot),
    fs.realpath(lexicalTarget)
  ])
  assertContainedWorkspacePath(physicalRoot, physicalTarget, relativePath)
  const handle = await fs.open(physicalTarget, "r")
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error(`Artifact path is not a regular file: ${relativePath}`)
    return await handle.readFile({ encoding: "utf8" })
  } finally {
    await handle.close()
  }
}

function assertContainedWorkspacePath(root: string, target: string, label: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Artifact path escapes the physical workspace root: ${label}`)
  }
}

function formatSnapshotImportIssues(issues: TaskSnapshotArtifactImportIssue[]): string[] {
  if (issues.length === 0) return ["- ok: No task snapshot import issues."]
  return issues.map((issue) => `- ${issue.severity}: ${issue.artifactId ? `${issue.artifactId}: ` : ""}${issue.message}`)
}

function resolveRunId(value: RunCommandArg): string | undefined {
  if (typeof value === "string") return value
  if (!value || typeof value !== "object") return undefined
  if (typeof value.runId === "string") return value.runId
  if ("run" in value && value.run && typeof value.run.runId === "string") return value.run.runId
  return undefined
}

function ownerStepCompleted(
  run: WorkflowRunState,
  gate: BobWorkflowGateDecision & { ownerStepId: string }
): boolean {
  return run.steps.find((step) => step.id === gate.ownerStepId)?.status === "completed"
}

function isHumanGateStatus(status: WorkflowRunState["status"]): boolean {
  return status === "reviewing" || status === "held" || status === "checkpoint" || status === "paused"
}
