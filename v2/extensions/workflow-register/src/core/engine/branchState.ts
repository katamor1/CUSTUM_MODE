import type {
  CoreWorkflowDefinition,
  WorkflowRunBranchingState,
  WorkflowRunState
} from "../model"

export function ensureRunBranching(workflow: CoreWorkflowDefinition, run: WorkflowRunState): WorkflowRunBranchingState | undefined {
  if (!workflow.branching) return undefined
  if (!run.branching) run.branching = { loops: {}, history: [] }
  for (const loop of workflow.branching.loops) {
    const existing = run.branching.loops[loop.id]
    run.branching.loops[loop.id] = {
      loopId: loop.id,
      count: existing?.count ?? 0,
      allowed: existing?.allowed ?? loop.maxIterations,
      maxIterations: loop.maxIterations,
      extensionSize: loop.extensionSize,
      checkpointCount: existing?.checkpointCount ?? 0,
      lastTransitionAt: existing?.lastTransitionAt
    }
  }
  return run.branching
}
