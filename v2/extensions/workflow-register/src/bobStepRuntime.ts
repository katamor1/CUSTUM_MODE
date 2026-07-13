import * as vscode from "vscode"
import type {
  ActiveStep,
  BobWorkflowTask
} from "./bobWorkflowTypes"
import type { ActionRegistry } from "./core/actionRegistry"
import type { ManualCompletionResult } from "./core/engineTypes"
import { formatStateValue } from "./core/engine/templateRenderer"
import { validateCommandGuardrails } from "./core/guardrails"
import type { EngineStep, WorkflowGuardrailsDefinition } from "./core/model"
import { assertUserWritableStateKey, reservedWorkflowStateKeyError } from "./core/stateKeys"
import {
  createVscodeManualStepCompletionPromptProvider,
  type ManualStepCompletionPromptProvider,
  type ManualStepCompletionPromptResult
} from "./manualStepPrompt"
import {
  executeResultHandoff,
  extractLastAssistantText,
  resultSourceForStep
} from "./resultHandoff"

interface StepRuntimeWorkflowContext {
  id: string
  label: string
  guardrails: WorkflowGuardrailsDefinition
}

export class StepRuntime {
  private readonly activeSteps = new Map<string, ActiveStep>()
  private sequence = 0

  constructor(private readonly promptProvider: ManualStepCompletionPromptProvider = createVscodeManualStepCompletionPromptProvider()) {}

  hold(
    workflow: StepRuntimeWorkflowContext,
    step: { id: string; title: string },
    task: BobWorkflowTask,
    context: {
      runId: string
      stepDefinition?: ActiveStep["stepDefinition"]
      coreStep?: EngineStep
      actionRegistry?: ActionRegistry
      inputs?: Record<string, unknown>
      state?: Record<string, string>
      messageStartIndex?: number
      completeBobTask?: boolean
      onHeldStep?: (active: ActiveStep) => Promise<void> | void
    }
  ): Promise<ManualCompletionResult> {
    const key = `${++this.sequence}:${workflow.id}:${step.id}`
    return new Promise<ManualCompletionResult>((resolve) => {
      const active: ActiveStep = {
        key,
        workflowId: workflow.id,
        workflowLabel: workflow.label,
        runId: context.runId,
        stepId: step.id,
        title: step.title,
        task,
        coreStep: context.coreStep,
        stepDefinition: context.stepDefinition,
        guardrails: workflow.guardrails,
        actionRegistry: context.actionRegistry,
        inputs: context.inputs,
        state: context.state,
        messageStartIndex: context.messageStartIndex ?? getTaskMessageCount(task),
        completeBobTask: context.completeBobTask !== false,
        resolve
      }
      this.activeSteps.set(key, active)
      Promise.resolve(context.onHeldStep?.(active)).catch((error) => {
        console.warn("Failed to open manual step panel", error)
      })
    })
  }

  list(): ActiveStep[] {
    return Array.from(this.activeSteps.values())
  }

  getActiveStep(key: string): ActiveStep | undefined {
    return this.activeSteps.get(key)
  }

  async completeStepByKey(key: string, options: StepCompletionExpectation = {}): Promise<string> {
    const result = await this.completeStepByKeyResult(key, options)
    return result.message
  }

  async completeStepByKeyResult(key: string, options: StepCompletionExpectation = {}): Promise<StepCompletionResult> {
    const active = this.activeSteps.get(key)
    if (!active) return { ok: false, message: `No active Bob workflow step for key: ${key}` }
    const mismatch = activeStepMismatch([active], options)
    if (mismatch) return { ok: false, message: mismatch }
    return this.completeStep(active, options)
  }

  async completeCurrentStep(options: StepCompletionExpectation = {}): Promise<string> {
    const steps = this.list()
    if (steps.length === 0) return "No active Bob workflow step."
    const active = hasExpectedStep(options)
      ? pickExpectedStep(steps, options)
      : await this.pickActiveStep(steps)
    const mismatch = activeStepMismatch(steps, options)
    if (mismatch) return mismatch
    if (!active) return "No active Bob workflow step."
    const result = await this.completeStep(active, options)
    return result.message
  }

