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

interface BobTaskProjection {
  completedThroughIndex: number
  total: number
  source: string
  details: string
  confidence: number
}

type TodoCompletionState = "completed" | "notCompleted"

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

  async reconcileRun(
    run: WorkflowRunState,
    workflow: CoreWorkflowDefinition | undefined,
    options: BobTaskSyncReconcileOptions
  ): Promise<BobTaskSyncReconcileResult> {
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

export async function reconcileBobTaskSync(
  run: WorkflowRunState,
  workflow: CoreWorkflowDefinition | undefined,
  options: BobTaskSyncReconcileOptions
): Promise<BobTaskSyncReconcileResult> {
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

  const storedCompletedThroughIndex = normalizeCompletedIndex(sync.completedThroughIndex)
  const observedBefore = readBobTaskProjection(options.task, run)
  const previousCompletedThroughIndex = observedBefore?.completedThroughIndex ?? storedCompletedThroughIndex
  const taskAvailable = typeof options.task?.setStepComplete === "function"
  sync.liveTaskAvailable = taskAvailable

  if (observedBefore && observedBefore.completedThroughIndex !== storedCompletedThroughIndex) {
    sync.completedThroughIndex = observedBefore.completedThroughIndex
    sync.completedThroughStepId = stepIdAt(run, observedBefore.completedThroughIndex)
    sync.drift = {
      status: "repairPending",
      reason: options.reason,
      detectedAt: now,
      details: `Bob task export projection ${observedBefore.details} differs from stored projection ${storedCompletedThroughIndex + 1}.`
    }
  }

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
      await applyBobStepComplete(options.task)
      const observedAfter = readBobTaskProjection(options.task, run)
      if (observedAfter && observedAfter.completedThroughIndex < index) {
        sync.completedThroughIndex = observedAfter.completedThroughIndex
        sync.completedThroughStepId = stepIdAt(run, observedAfter.completedThroughIndex) ?? sync.completedThroughStepId
        sync.drift = {
          status: "repairFailed",
          reason: options.reason,
          detectedAt: now,
          details: `Bob task export still reports ${observedAfter.details} after setStepComplete for target step ${index + 1}.`
        }
        return syncResult("repairFailed", targetCompletedThroughIndex, sync.completedThroughIndex, appliedStepCount, taskAvailable)
      }
      appliedStepCount += 1
      sync.completedThroughIndex = observedAfter?.completedThroughIndex ?? index
      sync.completedThroughStepId = stepIdAt(run, sync.completedThroughIndex)
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

  const finalProjection = readBobTaskProjection(options.task, run)
  if (finalProjection && finalProjection.completedThroughIndex < targetCompletedThroughIndex) {
    sync.completedThroughIndex = finalProjection.completedThroughIndex
    sync.completedThroughStepId = stepIdAt(run, finalProjection.completedThroughIndex) ?? sync.completedThroughStepId
    sync.drift = {
      status: "repairPending",
      reason: options.reason,
      detectedAt: now,
      details: `Bob task export remains behind run.json: ${finalProjection.details}; target=${targetCompletedThroughIndex + 1}.`
    }
    return syncResult("repairPending", targetCompletedThroughIndex, sync.completedThroughIndex, appliedStepCount, taskAvailable)
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

function readBobTaskProjection(task: BobWorkflowTask | undefined, run: WorkflowRunState): BobTaskProjection | undefined {
  if (!task) return undefined
  const candidates: BobTaskProjection[] = []
  const exported = safeRead(() => task.toSerializable?.())
  const metadata = safeRead(() => task.getAllMetadata?.())
  collectTaskProjection(exported, run, "taskExport", "taskExport", candidates)
  collectTaskProjection(metadata, run, "taskMetadata", "taskMetadata", candidates)
  return candidates.sort((left, right) => right.confidence - left.confidence)[0]
}

function collectTaskProjection(
  value: unknown,
  run: WorkflowRunState,
  source: string,
  path: string,
  output: BobTaskProjection[],
  depth = 0,
  seen = new Set<unknown>()
): void {
  if (!value || depth > 8) return
  if (typeof value !== "object") return
  if (seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    const projection = projectionFromTodoArray(value, run, source, path)
    if (projection) output.push(projection)
    value.forEach((item, index) => collectTaskProjection(item, run, source, `${path}[${index}]`, output, depth + 1, seen))
    return
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    collectTaskProjection(item, run, source, `${path}.${key}`, output, depth + 1, seen)
  }
}

function projectionFromTodoArray(value: unknown[], run: WorkflowRunState, source: string, path: string): BobTaskProjection | undefined {
  if (run.steps.length === 0 || value.length < Math.min(2, run.steps.length)) return undefined
  const relevantLength = Math.min(value.length, run.steps.length)
  const statuses = value.slice(0, relevantLength).map(todoCompletionState)
  const knownStatusCount = statuses.filter(Boolean).length
  if (knownStatusCount === 0) return undefined
  const matchingStepCount = value.slice(0, relevantLength).filter((item, index) => todoItemMatchesStep(item, run.steps[index])).length
  const pathLooksRelevant = /todo|task|step|item|checklist/i.test(path)
  if (!pathLooksRelevant && matchingStepCount < 2 && value.length !== run.steps.length) return undefined
  let completedThroughIndex = -1
  for (const status of statuses) {
    if (status !== "completed") break
    completedThroughIndex += 1
  }
  completedThroughIndex = Math.min(completedThroughIndex, run.steps.length - 1)
  const confidence = knownStatusCount + (matchingStepCount * 3) + (pathLooksRelevant ? 5 : 0) + (value.length === run.steps.length ? 2 : 0)
  return {
    completedThroughIndex,
    total: value.length,
    source,
    details: `${source}:${path}; completed=${completedThroughIndex + 1}/${value.length}; known=${knownStatusCount}; matched=${matchingStepCount}`,
    confidence
  }
}

function todoCompletionState(value: unknown): TodoCompletionState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  for (const key of ["completed", "complete", "done", "checked", "finished", "isComplete", "isCompleted"]) {
    const candidate = record[key]
    if (typeof candidate === "boolean") return candidate ? "completed" : "notCompleted"
  }
  for (const key of ["status", "state", "phase", "kind", "result"]) {
    const candidate = record[key]
    if (typeof candidate !== "string") continue
    const normalized = candidate.trim().toLowerCase()
    if (/^(completed|complete|done|finished|success|succeeded|accepted|approved|passed|checked)$/.test(normalized)) return "completed"
    if (/^(pending|todo|open|active|current|running|reviewing|held|waiting|blocked|failed|error|in[-_ ]?progress)$/.test(normalized)) return "notCompleted"
  }
  return undefined
}

function todoItemMatchesStep(value: unknown, step: { id: string; title?: string }): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const candidates = [record.id, record.key, record.stepId, record.title, record.text, record.label, record.name]
    .filter((item): item is string => typeof item === "string")
    .map(normalizeMatchText)
  const stepValues = [step.id, step.title].filter((item): item is string => typeof item === "string").map(normalizeMatchText)
  return candidates.some((candidate) => stepValues.some((stepValue) => candidate === stepValue || candidate.includes(stepValue) || stepValue.includes(candidate)))
}

function normalizeMatchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ")
}

function safeRead(read: () => unknown): unknown {
  try {
    return read()
  } catch {
    return undefined
  }
}

async function applyBobStepComplete(task: BobWorkflowTask): Promise<void> {
  if (typeof task.setStepComplete !== "function") throw new Error("Bob task does not support setStepComplete.")
  await Promise.resolve(task.setStepComplete())
  await waitForBobTodoProjectionTick()
}

function waitForBobTodoProjectionTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
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
