import type {
  CoreWorkflowDefinition,
  EngineStep,
  WorkflowRunState
} from "../model"
import { resolveStepTransition } from "../branching/transitionResolver"
import { createBranchCheckpoint } from "./branchCheckpoint"
import { recordBranchTransition } from "./branchHistory"
import { resetStepRangeForBranch } from "./branchReset"
import { ensureRunBranching } from "./branchState"

export {
  approveBranchCheckpointTransition,
  abortBranchCheckpointTransition
} from "./branchCheckpoint"

type WorkflowExecutionMode = "full" | "singleStep"

export type AppliedBranchTransition =
  | { action: "next"; nextIndex: number }
  | { action: "goto"; nextIndex: number; stop: boolean }
  | { action: "checkpoint"; nextIndex: number; stop: true }
  | { action: "end"; stop: true }
  | { action: "fail"; stop: true; error: string }

export function applyStepTransition(input: {
  workflow: CoreWorkflowDefinition
  run: WorkflowRunState
  step: EngineStep
  stepIndex: number
  mode: WorkflowExecutionMode
}): AppliedBranchTransition {
  const { workflow, run, step, stepIndex, mode } = input
  const resolved = resolveStepTransition(step, run)
  if (resolved.action === "next") return { action: "next", nextIndex: stepIndex + 1 }
  if (resolved.action === "end") {
    run.status = "completed"
    run.currentStep = undefined
    run.error = undefined
    recordBranchTransition(workflow, run, step, resolved.decisionId, "end", undefined, resolved.loopId, undefined, resolved.conditionSnapshot)
    return { action: "end", stop: true }
  }
  if (resolved.action === "fail") {
    const error = `Workflow transition '${resolved.decisionId}' failed the run at step '${step.id}'.`
    run.status = "failed"
    run.currentStep = step.id
    run.error = error
    recordBranchTransition(workflow, run, step, resolved.decisionId, "fail", undefined, resolved.loopId, undefined, resolved.conditionSnapshot)
    return { action: "fail", stop: true, error }
  }
  const targetStepId = resolved.toStepId
  if (!targetStepId) {
    const error = `Workflow transition '${resolved.decisionId}' did not resolve a target step.`
    run.status = "failed"
    run.currentStep = step.id
    run.error = error
    return { action: "fail", stop: true, error }
  }
  const targetIndex = workflow.engineSteps.findIndex((candidate) => candidate.id === targetStepId)
  if (targetIndex < 0) {
    const error = `Workflow transition '${resolved.decisionId}' references unknown step '${targetStepId}'.`
    run.status = "failed"
    run.currentStep = step.id
    run.error = error
    return { action: "fail", stop: true, error }
  }

  const branching = ensureRunBranching(workflow, run)
  let loopCount: number | undefined
  if (targetIndex <= stepIndex) {
    const loopState = resolved.loopId && branching ? branching.loops[resolved.loopId] : undefined
    if (branching && loopState && loopState.count >= loopState.allowed) {
      createBranchCheckpoint({
        workflow,
        run,
        branching,
        loopState,
        step,
        decisionId: resolved.decisionId,
        loopId: resolved.loopId,
        targetStepId,
        conditionSnapshot: resolved.conditionSnapshot
      })
      return { action: "checkpoint", nextIndex: targetIndex, stop: true }
    }
    if (loopState) {
      loopState.count += 1
      loopState.lastTransitionAt = new Date().toISOString()
      loopCount = loopState.count
    }
    resetStepRangeForBranch(workflow, run, targetIndex, stepIndex, {
      decisionId: resolved.decisionId,
      loopId: resolved.loopId,
      fromStepId: step.id,
      toStepId: targetStepId,
      loopCount
    })
  }

  run.status = "running"
  run.currentStep = targetStepId
  run.error = undefined
  recordBranchTransition(workflow, run, step, resolved.decisionId, "goto", targetStepId, resolved.loopId, loopCount, resolved.conditionSnapshot)
  return {
    action: "goto",
    nextIndex: targetIndex,
    stop: mode === "singleStep"
  }
}
