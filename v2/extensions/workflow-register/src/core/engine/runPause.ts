import type {
  CoreWorkflowDefinition,
  EngineStep,
  WorkflowRunState
} from "../model"
import type { RunControlStore } from "../runControlStore"
import type { RunStateStore } from "../runStateStore"
import type { WorkflowEngineEventInput } from "../engineTypes"

type RunPauseEmitter = (input: WorkflowEngineEventInput) => Promise<void>

export async function pauseRunIfRequested(input: {
  workflow: CoreWorkflowDefinition
  run: WorkflowRunState
  nextStep: EngineStep | undefined
  checkpoint: string
  runStore: RunStateStore
  runControlStore?: RunControlStore
  emitRunPaused: RunPauseEmitter
}): Promise<boolean> {
  const { workflow, run, nextStep, checkpoint, runStore, runControlStore, emitRunPaused } = input
  const control = await runControlStore?.loadControl(run.runId)
  if (!control?.pauseRequestedAt || control.clearedAt) return false
  run.status = "paused"
  run.error = undefined
  if (nextStep) run.currentStep = nextStep.id
  run.state["workflow.pause"] = JSON.stringify({
    pauseRequestedAt: control.pauseRequestedAt,
    pauseReason: control.pauseReason ?? "manual",
    requestedBy: control.requestedBy ?? "user",
    mode: control.mode ?? "afterCurrentStep",
    checkpoint,
    detectedAt: new Date().toISOString()
  })
  await runStore.saveRun(run)
  await emitRunPaused({ workflow, run, step: nextStep, pause: control })
  return true
}
