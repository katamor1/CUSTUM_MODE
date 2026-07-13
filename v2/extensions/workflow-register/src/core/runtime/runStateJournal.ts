import type { WorkflowRunState } from "../model"
import {
  CURRENT_WORKFLOW_RUN_EVENT_SCHEMA_VERSION,
  appendWorkflowRunEvent,
  hashStableJson,
  hashWorkflowRunBytes,
  readWorkflowRunEventLog,
  serializeWorkflowRunState
} from "./runEventLog"
import type { WorkflowRunEventV1 } from "./runEventLog"
import {
  readRunDurabilityFile,
  removeRunDurabilityFile,
  replaceRunDurabilityFile
} from "./runDurabilityPath"

export const CURRENT_WORKFLOW_RUN_JOURNAL_SCHEMA_VERSION = "workflow-register/run-journal/v1" as const

export interface WorkflowRunJournalV1 {
  schemaVersion: typeof CURRENT_WORKFLOW_RUN_JOURNAL_SCHEMA_VERSION
  transactionId: string
  runId: string
  createdAt: string
  previousRunHash?: string
  nextRunHash: string
  previousEventHash?: string
  nextRun: WorkflowRunState
  nextEvent: WorkflowRunEventV1
}

export interface BuildWorkflowRunJournalInput {
  transactionId: string
  runId: string
  createdAt: string
  previousRunHash?: string
  previousEventHash?: string
  nextRun: WorkflowRunState
  nextEvent: WorkflowRunEventV1
}

export interface RecoverWorkflowRunJournalInput {
  workspaceRoot: string
  runId: string
  readRunBytes: () => Promise<Buffer | undefined>
  writeRunText: (content: string) => Promise<void>
  syncRunFile?: () => Promise<void>
}

export interface JournalRecoveryResult {
  recovered: boolean
  wroteRun: boolean
  appendedEvent: boolean
  journal?: WorkflowRunJournalV1
}

export function buildWorkflowRunJournal(input: BuildWorkflowRunJournalInput): WorkflowRunJournalV1 {
  const journal: WorkflowRunJournalV1 = {
    schemaVersion: CURRENT_WORKFLOW_RUN_JOURNAL_SCHEMA_VERSION,
    transactionId: input.transactionId,
    runId: input.runId,
    createdAt: input.createdAt,
    previousRunHash: input.previousRunHash,
    nextRunHash: hashWorkflowRunBytes(serializeWorkflowRunState(input.nextRun)),
    previousEventHash: input.previousEventHash,
    nextRun: structuredClone(input.nextRun),
    nextEvent: structuredClone(input.nextEvent)
  }
  return parseWorkflowRunJournal(journal, input.runId)
}

export function parseWorkflowRunJournal(value: unknown, expectedRunId: string): WorkflowRunJournalV1 {
  const record = requiredRecord(value, `Workflow run '${expectedRunId}' journal`)
  if (record.schemaVersion !== CURRENT_WORKFLOW_RUN_JOURNAL_SCHEMA_VERSION) {
    throw new Error(`Workflow run '${expectedRunId}' journal has unsupported schemaVersion '${String(record.schemaVersion)}'.`)
  }
  const transactionId = requiredString(record.transactionId, "transactionId", expectedRunId)
  const runId = requiredString(record.runId, "runId", expectedRunId)
  if (runId !== expectedRunId) throw new Error(`Workflow run journal run id mismatch: expected '${expectedRunId}', got '${runId}'.`)
  const createdAt = requiredString(record.createdAt, "createdAt", expectedRunId)
  const previousRunHash = optionalString(record.previousRunHash, "previousRunHash", expectedRunId)
  const nextRunHash = requiredString(record.nextRunHash, "nextRunHash", expectedRunId)
  const previousEventHash = optionalString(record.previousEventHash, "previousEventHash", expectedRunId)
  const nextRun = requiredRecord(record.nextRun, `Workflow run '${expectedRunId}' journal nextRun`) as unknown as WorkflowRunState
  if (nextRun.runId !== expectedRunId) throw new Error(`Workflow run '${expectedRunId}' journal next run id does not match.`)
  const calculatedNextRunHash = hashWorkflowRunBytes(serializeWorkflowRunState(nextRun))
  if (calculatedNextRunHash !== nextRunHash) throw new Error(`Workflow run '${expectedRunId}' journal nextRunHash does not match nextRun.`)
  const nextEvent = validateJournalEvent(record.nextEvent, expectedRunId, previousEventHash, nextRunHash)
  return {
    schemaVersion: CURRENT_WORKFLOW_RUN_JOURNAL_SCHEMA_VERSION,
    transactionId,
    runId,
    createdAt,
    previousRunHash,
    nextRunHash,
    previousEventHash,
    nextRun,
    nextEvent
  }
}

