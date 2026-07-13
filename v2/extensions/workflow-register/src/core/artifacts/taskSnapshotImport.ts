import type {
  CoreWorkflowDefinition,
  EngineStep,
  WorkflowArtifactDefinition,
  WorkflowRunState
} from "../model"
import type { TaskSnapshotPayload, TaskSnapshotStore } from "../taskSnapshots"
import { snapshotMatchesRun } from "../taskSnapshots"
import { renderArtifactPath } from "../engine/templateRenderer"
import type { WorkspaceFileTransactionWrite } from "../runtime/workspaceFileTransaction"
import {
  ARTIFACT_MANIFEST_PATH,
  buildWorkflowArtifactManifest,
  commitWorkflowArtifactManifest,
  createWorkflowArtifactManifestEntry,
  type WorkflowArtifactManifest,
  type WorkflowArtifactManifestEntry
} from "./artifactManifest"

export const TASK_SNAPSHOT_IMPORT_STATE_KEY = "workflow.taskSnapshotImport"

export interface TaskSnapshotArtifactImportRecord {
  schemaVersion: "workflow-register/task-snapshot-import/v1"
  sourceRunId: string
  importedAt: string
  imported: TaskSnapshotArtifactImportEntry[]
}

export interface TaskSnapshotArtifactImportEntry {
  artifactId: string
  stateKey: string
  producedBy: string
  snapshotReason: string
  snapshotCreatedAt: string
  path: string
  sha256: string
  bytes: number
}

export interface TaskSnapshotArtifactImportIssue {
  severity: "error" | "warning" | "info"
  message: string
  artifactId?: string
  stepId?: string
}

export interface TaskSnapshotArtifactImportResult {
  ok: boolean
  importedCount: number
  manifest?: WorkflowArtifactManifest
  issues: TaskSnapshotArtifactImportIssue[]
}

export interface ImportArtifactsFromTaskSnapshotsInput {
  workflow: CoreWorkflowDefinition
  run: WorkflowRunState
  snapshotStore: TaskSnapshotStore
  writeFiles: (
    writes: WorkspaceFileTransactionWrite[],
    commitState: () => Promise<void> | void
  ) => Promise<void> | void
  persistStateRollback?: () => Promise<void> | void
  now?: () => string
  overwrite?: boolean
}

export async function importArtifactsFromTaskSnapshots(
  input: ImportArtifactsFromTaskSnapshotsInput
): Promise<TaskSnapshotArtifactImportResult> {
  const issues: TaskSnapshotArtifactImportIssue[] = []
  const entries: WorkflowArtifactManifestEntry[] = []
  const imported: TaskSnapshotArtifactImportEntry[] = []
  const stateUpdates: Record<string, string> = {}
  const fileWrites: WorkspaceFileTransactionWrite[] = []
  const artifactCandidates = (input.workflow.artifacts ?? []).filter((artifact) => artifact.producedBy)
  if (artifactCandidates.length === 0) {
    return { ok: false, importedCount: 0, issues: [warning("Workflow has no produced artifacts to import from task snapshots.")] }
  }

  for (const artifact of artifactCandidates) {
    const step = input.workflow.engineSteps.find((candidate) => candidate.id === artifact.producedBy)
    if (!step) {
      issues.push(warning(`Artifact '${artifact.id}' references unknown producing step '${artifact.producedBy}'.`, artifact.id, artifact.producedBy))
      continue
    }
    const stateKey = outputStateKeyForArtifact(step, artifact)
    if (!stateKey) {
      issues.push(warning(`Artifact '${artifact.id}' is not tied to an output state key for step '${step.id}'.`, artifact.id, step.id))
      continue
    }
    if (!input.overwrite && input.run.state[stateKey] !== undefined) {
      issues.push(info(`State key '${stateKey}' already exists; task snapshot import skipped.`, artifact.id, step.id))
      continue
    }
    const snapshot = await input.snapshotStore.findLatestSnapshot(input.run.runId, (candidate) => (
      snapshotMatchesRun(candidate, input.workflow, input.run, step) && Boolean(snapshotText(candidate)?.trim())
    ))
    if (!snapshot) {
      issues.push(warning(`No task snapshot text found for artifact '${artifact.id}' from step '${step.id}'.`, artifact.id, step.id))
      continue
    }
    const text = snapshotText(snapshot)
    if (!text?.trim()) {
      issues.push(warning(`Task snapshot for artifact '${artifact.id}' has no importable text.`, artifact.id, step.id))
      continue
    }
    const renderedPath = renderArtifactPath(artifact, {
      inputs: input.run.inputs,
      state: { ...input.run.state, ...stateUpdates },
      run: input.run,
      workflow: input.workflow,
      step
    })
    if (renderedPath.includes("{{")) {
      issues.push(error(`Artifact '${artifact.id}' path still contains unresolved template placeholders.`, artifact.id, step.id))
      continue
    }
    if (!isWorkspaceRelativePath(renderedPath)) {
      issues.push(error(`Artifact '${artifact.id}' path is not a workspace-relative safe path.`, artifact.id, step.id))
      continue
    }
    fileWrites.push({ relativePath: renderedPath, text, encoding: "utf8" })
    stateUpdates[stateKey] = text
    const entry = createWorkflowArtifactManifestEntry({
      artifact,
      step,
      path: renderedPath,
      text,
      source: "task-snapshot",
      now: input.now
    })
    entries.push(entry)
    imported.push({
      artifactId: entry.id,
      stateKey,
      producedBy: entry.producedBy,
      snapshotReason: snapshot.reason,
      snapshotCreatedAt: snapshot.createdAt,
      path: entry.path,
      sha256: entry.sha256,
      bytes: entry.bytes
    })
  }

  if (entries.length === 0) return { ok: false, importedCount: 0, issues }
  const manifest = buildWorkflowArtifactManifest({ workflow: input.workflow, run: input.run, entries, now: input.now })
  const importState = JSON.stringify({
    schemaVersion: "workflow-register/task-snapshot-import/v1",
    sourceRunId: input.run.runId,
    importedAt: input.now?.() ?? new Date().toISOString(),
    imported
  } satisfies TaskSnapshotArtifactImportRecord)
  fileWrites.push({
    relativePath: ARTIFACT_MANIFEST_PATH.replace(/\{\{\s*run\.id\s*\}\}/g, input.run.runId),
    text: `${JSON.stringify(manifest, null, 2)}\n`,
    encoding: "utf8"
  })
  const stateBeforeCommit = { ...input.run.state }
  let stateCommitted = false
  try {
    await Promise.resolve(input.writeFiles(fileWrites, () => {
      Object.assign(input.run.state, stateUpdates)
      commitWorkflowArtifactManifest(input.run, manifest)
      input.run.state[TASK_SNAPSHOT_IMPORT_STATE_KEY] = importState
      stateCommitted = true
    }))
    if (!stateCommitted) throw new Error("Task snapshot file transaction did not commit run state.")
  } catch (error) {
    replaceRunState(input.run, stateBeforeCommit)
    if (stateCommitted && input.persistStateRollback) {
      try {
        await Promise.resolve(input.persistStateRollback())
      } catch (rollbackError) {
        const message = error instanceof Error ? error.message : String(error)
        const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
        throw new Error(`${message}; durable state rollback failed: ${rollbackMessage}`, { cause: error })
      }
    }
    throw error
  }
  return { ok: true, importedCount: entries.length, manifest, issues }
}

