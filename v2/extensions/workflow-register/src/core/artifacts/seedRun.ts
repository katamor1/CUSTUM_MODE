import type {
  CoreWorkflowDefinition,
  EngineStep,
  RunStepState,
  WorkflowRunState
} from "../model"
import type { WorkflowArtifactManifest } from "./artifactManifest"

export const ARTIFACT_REUSE_STATE_KEY = "workflow.artifactReuse"

export interface WorkflowArtifactReuseRecord {
  schemaVersion: "workflow-register/artifact-reuse/v1"
  sourceRunId: string
  sourceWorkflowId: string
  sourceWorkflowDefinitionHash?: string
  startStepId: string
  reusedStepIds: string[]
  hydratedKeys: string[]
  createdAt: string
}

export interface SeedWorkflowRunFromArtifactsResult {
  ok: boolean
  reusedStepIds: string[]
  hydratedKeys: string[]
  error?: string
}

export function stateKeysProducedBeforeStep(workflow: CoreWorkflowDefinition, startStepId: string): string[] {
  const targetIndex = workflow.engineSteps.findIndex((step) => step.id === startStepId)
  if (targetIndex < 0) throw new Error(`Workflow step not found: ${startStepId}`)
  const keys: string[] = []
  for (const step of workflow.engineSteps.slice(0, targetIndex)) keys.push(...stepOutputStateKeys(step))
  return unique(keys)
}

export function seedWorkflowRunFromArtifacts(input: {
  workflow: CoreWorkflowDefinition
  run: WorkflowRunState
  manifest: WorkflowArtifactManifest
  startStepId: string
  hydratedKeys: string[]
  now?: () => string
}): SeedWorkflowRunFromArtifactsResult {
  const targetIndex = input.workflow.engineSteps.findIndex((step) => step.id === input.startStepId)
  if (targetIndex < 0) return { ok: false, reusedStepIds: [], hydratedKeys: input.hydratedKeys, error: `Workflow step not found: ${input.startStepId}` }

  const now = input.now?.() ?? new Date().toISOString()
  const hydratedKeySet = new Set(input.hydratedKeys)
  const reusedStepIds: string[] = []
  for (let index = 0; index < input.workflow.engineSteps.length; index += 1) {
    const step = input.workflow.engineSteps[index]
    const stepState = input.run.steps[index]
    if (!stepState) continue
    if (index < targetIndex) {
      markStepCompleted(stepState, now)
      reusedStepIds.push(step.id)
      continue
    }
    resetStepPending(stepState)
  }

  const producedBefore = stateKeysProducedBeforeStep(input.workflow, input.startStepId)
  const missingProducedState = producedBefore.filter((key) => !hydratedKeySet.has(key) && input.run.state[key] === undefined)
  if (missingProducedState.length > 0) {
    return {
      ok: false,
      reusedStepIds,
      hydratedKeys: input.hydratedKeys,
      error: `Cannot seed skip-resume run because prior step state is missing: ${missingProducedState.join(", ")}`
    }
  }

  input.run.status = "running"
  input.run.currentStep = input.startStepId
  input.run.error = undefined
  input.run.state[ARTIFACT_REUSE_STATE_KEY] = JSON.stringify({
    schemaVersion: "workflow-register/artifact-reuse/v1",
    sourceRunId: input.manifest.runId,
    sourceWorkflowId: input.manifest.workflowId,
    sourceWorkflowDefinitionHash: input.manifest.workflowDefinitionHash,
    startStepId: input.startStepId,
    reusedStepIds,
    hydratedKeys: input.hydratedKeys,
    createdAt: now
  } satisfies WorkflowArtifactReuseRecord)
  return { ok: true, reusedStepIds, hydratedKeys: input.hydratedKeys }
}

function stepOutputStateKeys(step: EngineStep): string[] {
  if (step.type === "manual") {
    return [step.form?.resultKey, step.approval?.resultKey].filter((key): key is string => Boolean(key))
  }
  if ("resultKey" in step && step.resultKey) return [step.resultKey]
  return []
}

function markStepCompleted(step: RunStepState, completedAt: string): void {
  step.status = "completed"
  step.completedAt = step.completedAt ?? completedAt
  step.error = undefined
  step.reviewStartedAt = undefined
  step.acceptedAt = step.acceptedAt ?? completedAt
  step.startedAt = step.startedAt ?? completedAt
}

function resetStepPending(step: RunStepState): void {
  step.status = "pending"
  step.error = undefined
  step.startedAt = undefined
  step.completedAt = undefined
  step.reviewStartedAt = undefined
  step.acceptedAt = undefined
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)))
}
