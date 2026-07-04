import type {
  CoreWorkflowDefinition,
  EngineStep,
  WorkflowRunState
} from "../model"
import type { WorkflowEngineOptions } from "../engineTypes"
import { workflowStepReview } from "./runState"

type ManualCompletion = NonNullable<WorkflowEngineOptions["manualCompletion"]>

export async function completeStepIfManual(input: {
  workflow: CoreWorkflowDefinition
  run: WorkflowRunState
  step: EngineStep
  manualCompletion?: ManualCompletion
}): Promise<{ ok: true } | { ok: false; held?: boolean; error: string }> {
  const { workflow, run, step, manualCompletion } = input
  if (workflowStepReview(workflow).enabled) return { ok: true }
  if (
    step.type === "agent" ||
    step.type === "manual" ||
    step.completeOnSuccess ||
    workflow.stepCompletion !== "manual"
  ) {
    return { ok: true }
  }
  return waitForManualCompletion({ workflow, run, step, manualCompletion })
}

export async function waitForManualCompletion(input: {
  workflow: CoreWorkflowDefinition
  run: WorkflowRunState
  step: EngineStep
  manualCompletion?: ManualCompletion
}): Promise<{ ok: true } | { ok: false; held?: boolean; error: string }> {
  const { workflow, run, step, manualCompletion } = input
  if (!manualCompletion) return { ok: false, held: true, error: "Manual workflow step is waiting for completion." }
  try {
    const result = await Promise.resolve(manualCompletion({ workflow, run, step }))
    return result.completed
      ? { ok: true }
      : { ok: false, held: true, error: result.error ?? "Manual workflow step is waiting for completion." }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