  private async completeStep(active: ActiveStep, options: StepCompletionExpectation): Promise<StepCompletionResult> {
    const stateKeyError = validateCompletionStateKeys(active, options.stateUpdates)
    if (stateKeyError) {
      await vscode.window.showErrorMessage(stateKeyError)
      return { ok: false, message: stateKeyError }
    }
    const completion = await this.collectManualCompletion(active, options)
    if (!completion.completed) {
      const message = completion.error ?? "Manual workflow step completion was cancelled."
      await vscode.window.showWarningMessage(message)
      return { ok: false, message }
    }
    const completionStateKeyError = validateCompletionStateKeys(active, completion.stateUpdates)
    if (completionStateKeyError) {
      await vscode.window.showErrorMessage(completionStateKeyError)
      return { ok: false, message: completionStateKeyError }
    }
    const handoff = await captureHeldStepResult(active)
    if (!handoff.ok) {
      const message = `Could not capture Bob workflow step result: ${handoff.error}`
      await vscode.window.showErrorMessage(message)
      return { ok: false, message }
    }
    applyStateUpdates(active, completion.stateUpdates)
    applyManualCompletionState(active, completion)
    if (active.completeBobTask !== false) active.task.setStepComplete?.()
    active.resolve(completion)
    this.activeSteps.delete(active.key)
    return { ok: true, message: `Completed: ${active.workflowLabel} / ${active.title}` }
  }

  private async collectManualCompletion(active: ActiveStep, options: StepCompletionExpectation): Promise<ManualCompletionResult> {
    const stateUpdates = options.stateUpdates
    const step = active.coreStep
    if (step?.type !== "manual" || (!step.form && !step.approval)) return { completed: true, stateUpdates }
    const promptResult = await Promise.resolve(this.promptProvider.collectManualCompletion({
      workflowLabel: active.workflowLabel,
      runId: active.runId,
      step,
      inputs: active.inputs,
      state: active.state,
      previousFormValues: readPreviousFormValues(active, step)
    }))
    if (!promptResult) return { completed: false, error: "Manual workflow step completion was cancelled." }
    return {
      completed: true,
      stateUpdates,
      ...promptResult
    }
  }

  private async pickActiveStep(steps: ActiveStep[]): Promise<ActiveStep | undefined> {
    if (steps.length === 1) return steps[0]
    const picked = await vscode.window.showQuickPick(
      steps.map((step) => ({
        label: step.title,
        description: step.workflowLabel,
        detail: `${step.workflowId} / ${step.stepId} / ${step.key}`,
        step
      })),
      { placeHolder: "Select the Bob workflow step to complete" }
    )
    return picked?.step
  }
}

export interface StepCompletionExpectation {
  expectedRunId?: string
  expectedStepId?: string
  stateUpdates?: Record<string, string>
}

export interface StepCompletionResult {
  ok: boolean
  message: string
}

function hasExpectedStep(options: StepCompletionExpectation): boolean {
  return Boolean(options.expectedRunId || options.expectedStepId)
}

function pickExpectedStep(steps: ActiveStep[], options: StepCompletionExpectation): ActiveStep | undefined {
  const matchingSteps = steps.filter((step) => stepMatchesExpectation(step, options))
  return matchingSteps.length === 1 ? matchingSteps[0] : undefined
}

function activeStepMismatch(steps: ActiveStep[], options: StepCompletionExpectation): string | undefined {
  if (!hasExpectedStep(options)) return undefined
  const matchingSteps = steps.filter((step) => stepMatchesExpectation(step, options))
  if (matchingSteps.length === 1) return undefined
  const expected = [
    options.expectedRunId ? `runId=${options.expectedRunId}` : undefined,
    options.expectedStepId ? `stepId=${options.expectedStepId}` : undefined
  ].filter(Boolean).join(" ")
  const active = steps.map((step) => `runId=${step.runId} stepId=${step.stepId}`).join("; ")
  const suffix = matchingSteps.length > 1 ? `; matched ${matchingSteps.length} active steps` : ""
  return `Active Bob workflow step mismatch: expected ${expected}; active ${active}.${suffix}`
}

