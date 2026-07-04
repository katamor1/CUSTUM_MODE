import { randomUUID } from "crypto"
import type {
  CoreWorkflowDefinition,
  EngineStep,
  WorkflowRunState
} from "../model"
import { ensureRunBranching } from "./branchState"

export type BranchTransitionAction = "goto" | "end" | "fail" | "checkpoint"

export function recordBranchTransition(
  workflow: CoreWorkflowDefinition,
  run: WorkflowRunState,
  step: EngineStep,
  decisionId: string,
  action: BranchTransitionAction,
  toStepId: string | undefined,
  loopId: string | undefined,
  loopCount: number | undefined,
  conditionSnapshot: unknown
): void {
  const branching = ensureRunBranching(workflow, run)
  if (!branching) return
  branching.history.push({
    id: randomUUID(),
    loopId,
    decisionId,
    fromStepId: step.id,
    toStepId,
    action,
    loopCount,
    createdAt: new Date().toISOString(),
    conditionSnapshot
  })
}
