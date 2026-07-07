import { buildWorkflowAgentPrompt, extractSubagentResult } from "./agentStep"
import type { BobWorkflowTask } from "./bobWorkflowTypes"
import type {
  AgentProvider,
  BobTaskSyncDriftStatus,
  BobTaskSyncState,
  CoreWorkflowDefinition,
  WorkflowRunState
} from "./core/model"
import type { WorkflowStateEntry } from "./workflowPromptContext"

export type BobTaskSyncReason =
  | "bob-runner-step-completed"
  | "review-accepted"
  | "operation-hub-next"
  | "operation-hub-resume"
  | "operation-hub-retry"
  | "manual-completed"
  | "paused"
  | "inspect"

export interface BobTaskSyncReconcileOptions {
  reason: BobTaskSyncReason
  task?: BobWorkflowTask
  alreadyApplied?: boolean
  now?: () => string
}

export interface BobTaskSyncReconcileResult {
  status: BobTaskSyncDriftStatus
  targetCompletedThroughIndex: number
  completedThroughIndex: number
  appliedStepCount: number
  taskAvailable: boolean
  message: string
}

export class ReviewTaskRegistry {
  private readonly tasksByStep = new Map<string, BobWorkflowTask>()
  private readonly tasksByRun = new Map<string, BobWorkflowTask>()
  private readonly completedSteps = new Set<string>()

  register(runId: string | undefined, stepId: string | undefined, task: BobWorkflowTask): boolean {
    if (!runId || !stepId) return false
    if (typeof task.setStepComplete !== "function" && typeof task.startSubagent !== "function") return false
    const key = reviewTaskKey(runId, stepId)
    this.tasksByStep.set(key, task)
    this.tasksByRun.set(runId, task)
    this.completedSteps.delete(key)
    return true
  }

  registerTask(runId: string | undefined, stepId: string | undefined, task: BobWorkflowTask): boolean {
    return this.register(runId, stepId, task)
  }

  taskForRun(runId: string | undefined): BobWorkflowTask | undefined {
    return runId ? this.tasksByRun.get(runId) : undefined
  }

  taskForStep(runId: string | undefined, stepId: string | undefined): BobWorkflowTask | undefined {
    return runId && stepId ? this.tasksByStep.get(reviewTaskKey(runId, stepId)) : undefined
  }

  complete(runId: string | undefined, stepId: string | undefined): boolean {
    if (!runId || !stepId) return false
    const key = reviewTaskKey(runId, stepId)
    if (this.completedSteps.has(key)) return false
    const task = this.tasksByStep.get(key) ?? this.tasksByRun.get(runId)
    this.tasksByStep.delete(key)
    if (typeof task?.setStepComplete !== "function") return false
    try {
      task.setStepComplete()
      this.completedSteps.add(key)
      return true
    } catch (error) {
      console.warn("Failed to mark Bob review task complete", error)
      return false
    }
  }

  reconcileRun(
    run: WorkflowRunState,
    workflow: CoreWorkflowDefinition | undefined,
    options: BobTaskSyncReconcileOptions
  ): BobTaskSyncReconcileResult {
    const task = options.task ?? this.taskForRun(run.runId)
    return reconcileBobTaskSync(run, workflow, { ...options, task })
  }

  agentProviderForRun(runId: string | undefined, workflow: CoreWorkflowDefinition): AgentProvider | undefined {
    const task = this.taskForRun(runId)
    if (typeof task?.startSubagent !== "function") return undefined
    const startSubagent = task.startSubagent.bind(task)
    return {
      run: async (input) => {
        const stepIndex = workflow.engineSteps.findIndex((candidate) => candidate.id === input.stepId)
        const step = stepIndex >= 0 ? workflow.engineSteps[stepIndex] : undefined
        const value = await startSubagent(buildWorkflowAgentPrompt({
          workflowId: workflow.id,
          workflowName: workflow.name,
          workflowRoot: input.workflowRoot ?? workflow.workflowRoot,
          workflowFile: input.workflowFile ?? workflow.workflowFile,
          workflowFolderName: input.workflowFolderName ?? workflow.workflowFolderName,
          stepIndex: Math.max(0, stepIndex),
          stepId: input.stepId,
          stepTitle: step?.title ?? input.stepId,
          stepPrompt: step?.prompt ?? input.prompt,
          workflowInstructions: workflow.promptWithoutTodo,
          stateEntries: stateEntriesFromRecord(input.state, step?.includeState ?? [])
        }))
        const result = extractSubagentResult(value)
        if (!result) throw new Error("Bob subagent returned no result.")
        return result
      }
    }
  }
}

export const reviewTaskRegistry = new ReviewTaskRegistry()
export const bobTaskSyncRegistry = reviewTaskRegistry

