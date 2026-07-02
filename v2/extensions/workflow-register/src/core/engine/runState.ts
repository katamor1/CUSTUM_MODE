import { CoreWorkflowDefinition, EngineStep, RunStepState, WorkflowRunState, WorkflowStepReviewDefinition } from "../model"

type WorkflowExecutionMode = "full" | "singleStep"

const DEFAULT_STEP_REVIEW: WorkflowStepReviewDefinition = {
  enabled: false,
  pauseAfter: "none",
  requireAcceptBeforeNext: false,
  allowRetry: true,
  allowEditBeforeRetry: true,
  preserveAttempts: true
}

interface RunWorkflowOptionsLike {
  executionMode?: WorkflowExecutionMode
  stepId?: string
}

export function nextPendingIndex(run: WorkflowRunState): number {
  return run.steps.findIndex((step) => step.status === "pending" || step.status === "reviewing" || step.status === "held" || step.status === "failed")
}

function recoverStartIndex(workflow: CoreWorkflowDefinition, run: WorkflowRunState): number {
  const currentIndex = run.currentStep ? workflow.engineSteps.findIndex((step) => step.id === run.currentStep) : -1
  if (currentIndex >= 0) return run.steps[currentIndex]?.status === "completed" ? currentIndex + 1 : currentIndex
  const pending = nextPendingIndex(run)
  return pending >= 0 ? pending : workflow.engineSteps.length
}

export function startIndexForRun(workflow: CoreWorkflowDefinition, run: WorkflowRunState, options: RunWorkflowOptionsLike): number {
  if (options.executionMode === "singleStep" && options.stepId) {
    const index = workflow.engineSteps.findIndex((step) => step.id === options.stepId)
    if (index < 0) throw new Error(`Step is not part of workflow ${workflow.id}: ${options.stepId}`)
    return index
  }
  return recoverStartIndex(workflow, run)
}

export function workflowStepReview(workflow: CoreWorkflowDefinition): WorkflowStepReviewDefinition {
  const stepReview = (workflow as Partial<CoreWorkflowDefinition>).stepReview
  return stepReview ?? DEFAULT_STEP_REVIEW
}

export function shouldPauseForStepReview(workflow: CoreWorkflowDefinition, step: EngineStep, mode: WorkflowExecutionMode): boolean {
  if (mode !== "full") return false
  const review = workflowStepReview(workflow)
  if (!review.enabled) return false
  if (review.pauseAfter === "none") return false
  if (review.pauseAfter === "agentAndCommand") return step.type === "agent" || step.type === "command"
  return true
}

export function archiveAttempt(stepState: RunStepState, state: Record<string, string>): void {
  const attempt = stepState.attempt ?? ((stepState.attempts?.length ?? 0) + 1)
  stepState.attempts = [
    ...(stepState.attempts ?? []),
    {
      attempt,
      status: stepState.status,
      startedAt: stepState.startedAt,
      completedAt: stepState.completedAt,
      reviewStartedAt: stepState.reviewStartedAt,
      acceptedAt: stepState.acceptedAt,
      error: stepState.error,
      stateSnapshot: { ...state },
      createdAt: new Date().toISOString()
    }
  ]
}

export function validateRunStepCompatibility(run: WorkflowRunState, workflow: CoreWorkflowDefinition, targetIndex: number): void {
  const limit = Math.max(0, targetIndex)
  for (let index = 0; index <= limit && index < run.steps.length; index += 1) {
    const runStep = run.steps[index]
    const workflowStep = workflow.engineSteps[index]
    if (!workflowStep) throw new Error(`Workflow definition no longer contains step index ${index + 1} (${runStep.id}).`)
    if (runStep.id !== workflowStep.id) throw new Error(`Workflow step order/id changed at index ${index + 1}: run=${runStep.id}; workflow=${workflowStep.id}.`)
  }
}

export function validateRetryCompatibility(run: WorkflowRunState, workflow: CoreWorkflowDefinition, targetIndex: number): void {
  const review = workflowStepReview(workflow)
  if (definitionHashChanged(run, workflow) && !review.allowEditBeforeRetry) throw new Error("Workflow definition changed, and stepReview.allowEditBeforeRetry is false.")
  validateRunStepCompatibility(run, workflow, targetIndex)
}

export function noteDefinitionMismatch(run: WorkflowRunState, workflow: CoreWorkflowDefinition): void {
  if (!definitionHashChanged(run, workflow)) return
  run.state["workflow.definitionMismatch"] = JSON.stringify({ runHash: run.workflowDefinitionHash, currentHash: workflow.definitionHash, detectedAt: new Date().toISOString() })
}

function definitionHashChanged(run: WorkflowRunState, workflow: CoreWorkflowDefinition): boolean {
  return Boolean(run.workflowDefinitionHash && workflow.definitionHash && run.workflowDefinitionHash !== workflow.definitionHash)
}

export function missingRequiredState(step: EngineStep, state: Record<string, string>): string[] {
  if (!step.stateRequired) return []
  return (step.includeState ?? []).filter((key) => {
    const value = state[key]
    return value === undefined || value.trim().length === 0
  })
}
