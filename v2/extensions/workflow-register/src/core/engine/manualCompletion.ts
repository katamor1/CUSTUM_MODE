import type {
  CoreWorkflowDefinition,
  EngineStep,
  WorkflowRunState
} from "../model"
import type { WorkflowEngineOptions } from "../engineTypes"
import { assertUserWritableStateKey, reservedWorkflowStateKeyError } from "../stateKeys"
import { workflowStepReview } from "./runState"
import { formatStateValue } from "./templateRenderer"

type ManualCompletion = NonNullable<WorkflowEngineOptions["manualCompletion"]>
type ManualCompletionResult = Awaited<ReturnType<ManualCompletion>>

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
  const stateKeyError = validateManualStepResultKeys(step)
  if (stateKeyError) return { ok: false, error: stateKeyError }
  try {
    const result = await Promise.resolve(manualCompletion({ workflow, run, step }))
    if (result.completed) {
      applyManualCompletionState(run, step, result)
      return { ok: true }
    }
    return { ok: false, held: true, error: result.error ?? "Manual workflow step is waiting for completion." }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function applyManualCompletionState(run: WorkflowRunState, step: EngineStep, result: ManualCompletionResult): void {
  for (const [key, value] of Object.entries(result.stateUpdates ?? {})) {
    if (!key || value === undefined) continue
    assertUserWritableStateKey(key, "workflow/user updates")
    run.state[key] = formatStateValue(value)
  }
  if (step.type !== "manual") return
  if (step.form?.resultKey) {
    assertUserWritableStateKey(step.form.resultKey, "manual form resultKey")
    const value = result.formValues ?? result.stateUpdates?.[step.form.resultKey]
    if (value !== undefined) run.state[step.form.resultKey] = formatStateValue(value)
  }
  if (step.approval?.resultKey) {
    assertUserWritableStateKey(step.approval.resultKey, "manual approval resultKey")
    const value = result.approval ?? approvalFromLegacyResult(result)
    if (value !== undefined) run.state[step.approval.resultKey] = formatStateValue(value)
  }
}

function validateManualStepResultKeys(step: EngineStep): string | undefined {
  if (step.type !== "manual") return undefined
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

function approvalFromLegacyResult(result: ManualCompletionResult): { decision: "approved" | "rejected"; reason?: string; comment?: string } | undefined {
  if (!result.decision) return undefined
  return {
    decision: result.decision,
    reason: result.reason,
    comment: result.comment
  }
}
