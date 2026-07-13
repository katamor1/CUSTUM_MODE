import { AsyncLocalStorage } from "async_hooks"
import { randomUUID } from "crypto"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import {
  createRunDurabilityFile,
  readRunDurabilityFile,
  removeRunDurabilityFile,
  replaceRunDurabilityFile
} from "./runDurabilityPath"

export const CURRENT_WORKFLOW_RUN_LOCK_SCHEMA_VERSION = "workflow-register/run-lock/v1" as const

export interface WorkflowRunLockV1 {
  schemaVersion: typeof CURRENT_WORKFLOW_RUN_LOCK_SCHEMA_VERSION
  runId: string
  token: string
  pid: number
  hostname: string
  createdAt: string
  heartbeatAt: string
}

export interface WorkflowRunLockOptions {
  timeoutMs?: number
  staleMs?: number
  heartbeatMs?: number
  pollMs?: number
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  processAlive?: (pid: number) => boolean
  hostname?: string
  token?: () => string
  onReclaimed?: (message: string) => void
}

const activeLocks = new AsyncLocalStorage<ReadonlySet<string>>()

export async function withWorkflowRunLock<T>(
  workspaceRoot: string,
  runId: string,
  operation: () => Promise<T>,
  options: WorkflowRunLockOptions = {}
): Promise<T> {
  const physicalRoot = await fs.realpath(path.resolve(workspaceRoot))
  const key = JSON.stringify([normalizePhysicalRoot(physicalRoot), runId])
  const active = activeLocks.getStore()
  if (active?.has(key)) return operation()

  const resolved = resolveOptions(options)
  const owner = await acquireWorkflowRunLock(physicalRoot, runId, resolved)
  const chain = new Set(active)
  chain.add(key)
  let heartbeatError: unknown
  let heartbeatChain: Promise<void> = Promise.resolve()
  const timer = resolved.heartbeatMs > 0
    ? setInterval(() => {
      if (heartbeatError) return
      heartbeatChain = heartbeatChain
        .then(() => refreshWorkflowRunLock(physicalRoot, runId, owner, resolved))
        .catch((error) => { heartbeatError = error })
    }, resolved.heartbeatMs)
    : undefined
  timer?.unref?.()

  let result!: T
  let operationError: unknown
  try {
    result = await activeLocks.run(chain, operation)
  } catch (error) {
    operationError = error
  } finally {
    if (timer) clearInterval(timer)
    await heartbeatChain
    await releaseWorkflowRunLock(physicalRoot, runId, owner)
  }
  if (operationError) throw operationError
  if (heartbeatError) throw heartbeatError
  return result
}

export function parseWorkflowRunLock(value: unknown, expectedRunId: string): WorkflowRunLockV1 {
  const record = requiredRecord(value, `Workflow run '${expectedRunId}' lock`)
  if (record.schemaVersion !== CURRENT_WORKFLOW_RUN_LOCK_SCHEMA_VERSION) {
    throw new Error(`Workflow run '${expectedRunId}' lock has unsupported schemaVersion '${String(record.schemaVersion)}'.`)
  }
  const runId = requiredString(record.runId, "runId", expectedRunId)
  if (runId !== expectedRunId) throw new Error(`Workflow run lock run id mismatch: expected '${expectedRunId}', got '${runId}'.`)
  const token = requiredString(record.token, "token", expectedRunId)
  const pid = requiredPositiveInteger(record.pid, "pid", expectedRunId)
  const hostname = requiredString(record.hostname, "hostname", expectedRunId)
  const createdAt = requiredTimestamp(record.createdAt, "createdAt", expectedRunId)
  const heartbeatAt = requiredTimestamp(record.heartbeatAt, "heartbeatAt", expectedRunId)
  return {
    schemaVersion: CURRENT_WORKFLOW_RUN_LOCK_SCHEMA_VERSION,
    runId,
    token,
    pid,
    hostname,
    createdAt,
    heartbeatAt
  }
}

export function serializeWorkflowRunLock(lock: WorkflowRunLockV1): string {
  return `${JSON.stringify(parseWorkflowRunLock(lock, lock.runId), null, 2)}\n`
}

interface ResolvedWorkflowRunLockOptions {
  timeoutMs: number
  staleMs: number
  heartbeatMs: number
  pollMs: number
  now: () => Date
  sleep: (ms: number) => Promise<void>
  processAlive: (pid: number) => boolean
  hostname: string
  token: () => string
  onReclaimed?: (message: string) => void
}

async function acquireWorkflowRunLock(
  workspaceRoot: string,
  runId: string,
  options: ResolvedWorkflowRunLockOptions
): Promise<WorkflowRunLockV1> {
  const startedAt = Date.now()
  while (true) {
    const now = options.now()
    const owner: WorkflowRunLockV1 = {
      schemaVersion: CURRENT_WORKFLOW_RUN_LOCK_SCHEMA_VERSION,
      runId,
      token: options.token(),
      pid: process.pid,
      hostname: options.hostname,
      createdAt: now.toISOString(),
      heartbeatAt: now.toISOString()
    }
    if (await createRunDurabilityFile(workspaceRoot, runId, "run.lock.json", serializeWorkflowRunLock(owner))) return owner

    const snapshot = await readRunDurabilityFile(workspaceRoot, runId, "run.lock.json")
    if (!snapshot) continue
    const inspection = inspectExistingLock(snapshot.bytes, snapshot.mtimeMs, runId, options)
    if (inspection.reclaim) {
      const removed = await removeRunDurabilityFile(workspaceRoot, runId, "run.lock.json", snapshot.bytes)
      if (removed) {
        try {
          options.onReclaimed?.(inspection.message)
        } catch (error) {
          console.warn("Workflow run lock reclamation callback failed.", error)
        }
        continue
      }
    }

    const elapsed = Date.now() - startedAt
    if (elapsed >= options.timeoutMs) {
      throw new Error(`Workflow run '${runId}' is busy or locked by another process. ${inspection.message}`)
    }
    await options.sleep(Math.min(options.pollMs, Math.max(1, options.timeoutMs - elapsed)))
  }
}

