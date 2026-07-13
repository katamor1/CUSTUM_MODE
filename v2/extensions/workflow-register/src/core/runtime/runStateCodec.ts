import type {
  RunStatus,
  RunStepState,
  StepRunStatus,
  WorkflowRunState,
  WorkflowStepType
} from "../model"

export const CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION = "workflow-register/run-state/v1" as const

const VERSION_PATTERN = /^workflow-register\/run-state\/v([1-9]\d*)$/
const RUN_STATUSES = new Set<RunStatus>([
  "running",
  "paused",
  "checkpoint",
  "reviewing",
  "held",
  "completed",
  "failed"
])
const STEP_STATUSES = new Set<StepRunStatus>([
  "pending",
  "running",
  "reviewing",
  "held",
  "completed",
  "failed"
])
const STEP_TYPES = new Set<WorkflowStepType>(["command", "agent", "manual", "result"])

export interface DecodedWorkflowRunState {
  run: WorkflowRunState
  sourceVersion: "unversioned" | string
  migrated: boolean
  readOnly: boolean
  diagnostics: string[]
}

export type RunStateLoadDiagnosticCode =
  | "migrated"
  | "read-only"
  | "invalid"
  | "event-log-invalid"
  | "journal-recovered"
  | "journal-conflict"
  | "lock-reclaimed"
  | "lock-busy"
  | "stale-write"

export interface RunStateLoadDiagnostic {
  runId: string
  severity: "info" | "warning" | "error"
  code: RunStateLoadDiagnosticCode
  message: string
}

export function decodeWorkflowRunState(value: unknown, expectedRunId?: string): DecodedWorkflowRunState {
  const record = workflowRunRecord(value)
  const schemaVersion = classifySchemaVersion(record.schemaVersion)
  const run = validateStableRun(record, expectedRunId)

  if (schemaVersion === "unversioned") {
    return {
      run: { ...run, schemaVersion: CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION },
      sourceVersion: "unversioned",
      migrated: true,
      readOnly: false,
      diagnostics: [`Migrated unversioned workflow run state to '${CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION}'.`]
    }
  }

  if (schemaVersion === CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION) {
    return {
      run,
      sourceVersion: schemaVersion,
      migrated: false,
      readOnly: false,
      diagnostics: []
    }
  }

  return {
    run,
    sourceVersion: schemaVersion,
    migrated: false,
    readOnly: true,
    diagnostics: [
      `Workflow run state schemaVersion ${quoted(schemaVersion)} is newer than supported '${CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION}' and was loaded read-only.`
    ]
  }
}

export function isWorkflowRunStateWritable(run: WorkflowRunState): boolean {
  return run.schemaVersion === undefined || run.schemaVersion === CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION
}

export function assertWorkflowRunStateWritable(run: WorkflowRunState): void {
  if (isWorkflowRunStateWritable(run)) return
  const schemaVersion: unknown = run.schemaVersion
  if (typeof schemaVersion !== "string") {
    throw new Error(`Workflow run '${run.runId}' has a non-string schemaVersion and cannot be written.`)
  }
  throw new Error(
    `Workflow run '${run.runId}' uses read-only schemaVersion ${quoted(schemaVersion)}; current writable version is '${CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION}'.`
  )
}

export function prepareWorkflowRunStateForWrite(run: WorkflowRunState): WorkflowRunState {
  assertWorkflowRunStateWritable(run)
  return { ...run, schemaVersion: CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION }
}

export function isCurrentWorkflowRunState(run: WorkflowRunState): boolean {
  return run.schemaVersion === CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION
}

function classifySchemaVersion(value: unknown): "unversioned" | string {
  if (value === undefined) return "unversioned"
  if (typeof value !== "string") {
    throw new Error("Workflow run field 'schemaVersion' must be a string when provided.")
  }
  if (value === CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION) return value
  const match = VERSION_PATTERN.exec(value)
  if (match && Number(match[1]) > 1) return value
  throw new Error(
    `Unsupported workflow run state schemaVersion ${quoted(value)}; current version is '${CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION}'.`
  )
}

function validateStableRun(record: Record<string, unknown>, expectedRunId?: string): WorkflowRunState {
  const runId = requiredString(record, "runId")
  if (expectedRunId !== undefined && runId !== expectedRunId) {
    throw new Error(`Workflow run id mismatch: expected '${expectedRunId}', got '${runId}'.`)
  }

  const workflowId = requiredString(record, "workflowId")
  const workflowName = requiredString(record, "workflowName")
  const statusValue = requiredString(record, "status")
  if (!RUN_STATUSES.has(statusValue as RunStatus)) {
    throw new Error(`Workflow run field 'status' has unsupported value ${quoted(statusValue)}.`)
  }

  const inputs = requiredRecord(record, "inputs")
  const state = requiredRecord(record, "state")
  for (const [key, entry] of Object.entries(state)) {
    if (typeof entry !== "string") throw new Error(`Workflow run state '${key}' must be a string.`)
  }

  const steps = validateRunSteps(record.steps)
  requiredString(record, "createdAt")
  requiredString(record, "updatedAt")

  return {
    ...record,
    runId,
    workflowId,
    workflowName,
    status: statusValue as RunStatus,
    inputs,
    state: state as Record<string, string>,
    steps
  } as WorkflowRunState
}

function validateRunSteps(value: unknown): RunStepState[] {
  if (!Array.isArray(value)) throw new Error("Workflow run field 'steps' must be an array.")
  return value.map((entry, index) => {
    const step = workflowRunRecord(entry, `Workflow run step at index ${index}`)
    const id = requiredString(step, "id", `Workflow run step at index ${index}`)
    const title = requiredString(step, "title", `Workflow run step '${id}'`)
    const type = requiredString(step, "type", `Workflow run step '${id}'`)
    const status = requiredString(step, "status", `Workflow run step '${id}'`)
    if (!STEP_TYPES.has(type as WorkflowStepType)) {
      throw new Error(`Workflow run step '${id}' field 'type' has unsupported value ${quoted(type)}.`)
    }
    if (!STEP_STATUSES.has(status as StepRunStatus)) {
      throw new Error(`Workflow run step '${id}' field 'status' has unsupported value ${quoted(status)}.`)
    }
    return { ...step, id, title, type: type as WorkflowStepType, status: status as StepRunStatus } as RunStepState
  })
}

function workflowRunRecord(value: unknown, label = "Workflow run document"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

function requiredRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key]
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Workflow run field '${key}' must be an object.`)
  }
  return value as Record<string, unknown>
}

function requiredString(record: Record<string, unknown>, key: string, label = "Workflow run"): string {
  const value = record[key]
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} field '${key}' must be a non-empty string.`)
  }
  return value
}

function quoted(value: string): string {
  const escaped = JSON.stringify(value).slice(1, -1).replace(/'/g, "\\'")
  return `'${escaped}'`
}
