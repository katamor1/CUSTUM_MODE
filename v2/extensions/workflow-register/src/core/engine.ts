import * as path from "path"
import { ActionRegistry } from "./actionRegistry"
import {
  createDefaultPreflightChecks,
  evaluatePreflight,
  exists,
  WorkflowPreflightCheckInput,
  WorkflowPreflightCheckResult
} from "./engine/preflight"
import {
  archiveAttempt,
  blockedPreviousStep,
  missingRequiredState,
  nextPendingIndex,
  noteDefinitionMismatch,
  shouldPauseForStepReview,
  startIndexForRun,
  validateRetryCompatibility,
  validateRunStepCompatibility,
  workflowStepReview
} from "./engine/runState"
import {
  formatStateValue,
  renderArtifactPath,
  renderTemplate,
  renderValue,
  replacementResultText
} from "./engine/templateRenderer"
import { validateCommandGuardrails } from "./guardrails"
import { validateWorkflowInputs } from "./inputResolver"
import {
  AgentProvider,
  CoreWorkflowDefinition,
  EngineStep,
  ResultSourceDefinition,
  WorkflowRunState
} from "./model"
import { reportedActionError } from "./reportedActionError"
import { ResultSinkRegistry } from "./resultSinkRegistry"
import { FileRunControlStore, RunControlState, RunControlStore } from "./runControlStore"
import { RunStateStore } from "./runStateStore"

export type { WorkflowPreflightCheckInput, WorkflowPreflightCheckResult } from "./engine/preflight"

export type WorkflowExecutionMode = "full" | "singleStep"

export interface RunWorkflowOptions {
  executionMode?: WorkflowExecutionMode
  stepId?: string
  allowOutOfOrder?: boolean
}

export interface WorkflowEngineEventInput {
  workflow: CoreWorkflowDefinition
  run: WorkflowRunState
  step?: EngineStep
  agentText?: string
  commandValue?: unknown
  error?: string
  pause?: RunControlState
}

export interface WorkflowExecutionHooks {
  onWorkflowStart?: (input: WorkflowEngineEventInput) => Promise<void> | void
  onStepStart?: (input: WorkflowEngineEventInput) => Promise<void> | void
  onCommandResult?: (input: WorkflowEngineEventInput) => Promise<void> | void
  onAgentOutput?: (input: WorkflowEngineEventInput) => Promise<void> | void
  onHandoffFailed?: (input: WorkflowEngineEventInput) => Promise<void> | void
  onStepHeld?: (input: WorkflowEngineEventInput) => Promise<void> | void
  onStepFailed?: (input: WorkflowEngineEventInput) => Promise<void> | void
  onStepCompleted?: (input: WorkflowEngineEventInput) => Promise<void> | void
  onStepReviewRequired?: (input: WorkflowEngineEventInput) => Promise<void> | void
  onRunPaused?: (input: WorkflowEngineEventInput) => Promise<void> | void
  onWorkflowCompleted?: (input: WorkflowEngineEventInput) => Promise<void> | void
  onWorkflowFailed?: (input: WorkflowEngineEventInput) => Promise<void> | void
}

export interface ManualCompletionInput {
  workflow: CoreWorkflowDefinition
  run: WorkflowRunState
  step: EngineStep
}

export interface ManualCompletionResult {
  completed: boolean
  error?: string
}

export interface RecoverResultTextInput {
  workflow: CoreWorkflowDefinition
  run: WorkflowRunState
  step: EngineStep
  reason: "retry-agent-result" | "missing-result-text"
}

export interface WorkflowEngineOptions {
  actions: ActionRegistry
  resultSinks: ResultSinkRegistry
  runStore: RunStateStore
  runControlStore?: RunControlStore
  agentProvider?: AgentProvider
  workspaceAvailable?: () => Promise<boolean> | boolean
  fileExists?: (relativePath: string) => Promise<boolean> | boolean
  preflightChecks?: Record<string, (input: WorkflowPreflightCheckInput) => Promise<WorkflowPreflightCheckResult> | WorkflowPreflightCheckResult>
  strictPreflightChecks?: boolean
  hooks?: WorkflowExecutionHooks
  manualCompletion?: (input: ManualCompletionInput) => Promise<ManualCompletionResult> | ManualCompletionResult
  recoverResultText?: (input: RecoverResultTextInput) => Promise<string | undefined> | string | undefined
}

