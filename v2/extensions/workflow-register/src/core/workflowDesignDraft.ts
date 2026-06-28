import { WorkflowTemplateKind } from "./workflowScaffold"

export type WorkflowDesignInputType = "string" | "number" | "boolean" | "select"
export type WorkflowDesignStepType = "manual" | "agent" | "command" | "result"

export interface WorkflowDesignDraft {
  name: string
  title?: string
  description: string
  template?: WorkflowTemplateKind
  inputs?: WorkflowDesignInput[]
  steps?: WorkflowDesignStep[]
  artifacts?: WorkflowDesignArtifact[]
  guardrails?: WorkflowDesignGuardrails
  notes?: string[]
}

export interface WorkflowDesignInput {
  id: string
  title?: string
  type?: WorkflowDesignInputType
  required?: boolean
  options?: string[]
}

export interface WorkflowDesignStep {
  id: string
  title?: string
  type?: WorkflowDesignStepType
  prompt?: string
  commandProvider?: string
  commandArgs?: unknown[]
  resultKey?: string
  includeState?: string[]
}

export interface WorkflowDesignArtifact {
  id: string
  path: string
  producedBy?: string
}

export interface WorkflowDesignGuardrails {
  allowedCommands?: string[]
  deniedCommands?: string[]
}

export interface WorkflowDesignDraftValidationResult {
  ok: boolean
  errors: string[]
  warnings: string[]
}

export function validateWorkflowDesignDraft(draft: WorkflowDesignDraft): WorkflowDesignDraftValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  if (!draft.name?.trim()) errors.push("Draft name is required.")
  if (!draft.description?.trim()) errors.push("Draft description is required.")
  const inputIds = new Set<string>()
  for (const input of draft.inputs ?? []) {
    if (!input.id?.trim()) errors.push("Input id is required.")
    if (inputIds.has(input.id)) errors.push(`Duplicate input id '${input.id}'.`)
    inputIds.add(input.id)
    if ((input.type ?? "string") === "select" && (!input.options || input.options.length === 0)) errors.push(`Input '${input.id}' is select but has no options.`)
  }
  const stepIds = new Set<string>()
  for (const step of draft.steps ?? []) {
    if (!step.id?.trim()) errors.push("Step id is required.")
    if (stepIds.has(step.id)) errors.push(`Duplicate step id '${step.id}'.`)
    stepIds.add(step.id)
    if ((step.type ?? "agent") === "command" && !step.commandProvider?.trim()) errors.push(`Command step '${step.id}' has no commandProvider.`)
    if ((step.type ?? "agent") === "agent" && !step.prompt?.trim()) warnings.push(`Agent step '${step.id}' has no prompt; the draft description will be used.`)
  }
  const artifactIds = new Set<string>()
  for (const artifact of draft.artifacts ?? []) {
    if (!artifact.id?.trim()) errors.push("Artifact id is required.")
    if (!artifact.path?.trim()) errors.push(`Artifact '${artifact.id || "<unknown>"}' has no path.`)
    if (artifactIds.has(artifact.id)) errors.push(`Duplicate artifact id '${artifact.id}'.`)
    artifactIds.add(artifact.id)
    if (artifact.producedBy && stepIds.size > 0 && !stepIds.has(artifact.producedBy)) errors.push(`Artifact '${artifact.id}' references unknown producedBy step '${artifact.producedBy}'.`)
  }
  return { ok: errors.length === 0, errors, warnings }
}
