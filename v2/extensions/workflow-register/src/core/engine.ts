import * as path from "path"
import { ActionRegistry } from "./actionRegistry"
import { approveHeldWorkflowStep } from "./approvalGuardrails"
import {
  createDefaultPreflightChecks,
  evaluatePreflight,
  exists
} from "./engine/preflight"
import {
  archiveAttempt,
  blockedPreviousStep,
  clearPendingReviewTransition,
  missingRequiredState,
  markPendingReviewTransition,
  nextPendingIndex,
  noteDefinitionMismatch,
  pendingReviewTransitionStepId,
  shouldPauseForStepReview,
  startIndexForRun,
  validateRetryCompatibility,
  validateRunStepCompatibility,
  workflowStepReview
} from "./engine/runState"
import {
  writeProducedArtifacts as writeEngineProducedArtifacts,
} from "./engine/resultWriters"
import { prepareRetryResultRecovery } from "./engine/recoveryState"
import {
  completeStepIfManual as completeEngineStepIfManual,
  waitForManualCompletion as waitForEngineManualCompletion
} from "./engine/manualCompletion"
import { pauseRunIfRequested } from "./engine/runPause"
import { executeAutomatedStep } from "./engine/stepExecutor"
import {
  abortBranchCheckpointTransition,
  applyStepTransition,
  approveBranchCheckpointTransition
} from "./engine/branchTransitions"
import { validateWorkflowInputs } from "./inputResolver"
import {
  AgentProvider,
  CoreWorkflowDefinition,
  EngineStep,
  RunStepState,
  WorkflowRunState
} from "./model"
import type {
  ResumeRunOptions,
  RunWorkflowOptions,
  WorkflowEngineEventInput,
  WorkflowEngineOptions,
  WorkflowExecutionHooks,
  WorkflowExecutionMode
} from "./engineTypes"
import { ResultSinkRegistry } from "./resultSinkRegistry"
import { FileRunControlStore, RunControlStore } from "./runControlStore"
import { RunStateStore } from "./runStateStore"

export type { WorkflowPreflightCheckInput, WorkflowPreflightCheckResult } from "./engine/preflight"
export type {
  ManualCompletionInput,
  ManualCompletionResult,
  RecoverResultTextInput,
  ResumeRunOptions,
  RunWorkflowOptions,
  WorkflowEngineEventInput,
  WorkflowEngineOptions,
  WorkflowExecutionHooks,
  WorkflowExecutionMode
} from "./engineTypes"

export class WorkflowEngine {
  private readonly actions: ActionRegistry
  private readonly resultSinks: ResultSinkRegistry
  private readonly runStore: RunStateStore
  private readonly runControlStore?: RunControlStore
  private readonly agentProvider?: AgentProvider
  private readonly workspaceAvailable?: WorkflowEngineOptions["workspaceAvailable"]
  private readonly fileExists?: WorkflowEngineOptions["fileExists"]
  private readonly preflightChecks: NonNullable<WorkflowEngineOptions["preflightChecks"]>
  private readonly strictPreflightChecks: boolean
  private readonly hooks: WorkflowExecutionHooks
  private readonly manualCompletion?: NonNullable<WorkflowEngineOptions["manualCompletion"]>
  private readonly recoverResultText?: NonNullable<WorkflowEngineOptions["recoverResultText"]>

  constructor(options: WorkflowEngineOptions) {
    this.actions = options.actions
    this.resultSinks = options.resultSinks
    this.runStore = options.runStore
    const workspaceRoot = options.runStore.workspaceRoot
    this.runControlStore = options.runControlStore ?? (workspaceRoot ? new FileRunControlStore({ workspaceRoot }) : undefined)
    this.agentProvider = options.agentProvider
    this.workspaceAvailable = options.workspaceAvailable ?? (workspaceRoot ? (() => true) : undefined)
    this.fileExists = options.fileExists ?? (workspaceRoot ? ((relativePath) => exists(path.join(workspaceRoot, relativePath))) : undefined)
    this.preflightChecks = {
      ...createDefaultPreflightChecks(workspaceRoot),
      ...(options.preflightChecks ?? {})
    }
    this.strictPreflightChecks = options.strictPreflightChecks === true
    this.hooks = options.hooks ?? {}
    this.manualCompletion = options.manualCompletion
    this.recoverResultText = options.recoverResultText
  }

