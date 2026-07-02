import type { WorkflowAuthoringModel, WorkflowAuthoringStep } from "./workflowAuthoringModel"

export interface StepDraftReferenceRepairInput {
  model: WorkflowAuthoringModel
  originalStep: WorkflowAuthoringStep
  draftStep: WorkflowAuthoringStep
  stepIndex: number
}

export interface StepDraftReferenceRepairResult {
  model: WorkflowAuthoringModel
  updatedArtifactIds: string[]
  updatedStepIds: string[]
  updatedResultStateStepIds: string[]
}

export function applyStepDraftReferenceRepair(input: StepDraftReferenceRepairInput): StepDraftReferenceRepairResult {
  const { model, originalStep, draftStep, stepIndex } = input
  const oldStepId = asText(originalStep.id)
  const newStepId = asText(draftStep.id)
  const oldResultKey = asText(originalStep.resultKey)
  const newResultKey = asText(draftStep.resultKey)
  const updatedArtifactIds: string[] = []
  const updatedStepIds: string[] = []
  const updatedResultStateStepIds: string[] = []

  const artifacts = model.artifacts.map((artifact) => {
    if (oldStepId && newStepId && artifact.producedBy === oldStepId) {
      updatedArtifactIds.push(artifact.id)
      return { ...artifact, producedBy: newStepId }
    }
    return artifact
  })

  const steps = model.steps.map((step, index) => {
    if (index === stepIndex) return cloneAuthoringStep(draftStep)
    let next = step
    if (oldResultKey && newResultKey && Array.isArray(step.includeState) && step.includeState.includes(oldResultKey)) {
      next = { ...next, includeState: step.includeState.map((key) => key === oldResultKey ? newResultKey : key) } as WorkflowAuthoringStep
      updatedStepIds.push(step.id)
    }
    if (oldResultKey && newResultKey && next.type === "result" && next.result.source === "state" && next.result.stateKey === oldResultKey) {
      next = { ...next, result: { ...next.result, stateKey: newResultKey } } as WorkflowAuthoringStep
      updatedResultStateStepIds.push(step.id)
    }
    return next
  })

  return { model: { ...model, steps, artifacts }, updatedArtifactIds, updatedStepIds, updatedResultStateStepIds }
}

function cloneAuthoringStep(step: WorkflowAuthoringStep): WorkflowAuthoringStep {
  return JSON.parse(JSON.stringify(step)) as WorkflowAuthoringStep
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}
