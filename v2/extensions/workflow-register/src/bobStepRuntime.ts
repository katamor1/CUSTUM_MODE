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

  async completeCurrentStep(): Promise<string> {
    const active = await this.pickActiveStep()
    if (!active) return "No active Bob workflow step."
    const handoff = await captureHeldStepResult(active)
    if (!handoff.ok) {
      const message = `Could not capture Bob workflow step result: ${handoff.error}`
      await vscode.window.showErrorMessage(message)
      return message
    }
    active.task.setStepComplete?.()
    active.resolve(true)
    this.activeSteps.delete(active.key)
    return `Completed: ${active.workflowLabel} / ${active.title}`
  }

  private async pickActiveStep(): Promise<ActiveStep | undefined> {
    const steps = this.list()
    if (steps.length === 0) return undefined
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
