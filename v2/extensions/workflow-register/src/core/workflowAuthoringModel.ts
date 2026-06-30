import {
  ResultSourceDefinition,
  WorkflowArtifactDefinition,
  WorkflowCompletionDefinition,
  WorkflowFailurePolicy,
  WorkflowGuardrailsDefinition,
  WorkflowInputDefinition,
  WorkflowPreflightDefinition,
  WorkflowRequiresDefinition,
  WorkflowStepType
} from "./model"
import { WorkflowTemplateKind } from "./workflowScaffold"

export interface WorkflowAuthoringModel {
  metadata: WorkflowAuthoringMetadata
  inputs: WorkflowAuthoringInput[]
  requires?: WorkflowRequiresDefinition
  preflight: WorkflowPreflightDefinition[]
  guardrails?: WorkflowGuardrailsDefinition
  steps: WorkflowAuthoringStep[]
  artifacts: WorkflowArtifactDefinition[]
  completion?: WorkflowCompletionDefinition
  body?: string
  unknownFrontMatter?: Record<string, unknown>
}

export interface WorkflowAuthoringMetadata {
  schemaVersion: "workflow-register/v1"
  name: string
  title?: string
  description: string
  mode: string
  workspaceRequired: boolean
  hidden?: boolean
  template?: WorkflowTemplateKind
}

export interface WorkflowAuthoringInput extends WorkflowInputDefinition {
  id: string
}

export type WorkflowAuthoringStep =
  | WorkflowAuthoringCommandStep
  | WorkflowAuthoringAgentStep
  | WorkflowAuthoringManualStep
  | WorkflowAuthoringResultStep

export interface WorkflowAuthoringStepBase {
  id: string
  title: string
  type: WorkflowStepType
  required?: boolean
  prompt?: string
  sendResult?: boolean
  completeOnSuccess?: boolean
  includeState?: string[]
  maxResultBytes?: number
  stateRequired?: boolean
  resultKey?: string
}

export interface WorkflowAuthoringCommandStep extends WorkflowAuthoringStepBase {
  type: "command"
  action: {
    provider: string
    args?: unknown[]
  }
}

export interface WorkflowAuthoringAgentStep extends WorkflowAuthoringStepBase {
  type: "agent"
  result?: ResultSourceDefinition
}

export interface WorkflowAuthoringManualStep extends WorkflowAuthoringStepBase {
  type: "manual"
}

export interface WorkflowAuthoringResultStep extends WorkflowAuthoringStepBase {
  type: "result"
  result: ResultSourceDefinition
}

export interface WorkflowAuthoringReferenceSummary {
  stepIds: string[]
  resultKeys: string[]
  commands: string[]
}

export interface WorkflowAuthoringIssue {
  severity: "error" | "warning" | "info"
  message: string
  target?: string
}

export function collectAuthoringReferences(model: WorkflowAuthoringModel): WorkflowAuthoringReferenceSummary {
  const stepIds = model.steps.map((step) => step.id).filter(Boolean)
  const resultKeys = model.steps.map((step) => step.resultKey).filter((key): key is string => Boolean(key))
  const commands = model.steps.flatMap((step) => {
    if (step.type !== "command") return []
    const firstArg = Array.isArray(step.action.args) ? step.action.args[0] : undefined
    return typeof firstArg === "string" && firstArg.trim() ? [firstArg.trim()] : []
  })
  return { stepIds, resultKeys, commands }
}

export function availableResultKeysBefore(model: WorkflowAuthoringModel, stepIndex: number): string[] {
  return model.steps
    .slice(0, Math.max(0, stepIndex))
    .map((step) => step.resultKey)
    .filter((key): key is string => Boolean(key))
}

export function nextUniqueId(base: string, usedIds: Iterable<string>): string {
  const normalizedBase = normalizeId(base) || "step"
  const used = new Set(usedIds)
  if (!used.has(normalizedBase)) return normalizedBase
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${normalizedBase}-${index}`
    if (!used.has(candidate)) return candidate
  }
  return `${normalizedBase}-${Date.now()}`
}

export function normalizeId(value: string): string {
  return value.trim().replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^[._-]+/, "").replace(/[._-]+$/, "")
}

export function failurePolicyOrUndefined(value: string | undefined): WorkflowFailurePolicy | undefined {
  return value === "stop" || value === "continue" || value === "warn" ? value : undefined
}