  async runWorkflow(workflow: CoreWorkflowDefinition, inputs: Record<string, unknown>, options: RunWorkflowOptions = {}): Promise<WorkflowRunState> {
    const recoveredRun = await this.runStore.findRecoverableRun?.(workflow, inputs, options)
    const run = recoveredRun ?? await this.runStore.createRun(workflow, inputs)
    await this.runStore.saveRun(run)
    if (!recoveredRun) await this.emit(this.hooks.onWorkflowStart, { workflow, run })
    if (run.status === "checkpoint") return run
    if (run.status === "paused") return run
    if (run.status === "reviewing" && !isOrderedSingleStepContinuation(options)) return run
    const inputProblems = validateWorkflowInputs(workflow.inputs ?? {}, run.inputs)
    if (inputProblems.length > 0) {
      run.status = "failed"
      run.error = inputProblems.join("; ")
      await this.runStore.saveRun(run)
      await this.emit(this.hooks.onWorkflowFailed, { workflow, run, error: run.error })
      return run
    }

    if (
      await this.pauseIfRequested(
        workflow,
        run,
        workflow.engineSteps.find((step) => step.id === run.currentStep),
        "before-preflight"
      )
    ) {
      return run
    }

    const preflight = await evaluatePreflight({
      workflow,
      run,
      workspaceAvailable: this.workspaceAvailable,
      fileExists: this.fileExists,
      preflightChecks: this.preflightChecks,
      strictPreflightChecks: this.strictPreflightChecks
    })
    if (preflight.warnings.length > 0) run.state["workflow.preflightWarnings"] = JSON.stringify(preflight.warnings)
    if (preflight.errors.length > 0) {
      run.status = "failed"
      run.error = `Workflow preflight failed: ${preflight.errors.join("; ")}`
      await this.runStore.saveRun(run)
      await this.emit(this.hooks.onWorkflowFailed, { workflow, run, error: run.error })
      return run
    }

    const startIndex = startIndexForRun(workflow, run, options)
    const blocked = blockedPreviousStep(workflow, run, startIndex, options)
    if (blocked) {
      const step = workflow.engineSteps[startIndex]
      const stepState = run.steps[startIndex]
      const error = blockedStepMessage(step, blocked)
      if (isReviewOrHeldGate(blocked)) {
        run.status = blocked.status
        run.currentStep = blocked.id
        run.error = error
        resetBlockedTargetStep(stepState)
        await this.runStore.saveRun(run)
        return run
      }
      run.status = "failed"
      run.currentStep = step.id
      run.error = error
      stepState.status = "failed"
      stepState.error = error
      await this.runStore.saveRun(run)
      await this.emit(this.hooks.onStepFailed, { workflow, run, step, error })
      return run
    }
    noteDefinitionMismatch(run, workflow)
    run.status = "running"
    run.error = undefined
    await this.runStore.saveRun(run)
    return this.continueRun(workflow, run, startIndex, options.executionMode ?? "full")
  }

  async resumeRun(runId: string, options: ResumeRunOptions): Promise<WorkflowRunState> {
    const run = await this.runStore.loadRun(runId)
    if (!run) throw new Error(`Workflow run not found: ${runId}`)
    if (run.status === "checkpoint") throw new Error("Workflow run is waiting at a branch checkpoint. Approve or abort the checkpoint before resuming.")
    if (run.status === "reviewing") throw new Error("Workflow run is waiting for step review. Accept the current step or retry it before resuming.")
    let startIndex = options.workflow.engineSteps.findIndex((step) => step.id === run.currentStep)
    if (startIndex < 0) startIndex = nextPendingIndex(run)
    validateRunStepCompatibility(run, options.workflow, startIndex)
    noteDefinitionMismatch(run, options.workflow)
    if (run.status === "paused") {
      await this.runControlStore?.clearPause(runId)
      run.status = "running"
      run.error = undefined
    }
    if (run.status === "held" && options.completeHeldStep && startIndex >= 0) {
      const held = run.steps[startIndex]
      if (approveHeldWorkflowStep(run, held.id)) {
        held.status = "pending"
        held.error = undefined
        held.startedAt = undefined
      } else {
        held.status = "completed"
        held.completedAt = new Date().toISOString()
        startIndex += 1
      }
      run.status = "running"
    }
    await this.runStore.saveRun(run)
    return this.continueRun(options.workflow, run, Math.max(0, startIndex), "full")
  }