export async function readWorkflowRunJournal(workspaceRoot: string, runId: string): Promise<WorkflowRunJournalV1 | undefined> {
  const snapshot = await readRunDurabilityFile(workspaceRoot, runId, "run-state.journal.json")
  if (!snapshot) return undefined
  let value: unknown
  try {
    value = JSON.parse(snapshot.bytes.toString("utf8"))
  } catch (error) {
    throw new Error(`Workflow run '${runId}' journal contains invalid JSON: ${formatError(error)}`)
  }
  return parseWorkflowRunJournal(value, runId)
}

export async function writeWorkflowRunJournal(workspaceRoot: string, runId: string, journal: WorkflowRunJournalV1): Promise<void> {
  const validated = parseWorkflowRunJournal(journal, runId)
  await replaceRunDurabilityFile(workspaceRoot, runId, "run-state.journal.json", serializeWorkflowRunJournal(validated))
}

export async function removeWorkflowRunJournal(workspaceRoot: string, runId: string, expectedBytes?: Buffer): Promise<boolean> {
  return removeRunDurabilityFile(workspaceRoot, runId, "run-state.journal.json", expectedBytes)
}

export async function recoverWorkflowRunJournal(input: RecoverWorkflowRunJournalInput): Promise<JournalRecoveryResult> {
  const snapshot = await readRunDurabilityFile(input.workspaceRoot, input.runId, "run-state.journal.json")
  if (!snapshot) return { recovered: false, wroteRun: false, appendedEvent: false }
  let value: unknown
  try {
    value = JSON.parse(snapshot.bytes.toString("utf8"))
  } catch (error) {
    throw new Error(`Workflow run '${input.runId}' journal contains invalid JSON: ${formatError(error)}`)
  }
  const journal = parseWorkflowRunJournal(value, input.runId)
  const currentBytes = await input.readRunBytes()
  const currentHash = currentBytes ? hashWorkflowRunBytes(currentBytes) : undefined
  let wroteRun = false
  if (currentHash === journal.previousRunHash) {
    await input.writeRunText(serializeWorkflowRunState(journal.nextRun))
    await input.syncRunFile?.()
    wroteRun = true
  } else if (currentHash !== journal.nextRunHash) {
    throw new Error(`Workflow run '${input.runId}' journal materialized run hash conflict.`)
  }

  const eventState = await readWorkflowRunEventLog(input.workspaceRoot, input.runId)
  const currentEventHash = eventState.head?.hash
  let appendedEvent = false
  if (currentEventHash === journal.previousEventHash) {
    await appendWorkflowRunEvent(input.workspaceRoot, input.runId, journal.nextEvent)
    appendedEvent = true
  } else if (currentEventHash !== journal.nextEvent.hash) {
    throw new Error(`Workflow run '${input.runId}' journal event head conflict.`)
  }

  const removed = await removeWorkflowRunJournal(input.workspaceRoot, input.runId, snapshot.bytes)
  if (!removed) throw new Error(`Workflow run '${input.runId}' journal changed before recovery cleanup.`)
  return { recovered: true, wroteRun, appendedEvent, journal }
}

