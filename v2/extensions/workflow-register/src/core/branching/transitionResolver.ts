import type {
  EngineStep,
  WorkflowRunState
} from "../model"
import { evaluateTransitionCondition } from "./conditionEvaluator"

export type ResolvedTransitionAction = "next" | "goto" | "end" | "fail"

export interface ResolvedWorkflowTransition {
  action: ResolvedTransitionAction
  decisionId: string
  toStepId?: string
  loopId?: string
  conditionSnapshot?: unknown
}

export function resolveStepTransition(step: EngineStep, run: WorkflowRunState): ResolvedWorkflowTransition {
  const transition = step.transition
  if (!transition) return { action: "next", decisionId: "default" }
  for (const decision of transition.decisions) {
    const result = evaluateTransitionCondition(decision.when, run.state)
    if (!result.matched) continue
    return {
      action: "goto",
      decisionId: decision.id,
      toStepId: decision.goto,
      loopId: decision.loop,
      conditionSnapshot: result.snapshot
    }
  }
  return transitionFromDefault(transition.default ?? "next")
}

function transitionFromDefault(defaultAction: string): ResolvedWorkflowTransition {
  if (defaultAction === "next" || defaultAction === "end" || defaultAction === "fail") {
    return { action: defaultAction, decisionId: "default" }
  }
  return {
    action: "goto",
    decisionId: "default",
    toStepId: defaultAction
  }
}