  async retryCurrentStep(runId: string, workflow: CoreWorkflowDefinition): Promise<WorkflowRunState> {
    const run = await this.runStore.loadRun(runId)
    if (!run) throw new Error(`Workflow run not found: ${runId}`)
    const review = workflowStepReview(workflow)
    if (!review.allowRetry) throw new Error("This workflow does not allow step retry.")
    const index = workflow.engineSteps.findIndex((step) => step.id === run.currentStep)
    if (index < 0) throw new Error(`Current step is not part of workflow ${workflow.id}: ${run.currentStep ?? "none"}`)
    validateRetryCompatibility(run, workflow, index)
    const step = workflow.engineSteps[index]
    const stepState = run.steps[index]
    if (review.preserveAttempts) archiveAttempt(stepState, run.state, stepState.status === "reviewing" ? "rejected" : undefined)
    prepareRetryResultRecovery(run, step, stepState)
    run.status = "running"
    run.error = undefined
    stepState.status = "pending"
    stepState.error = undefined
    stepState.startedAt = undefined
    stepState.completedAt = undefined
    stepState.reviewStartedAt = undefined
    stepState.acceptedAt = undefined
    stepState.attempt = (stepState.attempts?.length ?? 0) + 1
    if ("resultKey" in step && step.resultKey) delete run.state[step.resultKey]
    noteDefinitionMismatch(run, workflow)
    await this.runStore.saveRun(run)
    return this.continueRun(workflow, run, index, "full")
  }

  async approveBranchCheckpoint(runId: string, workflow: CoreWorkflowDefinition): Promise<WorkflowRunState> {
    const run = await this.runStore.loadRun(runId)
    if (!run) throw new Error(`Workflow run not found: ${runId}`)
    const result = approveBranchCheckpointTransition(workflow, run)
    if (!result.ok) throw new Error(result.error)
    await this.runStore.saveRun(run)
    return run
  }

  async abortBranchCheckpoint(runId: string, reason?: string): Promise<WorkflowRunState> {
    const run = await this.runStore.loadRun(runId)
    if (!run) throw new Error(`Workflow run not found: ${runId}`)
    const result = abortBranchCheckpointTransition(run, reason)
    if (!result.ok) throw new Error(result.error)
    await this.runStore.saveRun(run)
    return run
  }