function stepMatchesExpectation(step: ActiveStep, options: StepCompletionExpectation): boolean {
  return (!options.expectedRunId || step.runId === options.expectedRunId) &&
    (!options.expectedStepId || step.stepId === options.expectedStepId)
}

function validateCompletionStateKeys(active: ActiveStep, stateUpdates: Record<string, unknown> | undefined): string | undefined {
  for (const key of Object.keys(stateUpdates ?? {})) {
    if (!key) continue
    const error = reservedWorkflowStateKeyError(key, "workflow/user updates")
    if (error) return error
  }
  const step = active.coreStep
  if (step?.type !== "manual") return undefined
  if (step.form?.resultKey) {
    const error = reservedWorkflowStateKeyError(step.form.resultKey, "manual form resultKey")
    if (error) return error
  }
  if (step.approval?.resultKey) {
    const error = reservedWorkflowStateKeyError(step.approval.resultKey, "manual approval resultKey")
    if (error) return error
  }
  return undefined
}

function applyStateUpdates(active: ActiveStep, stateUpdates: Record<string, unknown> | undefined): void {
  if (!active.state || !stateUpdates) return
  for (const [key, value] of Object.entries(stateUpdates)) {
    if (!key || value === undefined) continue
    assertUserWritableStateKey(key, "workflow/user updates")
    active.state[key] = formatStateValue(value)
  }
}

function applyManualCompletionState(active: ActiveStep, result: ManualCompletionResult): void {
  const step = active.coreStep
  if (!active.state || step?.type !== "manual") return
  if (step.form?.resultKey) {
    assertUserWritableStateKey(step.form.resultKey, "manual form resultKey")
    const value = result.formValues ?? result.stateUpdates?.[step.form.resultKey]
    if (value !== undefined) active.state[step.form.resultKey] = formatStateValue(value)
  }
  if (step.approval?.resultKey) {
    assertUserWritableStateKey(step.approval.resultKey, "manual approval resultKey")
    const value = result.approval ?? approvalFromPromptResult(result)
    if (value !== undefined) active.state[step.approval.resultKey] = formatStateValue(value)
  }
}

function approvalFromPromptResult(result: ManualStepCompletionPromptResult): ManualCompletionResult["approval"] | undefined {
  if (!result.decision) return undefined
  return {
    decision: result.decision,
    reason: result.reason,
    comment: result.comment
  }
}

function readPreviousFormValues(active: ActiveStep, step: Extract<EngineStep, { type: "manual" }>): Record<string, unknown> | undefined {
  if (!step.form?.resultKey || !active.state) return undefined
  const value = active.state[`workflow.branching.lastValues.${step.id}.${step.form.resultKey}`]
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

async function captureHeldStepResult(active: ActiveStep): Promise<{ ok: boolean; error?: string }> {
  const step = active.stepDefinition
  if (!step?.captureResult) return { ok: true }
  if (step.resultCommand) {
    const guardrail = validateCommandGuardrails({ guardrails: active.guardrails }, step.resultCommand)
    if (guardrail) return { ok: false, error: guardrail }
  }
  const messages = active.task.getMessages?.()
  const resultText = resultSourceForStep(step) === "lastAssistant" && Array.isArray(messages)
    ? extractLastAssistantText(messages, active.messageStartIndex)
    : undefined
  return executeResultHandoff(step, resultText, {
    actions: active.actionRegistry,
    executeCommand: active.actionRegistry
      ? undefined
      : (command, ...args) => vscode.commands.executeCommand(command, ...args),
    inputs: active.inputs,
    state: active.state,
    workflowId: active.workflowId,
    runId: active.runId,
    stepId: active.stepId
  })
}

export function getTaskMessageCount(task: BobWorkflowTask): number {
  const messages = task.getMessages?.()
  return Array.isArray(messages) ? messages.length : 0
}