export function snapshotText(snapshot: TaskSnapshotPayload): string | undefined {
  if (snapshot.lastAssistantText?.trim()) return snapshot.lastAssistantText
  const exported = textFromTaskExport(snapshot.taskExport)
  return exported?.trim() ? exported : undefined
}

function outputStateKeyForArtifact(step: EngineStep, artifact: WorkflowArtifactDefinition): string | undefined {
  if (step.type === "manual") {
    if (step.form?.resultKey === artifact.id) return step.form.resultKey
    if (step.approval?.resultKey === artifact.id) return step.approval.resultKey
    return undefined
  }
  if ("resultKey" in step && step.resultKey === artifact.id) return step.resultKey
  if (step.type === "result" && step.result.source === "state" && step.result.stateKey === artifact.id) return step.result.stateKey
  return undefined
}

function textFromTaskExport(value: unknown, depth = 0): string | undefined {
  if (typeof value === "string") return value
  if (!value || typeof value !== "object" || depth > 6) return undefined
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const found = textFromTaskExport(value[index], depth + 1)
      if (found?.trim()) return found
    }
    return undefined
  }
  const record = value as Record<string, unknown>
  for (const key of ["result", "jsonText", "artifactText", "resultText", "text", "content", "output", "message", "lastAssistantText"]) {
    const found = textFromTaskExport(record[key], depth + 1)
    if (found?.trim()) return found
  }
  return undefined
}

function isWorkspaceRelativePath(value: string): boolean {
  if (!value.trim()) return false
  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("/") || value.startsWith("\\\\")) return false
  const normalized = value.replace(/\\/g, "/")
  if (normalized.split("/").some((segment) => segment === "..")) return false
  return true
}

function error(message: string, artifactId?: string, stepId?: string): TaskSnapshotArtifactImportIssue {
  return { severity: "error", message, artifactId, stepId }
}

function warning(message: string, artifactId?: string, stepId?: string): TaskSnapshotArtifactImportIssue {
  return { severity: "warning", message, artifactId, stepId }
}

function info(message: string, artifactId?: string, stepId?: string): TaskSnapshotArtifactImportIssue {
  return { severity: "info", message, artifactId, stepId }
}

function replaceRunState(run: WorkflowRunState, state: Record<string, string>): void {
  for (const key of Object.keys(run.state)) delete run.state[key]
  Object.assign(run.state, state)
}
