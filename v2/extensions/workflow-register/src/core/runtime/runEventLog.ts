import { createHash, randomUUID } from "crypto"
import type { WorkflowRunState } from "../model"
import { decodeWorkflowRunState, isCurrentWorkflowRunState } from "./runStateCodec"
import { appendRunDurabilityFile, readRunDurabilityFile } from "./runDurabilityPath"

export const CURRENT_WORKFLOW_RUN_EVENT_SCHEMA_VERSION = "workflow-register/run-event/v1" as const

export type WorkflowRunEventKind = "run.created" | "run.updated" | "run.migrated" | "run.recovered"

export interface WorkflowRunEventV1 {
  schemaVersion: typeof CURRENT_WORKFLOW_RUN_EVENT_SCHEMA_VERSION
  sequence: number
  eventId: string
  runId: string
  kind: WorkflowRunEventKind
  occurredAt: string
  previousEventHash?: string
  previousRunHash?: string
  runHash: string
  snapshot: WorkflowRunState
  hash: string
}

export interface WorkflowRunEventLogState {
  events: WorkflowRunEventV1[]
  head?: WorkflowRunEventV1
}

export interface BuildWorkflowRunEventInput {
  run: WorkflowRunState
  kind: WorkflowRunEventKind
  occurredAt: string
  previousEvent?: WorkflowRunEventV1
  previousRunHash?: string
  eventId?: string
}

export function buildWorkflowRunEvent(input: BuildWorkflowRunEventInput): WorkflowRunEventV1 {
  const snapshot = structuredClone(input.run)
  const eventWithoutHash = {
    schemaVersion: CURRENT_WORKFLOW_RUN_EVENT_SCHEMA_VERSION,
    sequence: (input.previousEvent?.sequence ?? 0) + 1,
    eventId: input.eventId ?? randomUUID(),
    runId: snapshot.runId,
    kind: input.kind,
    occurredAt: input.occurredAt,
    previousEventHash: input.previousEvent?.hash,
    previousRunHash: input.previousRunHash,
    runHash: hashWorkflowRunBytes(serializeWorkflowRunState(snapshot)),
    snapshot
  }
  return { ...eventWithoutHash, hash: hashStableJson(eventWithoutHash) }
}

export function parseWorkflowRunEventLog(text: string, expectedRunId: string): WorkflowRunEventLogState {
  if (!text) return { events: [] }
  if (!text.endsWith("\n")) throw new Error(`Workflow run '${expectedRunId}' event log is truncated or missing its final newline.`)
  const rawLines = text.slice(0, -1).split("\n")
  const events: WorkflowRunEventV1[] = []
  const ids = new Set<string>()
  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index]
    if (!line) throw new Error(`Workflow run '${expectedRunId}' event log contains a blank line at ${index + 1}.`)
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch (error) {
      throw new Error(`Workflow run '${expectedRunId}' event log line ${index + 1} is invalid JSON: ${formatError(error)}`)
    }
    const event = parseWorkflowRunEvent(value, expectedRunId, index + 1, events[index - 1])
    if (ids.has(event.eventId)) throw new Error(`Workflow run '${expectedRunId}' event log has duplicate event id '${event.eventId}'.`)
    ids.add(event.eventId)
    events.push(event)
  }
  return { events, head: events.at(-1) }
}

export async function readWorkflowRunEventLog(workspaceRoot: string, runId: string): Promise<WorkflowRunEventLogState> {
  const snapshot = await readRunDurabilityFile(workspaceRoot, runId, "events.ndjson")
  return parseWorkflowRunEventLog(snapshot?.bytes.toString("utf8") ?? "", runId)
}

export async function appendWorkflowRunEvent(workspaceRoot: string, runId: string, event: WorkflowRunEventV1): Promise<void> {
  const state = await readWorkflowRunEventLog(workspaceRoot, runId)
  if (state.head?.hash === event.hash) return
  const parsed = parseWorkflowRunEvent(event, runId, state.events.length + 1, state.head)
  await appendRunDurabilityFile(workspaceRoot, runId, "events.ndjson", `${JSON.stringify(parsed)}\n`)
}

export function serializeWorkflowRunState(run: WorkflowRunState): string {
  return `${JSON.stringify(run, null, 2)}\n`
}

