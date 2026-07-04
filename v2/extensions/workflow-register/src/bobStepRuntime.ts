import * as vscode from "vscode"
import type {
  ActiveStep,
  BobWorkflowTask,
  WorkflowDefinition
} from "./bobWorkflowTypes"
import type { ActionRegistry } from "./core/actionRegistry"
import { validateCommandGuardrails } from "./core/guardrails"
import {
  executeResultHandoff,
  extractLastAssistantText,
  resultSourceForStep
} from "./resultHandoff"

export class StepRuntime {
  private readonly activeSteps = new Map<string, ActiveStep>()
  private sequence = 0

  hold(
    workflow: WorkflowDefinition,
    step: { id: string; title: string },
    task: BobWorkflowTask,
    context: {
      runId: string
      stepDefinition?: ActiveStep["stepDefinition"]
      actionRegistry?: ActionRegistry
      inputs?: Record<string, unknown>
      state?: Record<string, string>
      messageStartIndex?: number
    }
  ): Promise<boolean> {
    const key = `${++this.sequence}:${workflow.id}:${step.id}`
    return new Promise<boolean>((resolve) => {
      this.activeSteps.set(key, {
        key,
        workflowId: workflow.id,
        workflowLabel: workflow.label,
        runId: context.runId,
        stepId: step.id,
        title: step.title,
        task,
        stepDefinition: context.stepDefinition,
        guardrails: workflow.guardrails,
        actionRegistry: context.actionRegistry,
        inputs: context.inputs,
        state: context.state,
        messageStartIndex: context.messageStartIndex ?? getTaskMessageCount(task),
        resolve
      })
    })
  }

  list(): ActiveStep[] {
    return Array.from(this.activeSteps.values())
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
    const handoff = await captureHeldStepResult(active)
    if (!handoff.ok) {
      const message = `Could not capture Bob workflow step result: ${handoff.error}`
      await vscode.window.showErrorMessage(message)
      return message
    }
    applyStateUpdates(active, options.stateUpdates)
    active.task.setStepComplete?.()
    active.resolve(true)
    this.activeSteps.delete(active.key)
    return `Completed: ${active.workflowLabel} / ${active.title}`
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

function applyStateUpdates(active: ActiveStep, stateUpdates: Record<string, string> | undefined): void {
  if (!active.state || !stateUpdates) return
  for (const [key, value] of Object.entries(stateUpdates)) {
    if (!key || typeof value !== "string") continue
    active.state[key] = value
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
