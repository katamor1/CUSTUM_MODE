import { createHash } from "crypto"
import type {
  CoreWorkflowDefinition,
  EngineStep,
  WorkflowArtifactDefinition,
  WorkflowRunState
} from "../model"

export const ARTIFACT_MANIFEST_STATE_KEY = "workflow.artifactManifest"
export const ARTIFACT_MANIFEST_PATH = ".bob/workflows/runs/{{run.id}}/artifacts/manifest.json"

export type WorkflowArtifactManifestEntrySource = "workflow-artifact" | "provider-artifact" | "task-snapshot" | "imported-artifact"

export interface WorkflowArtifactManifestEntry {
  id: string
  stateKey: string
  producedBy: string
  path: string
  schema?: string
  sha256: string
  bytes: number
  source: WorkflowArtifactManifestEntrySource
  updatedAt: string
}

export interface WorkflowArtifactManifest {
  schemaVersion: "workflow-register/artifact-manifest/v1"
  workflowId: string
  logicalWorkflowId?: string
  workflowDefinitionHash?: string
  workflowFile?: string
  runId: string
  inputsHash: string
  createdAt: string
  updatedAt: string
  artifacts: WorkflowArtifactManifestEntry[]
}

export interface WorkflowArtifactManifestIssue {
  severity: "error" | "warning"
  message: string
}

export function createWorkflowArtifactManifestEntry(input: {
  artifact: WorkflowArtifactDefinition
  step: EngineStep
  path: string
  text: string | Buffer
  now?: () => string
  source?: WorkflowArtifactManifestEntrySource
}): WorkflowArtifactManifestEntry {
  return {
    id: input.artifact.id,
    stateKey: input.artifact.id,
    producedBy: input.step.id,
    path: input.path,
    schema: input.artifact.schema,
    sha256: createHash("sha256").update(input.text).digest("hex"),
    bytes: typeof input.text === "string" ? Buffer.byteLength(input.text, "utf8") : input.text.byteLength,
    source: input.source ?? "workflow-artifact",
    updatedAt: input.now?.() ?? new Date().toISOString()
  }
}

export function buildWorkflowArtifactManifest(input: {
  workflow: CoreWorkflowDefinition
  run: WorkflowRunState
  entries: WorkflowArtifactManifestEntry[]
  now?: () => string
}): WorkflowArtifactManifest {
  const now = input.now?.() ?? new Date().toISOString()
  const current = parseWorkflowArtifactManifest(input.run.state[ARTIFACT_MANIFEST_STATE_KEY])
  const artifacts = new Map<string, WorkflowArtifactManifestEntry>()
  for (const entry of current?.artifacts ?? []) artifacts.set(artifactManifestEntryKey(entry), entry)
  for (const entry of input.entries) artifacts.set(artifactManifestEntryKey(entry), entry)
  const manifest: WorkflowArtifactManifest = {
    schemaVersion: "workflow-register/artifact-manifest/v1",
    workflowId: input.workflow.id,
    logicalWorkflowId: input.workflow.logicalWorkflowId,
    workflowDefinitionHash: input.workflow.definitionHash,
    workflowFile: input.workflow.filePath,
    runId: input.run.runId,
    inputsHash: workflowInputsHash(input.run.inputs),
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    artifacts: Array.from(artifacts.values()).sort((left, right) => {
      const byStep = left.producedBy.localeCompare(right.producedBy)
      return byStep !== 0 ? byStep : left.id.localeCompare(right.id)
    })
  }
  return manifest
}

export function commitWorkflowArtifactManifest(
  run: WorkflowRunState,
  manifest: WorkflowArtifactManifest
): void {
  run.state[ARTIFACT_MANIFEST_STATE_KEY] = serializeWorkflowArtifactManifest(manifest)
}

// Preserve the original public helper while transactional callers use the
// explicit build/write/commit sequence above.
export function updateWorkflowArtifactManifest(
  input: Parameters<typeof buildWorkflowArtifactManifest>[0]
): WorkflowArtifactManifest {
  const manifest = buildWorkflowArtifactManifest(input)
  commitWorkflowArtifactManifest(input.run, manifest)
  return manifest
}

