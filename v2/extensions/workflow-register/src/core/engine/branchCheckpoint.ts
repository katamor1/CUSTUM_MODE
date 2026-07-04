import { randomUUID } from "crypto"
import type {
  CoreWorkflowDefinition,
  EngineStep,
  WorkflowBranchLoopState,
  WorkflowRunBranchingState,
  WorkflowRunState
} from "../model"
import { recordBranchTransition } from "./branchHistory"
import { resetStepRangeForBranch } from "./branchReset"

export function createBranchCheckpoint(input: {
  workflow: CoreWorkflowDefinition
  run: WorkflowRunState
  branching: WorkflowRunBranchingState
  loopState: WorkflowBranchLoopState
  step: EngineStep
  decisionId: string
  loopId?: string
  targetStepId: string
  conditionSnapshot: unknown
}): void {
  const { workflow, run, branching, loopState, step, decisionId, loopId, targetStepId, conditionSnapshot } = input
  const loopDefinition = workflow.branching?.loops.find((loop) => loop.id === loopState.loopId)
  const message = loopDefinition?.checkpoint?.message
    ?? `Branch loop '${loopState.loopId}' reached its limit (${loopState.count}/${loopState.allowed}).`
  loopState.checkpointCount += 1
  run.status = "checkpoint"
  run.currentStep = targetStepId
  run.error = undefined
  branching.checkpoint = {
    id: randomUUID(),
    loopId: loopState.loopId,
    fromStepId: step.id,
    toStepId: targetStepId,
    decisionId,
    count: loopState.count,
    allowed: loopState.allowed,
    extensionSize: loopState.extensionSize,
    message,
    createdAt: new Date().toISOString()
  }
  recordBranchTransition(workflow, run, step, decisionId, "checkpoint", targetStepId, loopId, loopState.count, conditionSnapshot)
}

export function approveBranchCheckpointTransition(workflow: CoreWorkflowDefinition, run: WorkflowRunState): { ok: true } | { ok: false; error: string } {
  const branching = run.branching
  const checkpoint = branching?.checkpoint
  if (run.status !== "checkpoint" || !checkpoint) return { ok: false, error: `Workflow run is not waiting at a branch checkpoint: ${run.status}` }
  const loopState = branching?.loops[checkpoint.loopId]
  if (!loopState) return { ok: false, error: `Branch checkpoint loop is not available: ${checkpoint.loopId}` }
  const targetIndex = workflow.engineSteps.findIndex((step) => step.id === checkpoint.toStepId)
  const currentIndex = workflow.engineSteps.findIndex((step) => step.id === checkpoint.fromStepId)
  if (targetIndex < 0) return { ok: false, error: `Branch checkpoint target step is not available: ${checkpoint.toStepId}` }
  if (currentIndex < 0) return { ok: false, error: `Branch checkpoint source step is not available: ${checkpoint.fromStepId}` }

  loopState.allowed += checkpoint.extensionSize
  loopState.count += 1
  loopState.lastTransitionAt = new Date().toISOString()
  resetStepRangeForBranch(workflow, run, targetIndex, currentIndex, {
    decisionId: checkpoint.decisionId,
    loopId: checkpoint.loopId,
    fromStepId: checkpoint.fromStepId,
    toStepId: checkpoint.toStepId,
    loopCount: loopState.count
  })
  const fromStep = workflow.engineSteps[currentIndex]
  run.status = "running"
  run.currentStep = checkpoint.toStepId
  run.error = undefined
  delete branching.checkpoint
  recordBranchTransition(workflow, run, fromStep, checkpoint.decisionId, "goto", checkpoint.toStepId, checkpoint.loopId, loopState.count, undefined)
  return { ok: true }
}

export function abortBranchCheckpointTransition(run: WorkflowRunState, reason?: string): { ok: true } | { ok: false; error: string } {
  if (run.status !== "checkpoint" || !run.branching?.checkpoint) {
    return { ok: false, error: `Workflow run is not waiting at a branch checkpoint: ${run.status}` }
  }
  run.status = "failed"
  run.error = reason ?? `Workflow run aborted at branch checkpoint: ${run.branching.checkpoint.loopId}`
  delete run.branching.checkpoint
  return { ok: true }
}