export interface ResumeRunOptions {
  workflow: CoreWorkflowDefinition
  completeHeldStep?: boolean
}

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
    if (run.status === "reviewing" || run.status === "paused") return run
    const inputProblems = validateWorkflowInputs(workflow.inputs ?? {}, run.inputs)
    if (inputProblems.length > 0) {
      run.status = "failed"
      run.error = inputProblems.join("; ")
      await this.runStore.saveRun(run)
      await this.emit(this.hooks.onWorkflowFailed, { workflow, run, error: run.error })
      return run
    }

    if (await this.pauseIfRequested(workflow, run, workflow.engineSteps.find((step) => step.id === run.currentStep), "before-preflight")) return run

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
      const error = `Step '${step.id}' cannot run before previous step '${blocked.id}' is completed.`
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
      held.status = "completed"
      held.completedAt = new Date().toISOString()
      run.status = "running"
      startIndex += 1
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

  private async continueRun(workflow: CoreWorkflowDefinition, run: WorkflowRunState, startIndex: number, mode: WorkflowExecutionMode): Promise<WorkflowRunState> {
    const endIndex = mode === "singleStep" ? Math.min(startIndex + 1, workflow.engineSteps.length) : workflow.engineSteps.length
    for (let index = startIndex; index < endIndex; index += 1) {
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

      const stepResult = await this.executeStep(workflow, run, step, index)
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

      const artifactResult = await this.writeProducedArtifacts(workflow, run, step)
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

      const completion = await this.completeStepIfManual(workflow, run, step)
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

  private async executeStep(workflow: CoreWorkflowDefinition, run: WorkflowRunState, step: EngineStep, stepIndex: number): Promise<{ ok: true } | { ok: false; held?: boolean; error: string }> {
    if (step.type === "manual") return this.waitForManualCompletion(workflow, run, step)
    if (step.type === "agent") {
      try {
        let agentText = step.resultKey ? run.state[step.resultKey] : undefined
        if (agentText === undefined) agentText = await this.recoverResultText?.({ workflow, run, step, reason: "retry-agent-result" })
        if (agentText === undefined) {
          if (!this.agentProvider) return { ok: false, error: "Agent provider is required for agent workflow steps." }
          const prompt = renderTemplate(step.prompt ?? "", { inputs: run.inputs, state: run.state, run, workflow, step })
          agentText = await Promise.resolve(this.agentProvider.run({
            workflowId: workflow.id,
            logicalWorkflowId: workflow.logicalWorkflowId,
            workflowRoot: workflow.workflowRoot,
            workflowFile: workflow.workflowFile,
            workflowFolderName: workflow.workflowFolderName,
            runId: run.runId,
            stepId: step.id,
            prompt,
            inputs: run.inputs,
            state: run.state
          }))
        }
        if (step.resultKey) run.state[step.resultKey] = agentText
        await this.emit(this.hooks.onAgentOutput, { workflow, run, step, agentText })
        if (step.result) return this.writeResultSinks(workflow, run, step, step.result, agentText)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
    if (step.type === "command") {
      const guardrail = validateCommandGuardrails(workflow, step.action.provider)
      if (guardrail) return { ok: false, error: guardrail }
      const args = renderValue(step.action.args, { inputs: run.inputs, state: run.state, run, workflow, step })
      const result = await this.actions.execute(step.action.provider, {
        args,
        inputs: run.inputs,
        state: run.state,
        workflowId: workflow.id,
        logicalWorkflowId: workflow.logicalWorkflowId,
        workflowRoot: workflow.workflowRoot,
        workflowFile: workflow.workflowFile,
        workflowFolderName: workflow.workflowFolderName,
        runId: run.runId,
        stepId: step.id
      })
      if (!result.ok) return { ok: false, error: result.error ?? `Action provider failed: ${step.action.provider}` }
      const actionError = reportedActionError(result.value)
      if (actionError) return { ok: false, error: actionError }
      if (step.resultKey) run.state[step.resultKey] = formatStateValue(result.value)
      await this.emit(this.hooks.onCommandResult, { workflow, run, step, commandValue: result.value })
      return { ok: true }
    }
    return this.writeResultSinks(workflow, run, step, step.result)
  }

  private async writeResultSinks(workflow: CoreWorkflowDefinition, run: WorkflowRunState, step: EngineStep, result: ResultSourceDefinition, agentText?: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const text = await this.resultText(workflow, run, step, result, agentText)
      for (const sink of result.sinks) {
        const write = await this.resultSinks.write(sink, {
          workflowId: workflow.id,
          logicalWorkflowId: workflow.logicalWorkflowId,
          workflowRoot: workflow.workflowRoot,
          workflowFile: workflow.workflowFile,
          workflowFolderName: workflow.workflowFolderName,
          runId: run.runId,
          stepId: step.id,
          inputs: run.inputs,
          state: run.state,
          text
        })
        if (!write.ok) {
          const error = write.error ?? `Result sink failed: ${sink.type}`
          await this.emit(this.hooks.onHandoffFailed, { workflow, run, step, agentText: text, error })
          return { ok: false, error }
        }
        const replacementText = replacementResultText(write.value)
        if (replacementText !== undefined && "resultKey" in step && step.resultKey) run.state[step.resultKey] = replacementText
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.emit(this.hooks.onHandoffFailed, { workflow, run, step, agentText, error: message })
      return { ok: false, error: message }
    }
    return { ok: true }
  }

  private async resultText(workflow: CoreWorkflowDefinition, run: WorkflowRunState, step: EngineStep, result: ResultSourceDefinition, agentText?: string): Promise<string> {
    if (result.source === "literal") return result.text
    if (result.source === "agent") {
      const recovered = agentText ?? await this.recoverResultText?.({ workflow, run, step, reason: "missing-result-text" })
      if (recovered === undefined) throw new Error("Agent result source is not available for this step.")
      return recovered
    }
    const value = run.state[result.stateKey]
    if (value === undefined) throw new Error(`Workflow state is missing: ${result.stateKey}`)
    return value
  }

  private async completeStepIfManual(workflow: CoreWorkflowDefinition, run: WorkflowRunState, step: EngineStep): Promise<{ ok: true } | { ok: false; held?: boolean; error: string }> {
    if (workflowStepReview(workflow).enabled) return { ok: true }
    if (step.type === "agent" || step.type === "manual" || step.completeOnSuccess || workflow.stepCompletion !== "manual") return { ok: true }
    return this.waitForManualCompletion(workflow, run, step)
  }

  private async waitForManualCompletion(workflow: CoreWorkflowDefinition, run: WorkflowRunState, step: EngineStep): Promise<{ ok: true } | { ok: false; held?: boolean; error: string }> {
    if (!this.manualCompletion) return { ok: false, held: true, error: "Manual workflow step is waiting for completion." }
    try {
      const result = await Promise.resolve(this.manualCompletion({ workflow, run, step }))
      return result.completed ? { ok: true } : { ok: false, held: true, error: result.error ?? "Manual workflow step is waiting for completion." }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private async pauseIfRequested(workflow: CoreWorkflowDefinition, run: WorkflowRunState, nextStep: EngineStep | undefined, checkpoint: string): Promise<boolean> {
    const control = await this.runControlStore?.loadControl(run.runId)
    if (!control?.pauseRequestedAt || control.clearedAt) return false
    run.status = "paused"
    run.error = undefined
    if (nextStep) run.currentStep = nextStep.id
    run.state["workflow.pause"] = JSON.stringify({
      pauseRequestedAt: control.pauseRequestedAt,
      pauseReason: control.pauseReason ?? "manual",
      requestedBy: control.requestedBy ?? "user",
      mode: control.mode ?? "afterCurrentStep",
      checkpoint,
      detectedAt: new Date().toISOString()
    })
    await this.runStore.saveRun(run)
    await this.emit(this.hooks.onRunPaused, { workflow, run, step: nextStep, pause: control })
    return true
  }

  private async emit(hook: ((input: WorkflowEngineEventInput) => Promise<void> | void) | undefined, input: WorkflowEngineEventInput): Promise<void> {
    if (!hook) return
    try {
      await Promise.resolve(hook(input))
    } catch (error) {
      console.warn("Workflow engine hook failed", error)
    }
  }

  private async writeProducedArtifacts(workflow: CoreWorkflowDefinition, run: WorkflowRunState, step: EngineStep): Promise<{ ok: true } | { ok: false; error: string }> {
    const artifacts = workflow.artifacts ?? []
    for (const artifact of artifacts.filter((item) => item.producedBy === step.id)) {
      const value = run.state[artifact.id]
      if (value === undefined) continue
      const path = renderArtifactPath(artifact, { inputs: run.inputs, state: run.state, run, workflow, step })
      if (path.includes("{{")) continue
      const write = await this.resultSinks.write({ type: "file", path }, {
        workflowId: workflow.id,
        logicalWorkflowId: workflow.logicalWorkflowId,
        workflowRoot: workflow.workflowRoot,
        workflowFile: workflow.workflowFile,
        workflowFolderName: workflow.workflowFolderName,
        runId: run.runId,
        stepId: step.id,
        inputs: run.inputs,
        state: run.state,
        text: value
      })
      if (!write.ok) return { ok: false, error: write.error ?? `Failed to write artifact: ${artifact.id}` }
    }
    return { ok: true }
  }
}