  private async continueRun(
    workflow: CoreWorkflowDefinition,
    run: WorkflowRunState,
    startIndex: number,
    mode: WorkflowExecutionMode
  ): Promise<WorkflowRunState> {
    const pendingTransition = await this.applyPendingReviewedTransition(workflow, run, startIndex, mode)
    if (pendingTransition.done) return run
    const endIndex = mode === "singleStep"
      ? Math.min(pendingTransition.startIndex + 1, workflow.engineSteps.length)
      : workflow.engineSteps.length
    for (let index = pendingTransition.startIndex; index < endIndex; index += 1) {
      const step = workflow.engineSteps[index]
      const stepState = run.steps[index]
      run.currentStep = step.id
      if (await this.pauseIfRequested(workflow, run, step, `before-step:${step.id}`)) return run
      const missingState = missingRequiredState(step, run.state)
      if (missingState.length > 0) {
        const error = `Workflow state is missing for step ${step.id}: ${missingState.join(", ")}`
        stepState.status = "failed"
        stepState.error = error
        run.status = "failed"
        run.error = error
        await this.runStore.saveRun(run)
        await this.emit(this.hooks.onStepFailed, { workflow, run, step, error })
        return run
      }
      run.status = "running"
      stepState.status = "running"
      stepState.attempt = stepState.attempt ?? ((stepState.attempts?.length ?? 0) + 1)
      stepState.startedAt = new Date().toISOString()
      await this.runStore.saveRun(run)
      await this.emit(this.hooks.onStepStart, { workflow, run, step })

      const stepResult = await this.executeStep(workflow, run, step)
      if (!stepResult.ok) {
        stepState.status = stepResult.held ? "held" : "failed"
        stepState.error = stepResult.error
        run.status = stepResult.held ? "held" : "failed"
        run.error = stepResult.error
        run.currentStep = step.id
        await this.runStore.saveRun(run)
        await this.emit(stepResult.held ? this.hooks.onStepHeld : this.hooks.onStepFailed, { workflow, run, step, error: stepResult.error })
        return run
      }

      const artifactResult = await writeEngineProducedArtifacts({
        workflow,
        run,
        step,
        resultSinks: this.resultSinks
      })
      if (!artifactResult.ok) {
        stepState.status = "failed"
        stepState.error = artifactResult.error
        run.status = "failed"
        run.error = artifactResult.error
        run.currentStep = step.id
        await this.runStore.saveRun(run)
        await this.emit(this.hooks.onStepFailed, { workflow, run, step, error: artifactResult.error })
        return run
      }

      const completion = await completeEngineStepIfManual({
        workflow,
        run,
        step,
        manualCompletion: this.manualCompletion
      })
      if (!completion.ok) {
        stepState.status = completion.held ? "held" : "failed"
        stepState.error = completion.error
        run.status = completion.held ? "held" : "failed"
        run.error = completion.error
        run.currentStep = step.id
        await this.runStore.saveRun(run)
        await this.emit(completion.held ? this.hooks.onStepHeld : this.hooks.onStepFailed, { workflow, run, step, error: completion.error })
        return run
      }

      if (shouldPauseForStepReview(workflow, step, mode)) {
        markPendingReviewTransition(run, step)
        stepState.status = "reviewing"
        stepState.reviewStartedAt = new Date().toISOString()
        stepState.error = undefined
        run.status = "reviewing"
        run.currentStep = step.id
        run.error = undefined
        await this.runStore.saveRun(run)
        await this.emit(this.hooks.onStepReviewRequired, { workflow, run, step })
        return run
      }

      stepState.status = "completed"
      stepState.completedAt = new Date().toISOString()
      stepState.error = undefined
      await this.runStore.saveRun(run)
      await this.emit(this.hooks.onStepCompleted, { workflow, run, step })
      const transition = applyStepTransition({ workflow, run, step, stepIndex: index, mode })
      if (transition.action === "end") {
        await this.runStore.saveRun(run)
        await this.emit(this.hooks.onWorkflowCompleted, { workflow, run })
        return run
      }
      if (transition.action === "fail") {
        await this.runStore.saveRun(run)
        await this.emit(this.hooks.onStepFailed, { workflow, run, step, error: transition.error })
        return run
      }
      if (transition.action === "goto") {
        await this.runStore.saveRun(run)
        if (transition.stop) return run
        index = transition.nextIndex - 1
        continue
      }
      if (transition.action === "checkpoint") {
        await this.runStore.saveRun(run)
        return run
      }
      const nextStep = workflow.engineSteps[index + 1]
      if (nextStep && await this.pauseIfRequested(workflow, run, nextStep, `after-step:${step.id}`)) return run
    }

    if (mode === "singleStep" && endIndex < workflow.engineSteps.length) {
      run.status = "running"
      run.error = undefined
      await this.runStore.saveRun(run)
      return run
    }

    run.status = "completed"
    run.currentStep = undefined
    run.error = undefined
    await this.runStore.saveRun(run)
    await this.emit(this.hooks.onWorkflowCompleted, { workflow, run })
    return run
  }

