import type {
  CoreWorkflowDefinition,
  EngineStep,
  WorkflowRunState
} from "../model"
import { archiveAttempt } from "./runState"

export interface BranchResetMetadata {
  decisionId: string
  loopId?: string
  fromStepId: string
  toStepId: string
  loopCount?: number
}

export function resetStepRangeForBranch(
  workflow: CoreWorkflowDefinition,
  run: WorkflowRunState,
  targetIndex: number,
  currentIndex: number,
  branch: BranchResetMetadata
): void {
  for (let index = targetIndex; index <= currentIndex; index += 1) {
    const stepState = run.steps[index]
    if (!stepState) continue
    archiveAttempt(stepState, run.state)
    const archived = stepState.attempts?.[stepState.attempts.length - 1]
    if (archived) {
      archived.branchDecisionId = branch.decisionId
      archived.branchLoopId = branch.loopId
      archived.branchFromStepId = branch.fromStepId
      archived.branchToStepId = branch.toStepId
      archived.branchLoopCount = branch.loopCount
    }
  }
  for (let index = targetIndex; index <= currentIndex; index += 1) {
    const step = workflow.engineSteps[index]
    const stepState = run.steps[index]
    if (!step || !stepState) continue
    for (const key of producedStateKeys(step)) {
      const value = run.state[key]
      if (value !== undefined) run.state[`workflow.branching.lastValues.${step.id}.${key}`] = value
      delete run.state[key]
    }
    stepState.status = "pending"
    stepState.startedAt = undefined
    stepState.completedAt = undefined
    stepState.reviewStartedAt = undefined
    stepState.acceptedAt = undefined
    stepState.error = undefined
    stepState.attempt = (stepState.attempts?.length ?? 0) + 1
  }
}

function producedStateKeys(step: EngineStep): string[] {
  const keys: string[] = []
  if ("resultKey" in step && step.resultKey) keys.push(step.resultKey)
  if (step.type === "manual") {
    if (step.form?.resultKey) keys.push(step.form.resultKey)
    if (step.approval?.resultKey) keys.push(step.approval.resultKey)
  }
  return keys
}