export function parseWorkflowArtifactManifest(value: unknown): WorkflowArtifactManifest | undefined {
  if (typeof value !== "string") return undefined
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
    const record = parsed as Partial<WorkflowArtifactManifest>
    if (record.schemaVersion !== "workflow-register/artifact-manifest/v1") return undefined
    if (typeof record.workflowId !== "string" || typeof record.runId !== "string") return undefined
    if (typeof record.inputsHash !== "string" || !Array.isArray(record.artifacts)) return undefined
    return {
      schemaVersion: "workflow-register/artifact-manifest/v1",
      workflowId: record.workflowId,
      logicalWorkflowId: typeof record.logicalWorkflowId === "string" ? record.logicalWorkflowId : undefined,
      workflowDefinitionHash: typeof record.workflowDefinitionHash === "string" ? record.workflowDefinitionHash : undefined,
      workflowFile: typeof record.workflowFile === "string" ? record.workflowFile : undefined,
      runId: record.runId,
      inputsHash: record.inputsHash,
      createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
      artifacts: record.artifacts.map(normalizeManifestEntry).filter((entry): entry is WorkflowArtifactManifestEntry => Boolean(entry))
    }
  } catch {
    return undefined
  }
}

export function serializeWorkflowArtifactManifest(manifest: WorkflowArtifactManifest): string {
  return JSON.stringify(manifest)
}

export function validateWorkflowArtifactManifest(input: {
  manifest: WorkflowArtifactManifest
  workflow: CoreWorkflowDefinition
  inputs: Record<string, unknown>
  allowDefinitionMismatch?: boolean
  allowInputMismatch?: boolean
}): WorkflowArtifactManifestIssue[] {
  const issues: WorkflowArtifactManifestIssue[] = []
  if (input.manifest.workflowId !== input.workflow.id) {
    issues.push(error(`Artifact manifest workflowId '${input.manifest.workflowId}' does not match workflow '${input.workflow.id}'.`))
  }
  if (
    !input.allowDefinitionMismatch &&
    input.manifest.workflowDefinitionHash &&
    input.workflow.definitionHash &&
    input.manifest.workflowDefinitionHash !== input.workflow.definitionHash
  ) {
    issues.push(error("Artifact manifest workflowDefinitionHash does not match the current workflow definition."))
  }
  const expectedInputsHash = workflowInputsHash(input.inputs)
  if (!input.allowInputMismatch && input.manifest.inputsHash !== expectedInputsHash) {
    issues.push(error("Artifact manifest inputsHash does not match the target run inputs."))
  }
  if (input.manifest.artifacts.length === 0) issues.push(warning("Artifact manifest contains no artifacts."))
  return issues
}

export function findArtifactForStateKey(
  manifest: WorkflowArtifactManifest,
  stateKey: string
): WorkflowArtifactManifestEntry | undefined {
  for (let index = manifest.artifacts.length - 1; index >= 0; index -= 1) {
    const entry = manifest.artifacts[index]
    if (entry.stateKey === stateKey || entry.id === stateKey) return entry
  }
  return undefined
}

export function artifactManifestEntryKey(entry: Pick<WorkflowArtifactManifestEntry, "producedBy" | "id">): string {
  return `${entry.producedBy}\u0000${entry.id}`
}

export function workflowInputsHash(inputs: Record<string, unknown>): string {
  return `sha256:${sha256Text(stableJson(inputs))}`
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalJson(value))
}

function normalizeManifestEntry(value: unknown): WorkflowArtifactManifestEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Partial<WorkflowArtifactManifestEntry>
  if (
    typeof record.id !== "string" ||
    typeof record.producedBy !== "string" ||
    typeof record.path !== "string" ||
    typeof record.sha256 !== "string" ||
    typeof record.bytes !== "number"
  ) return undefined
  return {
    id: record.id,
    stateKey: typeof record.stateKey === "string" ? record.stateKey : record.id,
    producedBy: record.producedBy,
    path: record.path,
    schema: typeof record.schema === "string" ? record.schema : undefined,
    sha256: record.sha256,
    bytes: record.bytes,
    source: record.source ?? "workflow-artifact",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : ""
  }
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => [key, canonicalJson((value as Record<string, unknown>)[key])])
  )
}

function error(message: string): WorkflowArtifactManifestIssue {
  return { severity: "error", message }
}

function warning(message: string): WorkflowArtifactManifestIssue {
  return { severity: "warning", message }
}