async function refreshWorkflowRunLock(
  workspaceRoot: string,
  runId: string,
  owner: WorkflowRunLockV1,
  options: ResolvedWorkflowRunLockOptions
): Promise<void> {
  const snapshot = await readRunDurabilityFile(workspaceRoot, runId, "run.lock.json")
  if (!snapshot) throw new Error(`Workflow run '${runId}' lock disappeared while the run was active.`)
  let current: WorkflowRunLockV1
  try {
    current = parseWorkflowRunLock(JSON.parse(snapshot.bytes.toString("utf8")), runId)
  } catch (error) {
    throw new Error(`Workflow run '${runId}' lock became invalid while the run was active: ${formatError(error)}`)
  }
  if (current.token !== owner.token) throw new Error(`Workflow run '${runId}' lock ownership changed while the run was active.`)
  const next: WorkflowRunLockV1 = { ...current, heartbeatAt: options.now().toISOString() }
  await replaceRunDurabilityFile(
    workspaceRoot,
    runId,
    "run.lock.json",
    serializeWorkflowRunLock(next),
    snapshot.bytes
  )
  owner.heartbeatAt = next.heartbeatAt
}

async function releaseWorkflowRunLock(workspaceRoot: string, runId: string, owner: WorkflowRunLockV1): Promise<boolean> {
  const snapshot = await readRunDurabilityFile(workspaceRoot, runId, "run.lock.json")
  if (!snapshot) return false
  let current: WorkflowRunLockV1
  try {
    current = parseWorkflowRunLock(JSON.parse(snapshot.bytes.toString("utf8")), runId)
  } catch {
    return false
  }
  if (current.token !== owner.token) return false
  return removeRunDurabilityFile(workspaceRoot, runId, "run.lock.json", snapshot.bytes)
}

function inspectExistingLock(
  bytes: Buffer,
  mtimeMs: number,
  runId: string,
  options: ResolvedWorkflowRunLockOptions
): { reclaim: boolean; message: string } {
  let lock: WorkflowRunLockV1
  try {
    lock = parseWorkflowRunLock(JSON.parse(bytes.toString("utf8")), runId)
  } catch (error) {
    const ageMs = Math.max(0, options.now().getTime() - mtimeMs)
    return {
      reclaim: ageMs > options.staleMs,
      message: ageMs > options.staleMs
        ? `Reclaimed malformed stale lock after ${ageMs}ms.`
        : `A malformed recent lock is present (${formatError(error)}).`
    }
  }

  if (lock.hostname === options.hostname) {
    if (options.processAlive(lock.pid)) {
      return { reclaim: false, message: `Owned by live pid ${lock.pid} on ${lock.hostname}.` }
    }
    return { reclaim: true, message: `Reclaimed lock from dead pid ${lock.pid} on ${lock.hostname}.` }
  }

  const heartbeatAgeMs = Math.max(0, options.now().getTime() - Date.parse(lock.heartbeatAt))
  return {
    reclaim: heartbeatAgeMs > options.staleMs,
    message: heartbeatAgeMs > options.staleMs
      ? `Reclaimed stale foreign-host lock from ${lock.hostname} after ${heartbeatAgeMs}ms.`
      : `Owned by ${lock.pid} on ${lock.hostname}; heartbeat age ${heartbeatAgeMs}ms.`
  }
}

function resolveOptions(options: WorkflowRunLockOptions): ResolvedWorkflowRunLockOptions {
  return {
    timeoutMs: nonNegative(options.timeoutMs, 5_000, "timeoutMs"),
    staleMs: nonNegative(options.staleMs, 30_000, "staleMs"),
    heartbeatMs: nonNegative(options.heartbeatMs, 5_000, "heartbeatMs"),
    pollMs: Math.max(1, nonNegative(options.pollMs, 25, "pollMs")),
    now: options.now ?? (() => new Date()),
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    processAlive: options.processAlive ?? defaultProcessAlive,
    hostname: options.hostname ?? os.hostname(),
    token: options.token ?? randomUUID,
    onReclaimed: options.onReclaimed
  }
}

function defaultProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === "EPERM"
  }
}

function normalizePhysicalRoot(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

function nonNegative(value: number | undefined, fallback: number, label: string): number {
  const selected = value ?? fallback
  if (!Number.isFinite(selected) || selected < 0) {
    throw new Error(`Workflow run lock option '${label}' must be a non-negative finite number.`)
  }
  return selected
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`)
  return value as Record<string, unknown>
}

function requiredString(value: unknown, field: string, runId: string): string {
  if (typeof value !== "string" || !value) throw new Error(`Workflow run '${runId}' lock field '${field}' must be a non-empty string.`)
  return value
}

function requiredPositiveInteger(value: unknown, field: string, runId: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error(`Workflow run '${runId}' lock field '${field}' must be a positive integer.`)
  }
  return Number(value)
}

function requiredTimestamp(value: unknown, field: string, runId: string): string {
  const timestamp = requiredString(value, field, runId)
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`Workflow run '${runId}' lock field '${field}' must be an ISO timestamp.`)
  }
  return timestamp
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
