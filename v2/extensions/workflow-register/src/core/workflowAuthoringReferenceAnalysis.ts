import { WorkflowAuthoringModel } from "./workflowAuthoringModel"

export type WorkflowAuthoringReferenceIssueKind =
  | "duplicate-step-id"
  | "unknown-include-state"
  | "forward-include-state"
  | "unknown-artifact-producer"

export interface WorkflowAuthoringReferenceIssue {
  kind: WorkflowAuthoringReferenceIssueKind
  severity: "error" | "warning"
  message: string
  stepId?: string
  stepIndex?: number
  artifactId?: string
  key?: string
}

export interface WorkflowAuthoringRemovalImpact {
  stepId: string
  resultKeys: string[]
  includeStateConsumers: Array<{ stepId: string; stepIndex: number; key: string }>
  producedArtifacts: Array<{ artifactId: string; path: string }>
}

export interface WorkflowAuthoringMoveImpact {
  stepId: string
  fromIndex: number
  toIndex: number
  issues: WorkflowAuthoringReferenceIssue[]
}

/**
 * Checks references that the GUI can break while editing step order or ids.
 *
 * The runtime validator still runs before save. This analysis is intentionally
 * lightweight and focused on interactive UX: warn users as soon as a step move,
 * removal, or artifact producer selection would create broken references.
 */
export function analyzeAuthoringReferences(model: WorkflowAuthoringModel): WorkflowAuthoringReferenceIssue[] {
  const issues: WorkflowAuthoringReferenceIssue[] = []
  const stepIds = new Set<string>()
  const seenResultKeys = new Set<string>()
  const allResultKeys = new Set(model.steps.map((step) => step.resultKey).filter((key): key is string => Boolean(key)))

  model.steps.forEach((step, index) => {
    if (stepIds.has(step.id)) {
      issues.push({ kind: "duplicate-step-id", severity: "error", stepId: step.id, stepIndex: index, message: `Step '${step.id}' duplicates an earlier step id.` })
    }
    stepIds.add(step.id)

    for (const key of step.includeState ?? []) {
      if (!allResultKeys.has(key)) {
        issues.push({ kind: "unknown-include-state", severity: "error", stepId: step.id, stepIndex: index, key, message: `Step '${step.id}' includeState references unknown resultKey '${key}'.` })
      } else if (!seenResultKeys.has(key)) {
        issues.push({ kind: "forward-include-state", severity: "error", stepId: step.id, stepIndex: index, key, message: `Step '${step.id}' includeState references resultKey '${key}' before it is produced.` })
      }
    }

    if (step.resultKey) seenResultKeys.add(step.resultKey)
  })

  for (const artifact of model.artifacts) {
    if (artifact.producedBy && !stepIds.has(artifact.producedBy)) {
      issues.push({ kind: "unknown-artifact-producer", severity: "error", artifactId: artifact.id, key: artifact.producedBy, message: `Artifact '${artifact.id}' references unknown producedBy step '${artifact.producedBy}'.` })
    }
  }

  return issues
}

/** Returns the references that would be affected before the GUI deletes a step. */
export function analyzeStepRemovalImpact(model: WorkflowAuthoringModel, stepIndex: number): WorkflowAuthoringRemovalImpact | undefined {
  const step = model.steps[stepIndex]
  if (!step) return undefined
  const resultKeys = step.resultKey ? [step.resultKey] : []
  const includeStateConsumers = resultKeys.flatMap((key) => model.steps.flatMap((candidate, candidateIndex) => {
    if (candidateIndex === stepIndex) return []
    return (candidate.includeState ?? []).includes(key) ? [{ stepId: candidate.id, stepIndex: candidateIndex, key }] : []
  }))
  const producedArtifacts = model.artifacts.flatMap((artifact) => artifact.producedBy === step.id ? [{ artifactId: artifact.id, path: artifact.path }] : [])
  return { stepId: step.id, resultKeys, includeStateConsumers, producedArtifacts }
}

/** Simulates a move so the GUI can warn before it creates forward references. */
export function analyzeStepMoveImpact(model: WorkflowAuthoringModel, fromIndex: number, toIndex: number): WorkflowAuthoringMoveImpact | undefined {
  const step = model.steps[fromIndex]
  if (!step || toIndex < 0 || toIndex >= model.steps.length || fromIndex === toIndex) return undefined
  const next = model.steps.slice()
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  const nextModel: WorkflowAuthoringModel = { ...model, steps: next }
  const movedStepIndex = next.findIndex((candidate) => candidate === moved)
  const relatedKeys = new Set<string>([moved.resultKey, ...(moved.includeState ?? [])].filter((key): key is string => Boolean(key)))
  const issues = analyzeAuthoringReferences(nextModel).filter((issue) => {
    if (issue.stepId === moved.id) return true
    if (issue.key && relatedKeys.has(issue.key)) return true
    return false
  })
  return { stepId: moved.id, fromIndex, toIndex: movedStepIndex, issues }
}

export function formatRemovalImpact(impact: WorkflowAuthoringRemovalImpact): string[] {
  const lines: string[] = []
  if (impact.resultKeys.length > 0) lines.push(`削除される resultKey: ${impact.resultKeys.join(", ")}`)
  for (const consumer of impact.includeStateConsumers) lines.push(`step '${consumer.stepId}' の includeState '${consumer.key}' が参照切れになります。`)
  for (const artifact of impact.producedArtifacts) lines.push(`artifact '${artifact.artifactId}' の producedBy が参照切れになります: ${artifact.path}`)
  return lines
}