export function serializeWorkflowRunJournal(journal: WorkflowRunJournalV1): string {
  return `${JSON.stringify(journal, null, 2)}\n`
}

function validateJournalEvent(
  value: unknown,
  expectedRunId: string,
  previousEventHash: string | undefined,
  nextRunHash: string
): WorkflowRunEventV1 {
  const record = requiredRecord(value, `Workflow run '${expectedRunId}' journal nextEvent`)
  if (record.schemaVersion !== CURRENT_WORKFLOW_RUN_EVENT_SCHEMA_VERSION) {
    throw new Error(`Workflow run '${expectedRunId}' journal nextEvent has unsupported schemaVersion '${String(record.schemaVersion)}'.`)
  }
  const sequence = requiredPositiveInteger(record.sequence, "sequence", expectedRunId)
  const eventId = requiredString(record.eventId, "eventId", expectedRunId)
  const runId = requiredString(record.runId, "runId", expectedRunId)
  if (runId !== expectedRunId) throw new Error(`Workflow run '${expectedRunId}' journal nextEvent run id does not match.`)
  const kind = requiredString(record.kind, "kind", expectedRunId)
  if (!["run.created", "run.updated", "run.migrated", "run.recovered"].includes(kind)) {
    throw new Error(`Workflow run '${expectedRunId}' journal nextEvent has unsupported kind '${kind}'.`)
  }
  const occurredAt = requiredString(record.occurredAt, "occurredAt", expectedRunId)
  const eventPreviousHash = optionalString(record.previousEventHash, "previousEventHash", expectedRunId)
  if (eventPreviousHash !== previousEventHash) {
    throw new Error(`Workflow run '${expectedRunId}' journal nextEvent previousEventHash does not match the journal.`)
  }
  const previousRunHash = optionalString(record.previousRunHash, "previousRunHash", expectedRunId)
  const runHash = requiredString(record.runHash, "runHash", expectedRunId)
  if (runHash !== nextRunHash) throw new Error(`Workflow run '${expectedRunId}' journal nextEvent runHash does not match nextRunHash.`)
  const snapshot = requiredRecord(record.snapshot, `Workflow run '${expectedRunId}' journal nextEvent snapshot`) as unknown as WorkflowRunState
  if (snapshot.runId !== expectedRunId) throw new Error(`Workflow run '${expectedRunId}' journal nextEvent snapshot run id does not match.`)
  if (hashWorkflowRunBytes(serializeWorkflowRunState(snapshot)) !== nextRunHash) {
    throw new Error(`Workflow run '${expectedRunId}' journal nextEvent snapshot does not match nextRunHash.`)
  }
  const hash = requiredString(record.hash, "hash", expectedRunId)
  const withoutHash = {
    schemaVersion: CURRENT_WORKFLOW_RUN_EVENT_SCHEMA_VERSION,
    sequence,
    eventId,
    runId,
    kind: kind as WorkflowRunEventV1["kind"],
    occurredAt,
    previousEventHash: eventPreviousHash,
    previousRunHash,
    runHash,
    snapshot
  }
  if (hashStableJson(withoutHash) !== hash) throw new Error(`Workflow run '${expectedRunId}' journal nextEvent hash is invalid.`)
  return { ...withoutHash, hash }
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`)
  return value as Record<string, unknown>
}

function requiredString(value: unknown, field: string, runId: string): string {
  if (typeof value !== "string" || !value) throw new Error(`Workflow run '${runId}' journal field '${field}' must be a non-empty string.`)
  return value
}

function optionalString(value: unknown, field: string, runId: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string" || !value) {
    throw new Error(`Workflow run '${runId}' journal field '${field}' must be a non-empty string when provided.`)
  }
  return value
}

function requiredPositiveInteger(value: unknown, field: string, runId: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error(`Workflow run '${runId}' journal field '${field}' must be a positive integer.`)
  }
  return Number(value)
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