export function hashWorkflowRunBytes(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

export function hashStableJson(value: unknown): string {
  return hashWorkflowRunBytes(JSON.stringify(canonicalJson(value)))
}

function parseWorkflowRunEvent(
  value: unknown,
  expectedRunId: string,
  expectedSequence: number,
  previous?: WorkflowRunEventV1
): WorkflowRunEventV1 {
  const record = requiredRecord(value, `Workflow run '${expectedRunId}' event ${expectedSequence}`)
  if (record.schemaVersion !== CURRENT_WORKFLOW_RUN_EVENT_SCHEMA_VERSION) {
    throw new Error(`Workflow run '${expectedRunId}' event ${expectedSequence} has unsupported schemaVersion '${String(record.schemaVersion)}'.`)
  }
  const sequence = requiredPositiveInteger(record.sequence, "sequence", expectedRunId)
  if (sequence !== expectedSequence) {
    throw new Error(`Workflow run '${expectedRunId}' event sequence ${sequence} does not match expected ${expectedSequence}.`)
  }
  const eventId = requiredString(record.eventId, "eventId", expectedRunId)
  const runId = requiredString(record.runId, "runId", expectedRunId)
  if (runId !== expectedRunId) throw new Error(`Workflow run event run id mismatch: expected '${expectedRunId}', got '${runId}'.`)
  const kind = requiredString(record.kind, "kind", expectedRunId)
  if (!["run.created", "run.updated", "run.migrated", "run.recovered"].includes(kind)) {
    throw new Error(`Workflow run '${expectedRunId}' event ${sequence} has unsupported kind '${kind}'.`)
  }
  const occurredAt = requiredTimestamp(record.occurredAt, "occurredAt", expectedRunId)
  const previousEventHash = optionalString(record.previousEventHash, "previousEventHash", expectedRunId)
  const expectedPreviousHash = previous?.hash
  if (previousEventHash !== expectedPreviousHash) {
    throw new Error(`Workflow run '${expectedRunId}' event ${sequence} previous event hash does not match the event log head.`)
  }
  const previousRunHash = optionalString(record.previousRunHash, "previousRunHash", expectedRunId)
  if (previous && previousRunHash !== previous.runHash) {
    throw new Error(`Workflow run '${expectedRunId}' event ${sequence} previous run hash does not match the prior snapshot.`)
  }
  const runHash = requiredString(record.runHash, "runHash", expectedRunId)
  const decodedSnapshot = decodeWorkflowRunState(record.snapshot, expectedRunId)
  if (!isCurrentWorkflowRunState(decodedSnapshot.run) || decodedSnapshot.migrated || decodedSnapshot.readOnly) {
    throw new Error(`Workflow run '${expectedRunId}' event ${sequence} snapshot must use the current writable run-state schema.`)
  }
  const snapshot = decodedSnapshot.run
  const calculatedRunHash = hashWorkflowRunBytes(serializeWorkflowRunState(snapshot))
  if (runHash !== calculatedRunHash) throw new Error(`Workflow run '${expectedRunId}' event ${sequence} runHash does not match its snapshot.`)
  const hash = requiredString(record.hash, "hash", expectedRunId)
  const withoutHash = {
    schemaVersion: CURRENT_WORKFLOW_RUN_EVENT_SCHEMA_VERSION,
    sequence,
    eventId,
    runId,
    kind: kind as WorkflowRunEventKind,
    occurredAt,
    previousEventHash,
    previousRunHash,
    runHash,
    snapshot
  }
  const calculatedHash = hashStableJson(withoutHash)
  if (hash !== calculatedHash) throw new Error(`Workflow run '${expectedRunId}' event ${sequence} event hash is invalid.`)
  return { ...withoutHash, hash }
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

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`)
  return value as Record<string, unknown>
}

function requiredString(value: unknown, field: string, runId: string): string {
  if (typeof value !== "string" || !value) throw new Error(`Workflow run '${runId}' event field '${field}' must be a non-empty string.`)
  return value
}

function requiredTimestamp(value: unknown, field: string, runId: string): string {
  const timestamp = requiredString(value, field, runId)
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`Workflow run '${runId}' event field '${field}' must be an ISO timestamp.`)
  }
  return timestamp
}

function optionalString(value: unknown, field: string, runId: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string" || !value) {
    throw new Error(`Workflow run '${runId}' event field '${field}' must be a non-empty string when provided.`)
  }
  return value
}

function requiredPositiveInteger(value: unknown, field: string, runId: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error(`Workflow run '${runId}' event field '${field}' must be a positive integer.`)
  }
  return Number(value)
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
