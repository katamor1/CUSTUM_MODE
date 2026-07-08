import * as path from "path"
import type {
  CoreWorkflowDefinition,
  WorkflowRunState
} from "../model"
import {
  findArtifactForStateKey,
  sha256Text,
  validateWorkflowArtifactManifest,
  type WorkflowArtifactManifest,
  type WorkflowArtifactManifestEntry
} from "./artifactManifest"

export const ARTIFACT_HYDRATION_STATE_KEY = "workflow.artifactHydration"

export interface WorkflowArtifactHydrationRecord {
  schemaVersion: "workflow-register/artifact-hydration/v1"
  sourceRunId: string
  sourceWorkflowId: string
  sourceWorkflowDefinitionHash?: string
  hydratedAt: string
  hydrated: WorkflowArtifactHydrationEntry[]
}

export interface WorkflowArtifactHydrationEntry {
  stateKey: string
  artifactId: string
  producedBy: string
  path: string
  sha256: string
  bytes: number
  sourceRunId: string
}

export interface WorkflowArtifactHydrationIssue {
  severity: "error" | "warning"
  message: string
  stateKey?: string
  path?: string
}

export interface WorkflowArtifactHydrationResult {
  ok: boolean
  hydratedKeys: string[]
  skippedKeys: string[]
  issues: WorkflowArtifactHydrationIssue[]
}

export interface HydrateWorkflowStateFromArtifactsInput {
  workflow: CoreWorkflowDefinition
  run: WorkflowRunState
  manifest: WorkflowArtifactManifest
  stateKeys: string[]
  readFile: (relativePath: string) => Promise<string> | string
  overwrite?: boolean
  allowDefinitionMismatch?: boolean
  allowInputMismatch?: boolean
  recordProvenance?: boolean
  now?: () => string
}

export async function hydrateWorkflowStateFromArtifacts(
  input: HydrateWorkflowStateFromArtifactsInput
): Promise<WorkflowArtifactHydrationResult> {
  const issues: WorkflowArtifactHydrationIssue[] = validateWorkflowArtifactManifest({
    manifest: input.manifest,
    workflow: input.workflow,
    inputs: input.run.inputs,
    allowDefinitionMismatch: input.allowDefinitionMismatch,
    allowInputMismatch: input.allowInputMismatch
  })
  if (hasErrors(issues)) return { ok: false, hydratedKeys: [], skippedKeys: [], issues }

  const hydratedKeys: string[] = []
  const skippedKeys: string[] = []
  const hydratedEntries: WorkflowArtifactHydrationEntry[] = []
  for (const stateKey of unique(input.stateKeys)) {
    if (!input.overwrite && input.run.state[stateKey] !== undefined) {
      skippedKeys.push(stateKey)
      continue
    }
    const artifact = findArtifactForStateKey(input.manifest, stateKey)
    if (!artifact) {
      issues.push(error(`Artifact manifest has no artifact for state key '${stateKey}'.`, stateKey))
      continue
    }
    const pathIssue = validateArtifactPath(artifact)
    if (pathIssue) {
      issues.push(pathIssue)
      continue
    }
    let text: string
    try {
      text = await Promise.resolve(input.readFile(artifact.path))
    } catch (cause) {
      issues.push(error(`Failed to read artifact '${artifact.id}': ${cause instanceof Error ? cause.message : String(cause)}`, stateKey, artifact.path))
      continue
    }
    const contentIssue = validateArtifactContent(artifact, text, stateKey)
    if (contentIssue) {
      issues.push(contentIssue)
      continue
    }
    input.run.state[stateKey] = text
    hydratedKeys.push(stateKey)
    hydratedEntries.push({
      stateKey,
      artifactId: artifact.id,
      producedBy: artifact.producedBy,
      path: artifact.path,
      sha256: artifact.sha256,
      bytes: artifact.bytes,
      sourceRunId: input.manifest.runId
    })
  }

  if (hydratedEntries.length > 0 && input.recordProvenance !== false) {
    input.run.state[ARTIFACT_HYDRATION_STATE_KEY] = JSON.stringify(hydrationRecord({
      manifest: input.manifest,
      entries: hydratedEntries,
      now: input.now
    }))
  }

  return { ok: !hasErrors(issues), hydratedKeys, skippedKeys, issues }
}

export function stateKeysRequiredByStep(workflow: CoreWorkflowDefinition, stepId: string): string[] {
  const step = workflow.engineSteps.find((candidate) => candidate.id === stepId)
  if (!step) throw new Error(`Workflow step not found: ${stepId}`)
  return step.stateRequired ? unique(step.includeState ?? []) : []
}

export function stateKeysRequiredBeforeStep(workflow: CoreWorkflowDefinition, stepId: string): string[] {
  const targetIndex = workflow.engineSteps.findIndex((candidate) => candidate.id === stepId)
  if (targetIndex < 0) throw new Error(`Workflow step not found: ${stepId}`)
  const keys: string[] = []
  for (let index = 0; index <= targetIndex; index += 1) {
    const step = workflow.engineSteps[index]
    if (step.stateRequired) keys.push(...(step.includeState ?? []))
  }
  return unique(keys)
}

function validateArtifactPath(artifact: WorkflowArtifactManifestEntry): WorkflowArtifactHydrationIssue | undefined {
  if (!isWorkspaceRelativePath(artifact.path)) {
    return error(`Artifact '${artifact.id}' path is not a workspace-relative safe path.`, artifact.stateKey, artifact.path)
  }
  return undefined
}

function validateArtifactContent(
  artifact: WorkflowArtifactManifestEntry,
  text: string,
  stateKey: string
): WorkflowArtifactHydrationIssue | undefined {
  const bytes = Buffer.byteLength(text, "utf8")
  if (bytes !== artifact.bytes) {
    return error(`Artifact '${artifact.id}' byte size does not match manifest.`, stateKey, artifact.path)
  }
  if (sha256Text(text) !== artifact.sha256) {
    return error(`Artifact '${artifact.id}' checksum does not match manifest.`, stateKey, artifact.path)
  }
  return undefined
}

function isWorkspaceRelativePath(value: string): boolean {
  if (!value.trim()) return false
  if (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) return false
  const normalized = value.replace(/\\/g, "/")
  if (normalized.split("/").some((segment) => segment === "..")) return false
  return true
}

function hydrationRecord(input: {
  manifest: WorkflowArtifactManifest
  entries: WorkflowArtifactHydrationEntry[]
  now?: () => string
}): WorkflowArtifactHydrationRecord {
  return {
    schemaVersion: "workflow-register/artifact-hydration/v1",
    sourceRunId: input.manifest.runId,
    sourceWorkflowId: input.manifest.workflowId,
    sourceWorkflowDefinitionHash: input.manifest.workflowDefinitionHash,
    hydratedAt: input.now?.() ?? new Date().toISOString(),
    hydrated: input.entries
  }
}

function hasErrors(issues: WorkflowArtifactHydrationIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error")
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)))
}

function error(message: string, stateKey?: string, pathValue?: string): WorkflowArtifactHydrationIssue {
  return { severity: "error", message, stateKey, path: pathValue }
}