  private async applyPendingReviewedTransition(
    workflow: CoreWorkflowDefinition,
    run: WorkflowRunState,
    startIndex: number,
    mode: WorkflowExecutionMode
  ): Promise<{ startIndex: number; done: boolean }> {
    const stepId = pendingReviewTransitionStepId(run)
    if (!stepId || run.status === "reviewing") return { startIndex, done: false }
    const stepIndex = workflow.engineSteps.findIndex((candidate) => candidate.id === stepId)
    if (stepIndex < 0 || run.steps[stepIndex]?.status !== "completed") {
      clearPendingReviewTransition(run)
      return { startIndex, done: false }
    }

    const step = workflow.engineSteps[stepIndex]
    clearPendingReviewTransition(run)
    await this.emit(this.hooks.onStepCompleted, { workflow, run, step })
    const transition = applyStepTransition({ workflow, run, step, stepIndex, mode })
    if (transition.action === "next") {
      const nextStep = workflow.engineSteps[transition.nextIndex]
      if (!nextStep) {
        run.status = "completed"
        run.currentStep = undefined
        run.error = undefined
        await this.runStore.saveRun(run)
        await this.emit(this.hooks.onWorkflowCompleted, { workflow, run })
        return { startIndex: transition.nextIndex, done: true }
      }
      run.status = "running"
      run.currentStep = nextStep.id
      run.error = undefined
      await this.runStore.saveRun(run)
      return { startIndex: transition.nextIndex, done: false }
    }
    if (transition.action === "end") {
      await this.runStore.saveRun(run)
      await this.emit(this.hooks.onWorkflowCompleted, { workflow, run })
      return { startIndex, done: true }
    }
    if (transition.action === "fail") {
      await this.runStore.saveRun(run)
      await this.emit(this.hooks.onStepFailed, { workflow, run, step, error: transition.error })
      return { startIndex, done: true }
    }
    if (transition.action === "goto") {
      await this.runStore.saveRun(run)
      return transition.stop
        ? { startIndex: transition.nextIndex, done: true }
        : { startIndex: transition.nextIndex, done: false }
    }
    if (transition.action === "checkpoint") {
      await this.runStore.saveRun(run)
      return { startIndex: transition.nextIndex, done: true }
    }
    return { startIndex, done: false }
  }

  private async executeStep(
    workflow: CoreWorkflowDefinition,
    run: WorkflowRunState,
    step: EngineStep
  ): Promise<{ ok: true } | { ok: false; held?: boolean; error: string }> {
    if (step.type === "manual") {
      return waitForEngineManualCompletion({
        workflow,
        run,
        step,
        manualCompletion: this.manualCompletion
      })
    }
    return executeAutomatedStep({
      workflow,
      run,
      step,
      actions: this.actions,
      agentProvider: this.agentProvider,
      resultSinks: this.resultSinks,
      recoverResultText: this.recoverResultText,
      emitAgentOutput: (event) => this.emit(this.hooks.onAgentOutput, event),
      emitCommandResult: (event) => this.emit(this.hooks.onCommandResult, event),
      emitHandoffFailed: (event) => this.emit(this.hooks.onHandoffFailed, event)
    })
  }

  private async pauseIfRequested(
    workflow: CoreWorkflowDefinition,
    run: WorkflowRunState,
    nextStep: EngineStep | undefined,
    checkpoint: string
  ): Promise<boolean> {
    return pauseRunIfRequested({
      workflow,
      run,
      nextStep,
      checkpoint,
      runStore: this.runStore,
      runControlStore: this.runControlStore,
      emitRunPaused: (event) => this.emit(this.hooks.onRunPaused, event)
    })
  }

  private async emit(hook: ((event: WorkflowEngineEventInput) => Promise<void> | void) | undefined, event: WorkflowEngineEventInput): Promise<void> {
    if (hook) await hook(event)
  }
}

function isOrderedSingleStepContinuation(options: RunWorkflowOptions): boolean {
  return options.executionMode === "singleStep" && typeof options.stepId === "string" && options.stepId.length > 0
}

function isReviewOrHeldGate(step: RunStepState): step is RunStepState & { status: "reviewing" | "held" } {
  return step.status === "reviewing" || step.status === "held"
}

function blockedStepMessage(target: EngineStep, blocked: RunStepState): string {
  if (blocked.status === "reviewing") {
    return `Current step '${blocked.id}' is waiting for step review. Accept or retry it before running step '${target.id}'.`
  }
  if (blocked.status === "held") {
    return `Current step '${blocked.id}' is held. Complete it before running step '${target.id}'.`
  }
  return `Step '${target.id}' cannot run before previous step '${blocked.id}' is completed.`
}

function resetBlockedTargetStep(step: RunStepState | undefined): void {
  if (!step || step.status !== "failed") return
  step.status = "pending"
  step.error = undefined
  step.startedAt = undefined
  step.completedAt = undefined
  step.reviewStartedAt = undefined
  step.acceptedAt = undefined
}
