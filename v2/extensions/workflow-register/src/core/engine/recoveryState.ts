import type {
  EngineStep,
  RunStepState,
  WorkflowRunState
} from "../model"
import type { RecoverResultTextInput } from "../engineTypes"

const HANDOFF_FAILURE_STATE_PREFIX = "workflow.handoffFailed."
const RETRY_RECOVERY_REASON_PREFIX = "workflow.retryRecoveryReason."
const COMMAND_PROVIDER_COMPLETION_PREFIX = "workflow.commandProviderCompleted."

type RetryRecoveryReason = Extract<RecoverResultTextInput["reason"], "handoff-failed">

export function markResultHandoffFailed(run: WorkflowRunState, step: EngineStep, error: string): void {
  run.state[handoffFailureKey(step.id)] = JSON.stringify({
    error,
    failedAt: new Date().toISOString()
  })
}

export function prepareRetryResultRecovery(run: WorkflowRunState, step: EngineStep, stepState: RunStepState): void {
  const reason = retryRecoveryReasonForFailure(run, step, stepState)
  if (reason) {
    run.state[retryRecoveryReasonKey(step.id)] = reason
  } else {
    delete run.state[retryRecoveryReasonKey(step.id)]
  }
}

export function takeRetryResultRecoveryReason(run: WorkflowRunState, step: EngineStep): RetryRecoveryReason | undefined {
  const key = retryRecoveryReasonKey(step.id)
  const reason = run.state[key]
  delete run.state[key]
  return reason === "handoff-failed" ? reason : undefined
}

export function markCommandProviderCompleted(run: WorkflowRunState, step: EngineStep): void {
  run.state[commandProviderCompletionKey(step.id)] = JSON.stringify({
    schemaVersion: "workflow-register/command-provider-completion/v1",
    completedAt: new Date().toISOString()
  })
}

export function commandProviderCompleted(run: WorkflowRunState, step: EngineStep): boolean {
  return run.state[commandProviderCompletionKey(step.id)] !== undefined
}

export function clearCommandProviderCompleted(run: WorkflowRunState, step: EngineStep): void {
  delete run.state[commandProviderCompletionKey(step.id)]
}

function retryRecoveryReasonForFailure(run: WorkflowRunState, step: EngineStep, stepState: RunStepState): RetryRecoveryReason | undefined {
  if (step.type !== "agent" || !step.result || stepState.status !== "failed") return undefined
  if (run.state[handoffFailureKey(step.id)]) return "handoff-failed"
  const error = stepState.error ?? run.error ?? ""
  return /result sink failed|result command reported|handoff/i.test(error) ? "handoff-failed" : undefined
}

function handoffFailureKey(stepId: string): string {
  return `${HANDOFF_FAILURE_STATE_PREFIX}${stepId}`
}

function retryRecoveryReasonKey(stepId: string): string {
  return `${RETRY_RECOVERY_REASON_PREFIX}${stepId}`
}

function commandProviderCompletionKey(stepId: string): string {
  return `${COMMAND_PROVIDER_COMPLETION_PREFIX}${stepId}`
}
