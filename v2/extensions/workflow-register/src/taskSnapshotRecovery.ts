import type {
  CoreWorkflowDefinition,
  EngineStep,
  WorkflowRunState
} from "./core/model"
import {
  snapshotMatchesRun
} from "./core/taskSnapshots"
import type { TaskSnapshotStore } from "./core/taskSnapshots"

export async function recoverResultTextFromSnapshots(
  snapshotStore: TaskSnapshotStore,
  workflow: CoreWorkflowDefinition,
  run: WorkflowRunState,
  step: EngineStep
): Promise<string | undefined> {
  const latest = await snapshotStore.loadLatest(run.runId)
  if (latest && snapshotMatchesRun(latest, workflow, run, step) && latest.lastAssistantText?.trim()) {
    return latest.lastAssistantText
  }
  const agentOutput = await snapshotStore.findLatestSnapshot(
    run.runId,
    (snapshot) => snapshot.reason === "agent-output"
      && snapshotMatchesRun(snapshot, workflow, run, step)
      && Boolean(snapshot.lastAssistantText?.trim())
  )
  return agentOutput?.lastAssistantText
}