export function reconcileBobTaskSync(
  run: WorkflowRunState,
  workflow: CoreWorkflowDefinition | undefined,
  options: BobTaskSyncReconcileOptions
): BobTaskSyncReconcileResult {
  const now = options.now?.() ?? new Date().toISOString()
  const targetCompletedThroughIndex = completedPrefixIndex(run)
  const sync: BobTaskSyncState = run.bobTaskSync ?? {
    schemaVersion: "workflow-register/bob-task-sync/v1",
    projectionVersion: 1,
    completedThroughIndex: -1
  }
  run.bobTaskSync = sync
  sync.projectionVersion = 1
  sync.workflowDefinitionHash = workflow?.definitionHash ?? run.workflowDefinitionHash ?? sync.workflowDefinitionHash
  sync.mode = workflow?.stepExecution?.mode ?? sync.mode
  sync.lastCheckedAt = now

  const previousCompletedThroughIndex = normalizeCompletedIndex(sync.completedThroughIndex)
  const taskAvailable = typeof options.task?.setStepComplete === "function"
  sync.liveTaskAvailable = taskAvailable

  if (previousCompletedThroughIndex > targetCompletedThroughIndex) {
    sync.completedThroughIndex = previousCompletedThroughIndex
    sync.completedThroughStepId = stepIdAt(run, previousCompletedThroughIndex) ?? sync.completedThroughStepId
    sync.drift = {
      status: "requiresNewBobTask",
      reason: options.reason,
      detectedAt: now,
      details: `Bob Todo projection is ahead of run.json (${previousCompletedThroughIndex + 1} > ${targetCompletedThroughIndex + 1}); Bob cannot rewind the task UI.`
    }
    return syncResult(sync.drift.status, targetCompletedThroughIndex, sync.completedThroughIndex, 0, taskAvailable)
  }

  if (previousCompletedThroughIndex === targetCompletedThroughIndex) {
    sync.completedThroughIndex = targetCompletedThroughIndex
    sync.completedThroughStepId = stepIdAt(run, targetCompletedThroughIndex)
    sync.drift = { status: "synced", reason: options.reason, detectedAt: now }
    return syncResult("synced", targetCompletedThroughIndex, sync.completedThroughIndex, 0, taskAvailable)
  }

  if (options.alreadyApplied) {
    sync.completedThroughIndex = targetCompletedThroughIndex
    sync.completedThroughStepId = stepIdAt(run, targetCompletedThroughIndex)
    sync.lastAppliedAt = now
    sync.drift = { status: "synced", reason: options.reason, detectedAt: now }
    return syncResult("synced", targetCompletedThroughIndex, sync.completedThroughIndex, 0, taskAvailable)
  }

  if (!taskAvailable || !options.task?.setStepComplete) {
    sync.completedThroughIndex = previousCompletedThroughIndex
    sync.completedThroughStepId = stepIdAt(run, previousCompletedThroughIndex) ?? sync.completedThroughStepId
    sync.drift = {
      status: "taskUnavailable",
      reason: options.reason,
      detectedAt: now,
      details: `run.json is authoritative through step ${targetCompletedThroughIndex + 1}, but no live Bob task handle can advance the Todo UI.`
    }
    return syncResult("taskUnavailable", targetCompletedThroughIndex, sync.completedThroughIndex, 0, taskAvailable)
  }

  let appliedStepCount = 0
  for (let index = previousCompletedThroughIndex + 1; index <= targetCompletedThroughIndex; index += 1) {
    try {
      options.task.setStepComplete()
      appliedStepCount += 1
      sync.completedThroughIndex = index
      sync.completedThroughStepId = stepIdAt(run, index)
      sync.lastAppliedAt = now
    } catch (error) {
      sync.drift = {
        status: "repairFailed",
        reason: options.reason,
        detectedAt: now,
        details: error instanceof Error ? error.message : String(error)
      }
      return syncResult("repairFailed", targetCompletedThroughIndex, sync.completedThroughIndex, appliedStepCount, taskAvailable)
    }
  }

  sync.drift = { status: "synced", reason: options.reason, detectedAt: now }
  return syncResult("synced", targetCompletedThroughIndex, sync.completedThroughIndex, appliedStepCount, taskAvailable)
}

export function completedPrefixIndex(run: WorkflowRunState): number {
  let completedThrough = -1
  for (const [index, step] of run.steps.entries()) {
    if (step.status !== "completed") break
    completedThrough = index
  }
  return completedThrough
}

function normalizeCompletedIndex(value: number | undefined): number {
  return Number.isFinite(value) ? Math.trunc(value as number) : -1
}

function stepIdAt(run: WorkflowRunState, index: number): string | undefined {
  return index >= 0 ? run.steps[index]?.id : undefined
}

function syncResult(
  status: BobTaskSyncDriftStatus,
  targetCompletedThroughIndex: number,
  completedThroughIndex: number,
  appliedStepCount: number,
  taskAvailable: boolean
): BobTaskSyncReconcileResult {
  return {
    status,
    targetCompletedThroughIndex,
    completedThroughIndex,
    appliedStepCount,
    taskAvailable,
    message: `Bob Todo sync ${status}: applied ${appliedStepCount}; projected=${completedThroughIndex + 1}; target=${targetCompletedThroughIndex + 1}`
  }
}

function reviewTaskKey(runId: string, stepId: string): string {
  return `${runId}:${stepId}`
}

function stateEntriesFromRecord(state: Record<string, string>, keys: string[]): WorkflowStateEntry[] {
  return keys.flatMap((key) => state[key] === undefined ? [] : [{ key, value: state[key] }])
}
