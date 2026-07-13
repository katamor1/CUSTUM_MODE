import { randomUUID } from "crypto"
import type { CoreWorkflowDefinition, WorkflowRunState } from "../model"
import { normalizeWorkspaceRootIdentity } from "../../workspaceRootIdentity"
import {
  CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION,
  assertWorkflowRunStateWritable,
  decodeWorkflowRunState,
  isCurrentWorkflowRunState,
  prepareWorkflowRunStateForWrite
} from "./runStateCodec"
import type { RunStateLoadDiagnostic, RunStateLoadDiagnosticCode } from "./runStateCodec"
import { ensureContainedRunStateMigrationBackup } from "./runStateMigrationBackup"
import {
  listContainedRunIds,
  readContainedRunFile,
  writeContainedRunFile
} from "./runStatePath"
import {
  appendWorkflowRunEvent,
  buildWorkflowRunEvent,
  hashWorkflowRunBytes,
  readWorkflowRunEventLog,
  serializeWorkflowRunState
} from "./runEventLog"
import type { WorkflowRunEventKind } from "./runEventLog"
import {
  buildWorkflowRunJournal,
  recoverWorkflowRunJournal,
  serializeWorkflowRunJournal,
  writeWorkflowRunJournal
} from "./runStateJournal"
import {
  readRunDurabilityFile,
  removeRunDurabilityFile,
  syncRunMaterializedFile
} from "./runDurabilityPath"
import { withWorkflowRunLock } from "./runLock"
import type { WorkflowRunLockOptions } from "./runLock"

const RECOVERABLE_RUN_STATUSES = new Set(["running", "paused", "checkpoint", "reviewing", "held"])
const PERSISTENT_INFORMATION_CODES = new Set<RunStateLoadDiagnosticCode>([
  "migrated",
  "journal-recovered",
  "lock-reclaimed"
])

interface SharedRunLoadResult {
  run?: WorkflowRunState
  diagnostic?: RunStateLoadDiagnostic
}

const inFlightRunLoads = new Map<string, Promise<SharedRunLoadResult>>()
const runRevisionByObject = new WeakMap<object, string | "missing">()
const explicitRunTargetByInputs = new WeakMap<object, string>()

export interface RecoverableRunLookupOptions {
  executionMode?: "full" | "singleStep"
  stepId?: string
  allowOutOfOrder?: boolean
}

export interface RunStateStore {
  readonly workspaceRoot?: string
  createRun: (workflow: CoreWorkflowDefinition, inputs: Record<string, unknown>) => Promise<WorkflowRunState>
  saveRun: (run: WorkflowRunState) => Promise<void>
  loadRun: (runId: string) => Promise<WorkflowRunState | undefined>
  listRuns: () => Promise<WorkflowRunState[]>
  findRecoverableRun?: (workflow: CoreWorkflowDefinition, inputs: Record<string, unknown>, options?: RecoverableRunLookupOptions) => Promise<WorkflowRunState | undefined>
  withRunLock?: <T>(runId: string, operation: () => Promise<T>) => Promise<T>
}

export type WorkflowRunDurabilityFaultStage = "afterJournal" | "afterRun" | "afterEvent"

export interface FileRunStateStoreOptions {
  workspaceRoot: string
  now?: () => string
  engineVersion?: string
  lockOptions?: WorkflowRunLockOptions
  durabilityFault?: (stage: WorkflowRunDurabilityFaultStage) => void | Promise<void>
}

export class FileRunStateStore implements RunStateStore {
  readonly workspaceRoot: string
  private readonly now: () => string
  private readonly engineVersion?: string
  private readonly lockOptions?: WorkflowRunLockOptions
  private readonly durabilityFault?: FileRunStateStoreOptions["durabilityFault"]
  private readonly loadDiagnostics = new Map<string, RunStateLoadDiagnostic>()

  constructor(options: FileRunStateStoreOptions) {
    this.workspaceRoot = options.workspaceRoot
    this.now = options.now ?? (() => new Date().toISOString())
    this.engineVersion = options.engineVersion
    this.lockOptions = options.lockOptions
    this.durabilityFault = options.durabilityFault
  }

  async withRunLock<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const configuredReclaimed = this.lockOptions?.onReclaimed
    return withWorkflowRunLock(this.workspaceRoot, runId, operation, {
      ...this.lockOptions,
      onReclaimed: (message) => {
        this.setLoadDiagnostic({
          runId,
          severity: "warning",
          code: "lock-reclaimed",
          message
        })
        configuredReclaimed?.(message)
      }
    })
  }

  async createRun(workflow: CoreWorkflowDefinition, inputs: Record<string, unknown>): Promise<WorkflowRunState> {
    const createdAt = this.now()
    const runId = await this.nextRunId(workflow.name, createdAt)
    const run: WorkflowRunState = {
      schemaVersion: CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION,
      runId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      workflowSchemaVersion: workflow.schemaVersion,
      workflowDefinitionHash: workflow.definitionHash,
      workflowFile: workflow.filePath,
      engineVersion: this.engineVersion,
      status: "running",
      currentStep: workflow.engineSteps[0]?.id,
      inputs,
      state: {},
      steps: workflow.engineSteps.map((step) => ({
        id: step.id,
        title: step.title,
        type: step.type,
        status: "pending"
      })),
      createdAt,
      updatedAt: createdAt
    }
    runRevisionByObject.set(run, "missing")
    rememberExplicitRunTarget(run)
    return run
  }

  async saveRun(run: WorkflowRunState): Promise<void> {
    try {
      await this.withRunLock(run.runId, async () => {
        await this.recoverPendingJournalOwned(run.runId)
        const currentBytes = await readRunBytes(this.workspaceRoot, run.runId)
        const currentHash = currentBytes ? hashWorkflowRunBytes(currentBytes) : undefined
        const expectedRevision = runRevisionByObject.get(run)
        if (expectedRevision === "missing") {
          if (currentHash !== undefined) {
            throw new Error(`Workflow run '${run.runId}' changed since it was created; stale revision cannot be written.`)
          }
        } else if (typeof expectedRevision === "string" && expectedRevision !== currentHash) {
          throw new Error(`Workflow run '${run.runId}' changed since it was loaded; stale revision cannot be written.`)
        }
        const next = prepareWorkflowRunStateForWrite(structuredClone(run))
        next.updatedAt = this.now()
        const kind: WorkflowRunEventKind = currentBytes ? "run.updated" : "run.created"
        const committedHash = await this.commitSnapshotOwned(run.runId, next, currentBytes, kind, next.updatedAt)
        run.schemaVersion = CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION
        run.updatedAt = next.updatedAt
        runRevisionByObject.set(run, committedHash)
        rememberExplicitRunTarget(run)
      })
    } catch (error) {
      this.recordLoadFailure(run.runId, error)
      throw error
    }
  }

  async loadRun(runId: string): Promise<WorkflowRunState | undefined> {
    try {
      const pending = await readRunDurabilityFile(this.workspaceRoot, runId, "run-state.journal.json")
      if (pending) await this.withRunLock(runId, () => this.recoverPendingJournalOwned(runId))
      const result = await coordinateRunLoad(
        this.workspaceRoot,
        runId,
        () => this.loadRunShared(runId)
      )
      if (result.diagnostic) {
        this.setLoadDiagnostic(result.diagnostic)
      } else if (result.run) {
        this.clearTransientLoadDiagnostic(runId)
      }
      if (result.run) rememberExplicitRunTarget(result.run)
      return result.run
    } catch (error) {
      this.recordLoadFailure(runId, error)
      throw error
    }
  }

  async listRuns(): Promise<WorkflowRunState[]> {
    const entries = await listContainedRunIds(this.workspaceRoot)
    const entrySet = new Set(entries)
    for (const runId of this.loadDiagnostics.keys()) {
      if (!entrySet.has(runId)) this.loadDiagnostics.delete(runId)
    }
    const runs = await Promise.all(entries.map(async (entry) => {
      try {
        const run = await this.loadRun(entry)
        if (!run) this.recordInvalidLoad(entry, new Error(`Workflow run '${entry}' is missing run.json.`))
        return run
      } catch {
        return undefined
      }
    }))
    return runs
      .filter((run): run is WorkflowRunState => Boolean(run))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  getLoadDiagnostics(): RunStateLoadDiagnostic[] {
    const severityOrder: Record<RunStateLoadDiagnostic["severity"], number> = {
      error: 0,
      warning: 1,
      info: 2
    }
    return [...this.loadDiagnostics.values()]
      .map((diagnostic) => ({ ...diagnostic }))
      .sort((left, right) =>
        compareText(left.runId, right.runId)
        || severityOrder[left.severity] - severityOrder[right.severity]
        || compareText(left.code, right.code)
        || compareText(left.message, right.message)
      )
  }

  async findRecoverableRun(workflow: CoreWorkflowDefinition, inputs: Record<string, unknown>, options: RecoverableRunLookupOptions = {}): Promise<WorkflowRunState | undefined> {
    const expectedInputs = stableJson(inputs)
    const runs = await this.listRuns()
    const matchingRuns = runs.filter((run) => (
      run.workflowId === workflow.id
      && workflowDefinitionMatches(run, workflow)
      && stableJson(run.inputs) === expectedInputs
    ))
    const explicitRunId = explicitRunTargetByInputs.get(inputs)
    if (explicitRunId) {
      const explicitRun = matchingRuns.find((run) => run.runId === explicitRunId)
      if (explicitRun) {
        assertWorkflowRunStateWritable(explicitRun)
        return isRecoverableRun(explicitRun, workflow, expectedInputs, options) ? explicitRun : undefined
      }
    }
    const recoverable = matchingRuns.find((run) => isRecoverableRun(run, workflow, expectedInputs, options))
    if (recoverable) return recoverable
    if (options.executionMode === "singleStep") {
      const readOnly = matchingRuns.find((run) => !isCurrentWorkflowRunState(run))
      if (readOnly) assertWorkflowRunStateWritable(readOnly)
    }
    return undefined
  }

  private async loadRunShared(runId: string): Promise<SharedRunLoadResult> {
    let snapshot: Awaited<ReturnType<typeof readContainedRunFile>>
    try {
      snapshot = await readContainedRunFile(this.workspaceRoot, runId)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}
      throw error
    }
    const text = snapshot.bytes.toString("utf8")
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch (error) {
      throw new Error(`Workflow run '${runId}' contains invalid JSON: ${formatError(error)}`)
    }
    const decoded = decodeWorkflowRunState(value, runId)
    if (decoded.migrated) {
      const migrated = await this.migrateRun(runId)
      return {
        run: migrated,
        diagnostic: {
          runId,
          severity: "info",
          code: "migrated",
          message: decoded.diagnostics[0]
        }
      }
    }
    if (decoded.readOnly) {
      rememberLoadedRevision(decoded.run, snapshot.bytes)
      return {
        run: decoded.run,
        diagnostic: {
          runId,
          severity: "warning",
          code: "read-only",
          message: decoded.diagnostics[0]
        }
      }
    }
    rememberLoadedRevision(decoded.run, snapshot.bytes)
    return { run: decoded.run }
  }

  private async migrateRun(runId: string): Promise<WorkflowRunState> {
    return this.withRunLock(runId, async () => {
      await this.recoverPendingJournalOwned(runId)
      const snapshot = await readContainedRunFile(this.workspaceRoot, runId)
      const text = snapshot.bytes.toString("utf8")
      const decoded = decodeWorkflowRunState(JSON.parse(text), runId)
      if (!decoded.migrated) {
        rememberLoadedRevision(decoded.run, snapshot.bytes)
        return decoded.run
      }
      await ensureContainedRunStateMigrationBackup(this.workspaceRoot, runId, text)
      const committedHash = await this.commitSnapshotOwned(runId, decoded.run, snapshot.bytes, "run.migrated", this.now())
      runRevisionByObject.set(decoded.run, committedHash)
      rememberExplicitRunTarget(decoded.run)
      this.setLoadDiagnostic({ runId, severity: "info", code: "migrated", message: decoded.diagnostics[0] })
      return decoded.run
    })
  }

  private async recoverPendingJournalOwned(runId: string): Promise<void> {
    const result = await recoverWorkflowRunJournal({
      workspaceRoot: this.workspaceRoot,
      runId,
      readRunBytes: () => readRunBytes(this.workspaceRoot, runId),
      writeRunText: (content) => writeContainedRunFile(this.workspaceRoot, runId, content),
      syncRunFile: () => syncRunMaterializedFile(this.workspaceRoot, runId)
    })
    if (result.recovered) {
      this.setLoadDiagnostic({
        runId,
        severity: "info",
        code: "journal-recovered",
        message: `Recovered interrupted workflow run transaction '${result.journal?.transactionId ?? "unknown"}'.`
      })
    }
  }

  private async commitSnapshotOwned(
    runId: string,
    nextRun: WorkflowRunState,
    previousBytes: Buffer | undefined,
    kind: WorkflowRunEventKind,
    occurredAt: string
  ): Promise<string> {
    const previousRunHash = previousBytes ? hashWorkflowRunBytes(previousBytes) : undefined
    const eventState = await readWorkflowRunEventLog(this.workspaceRoot, runId)
    if (eventState.head && eventState.head.runHash !== previousRunHash) {
      throw new Error(`Workflow run '${runId}' event log head does not match the materialized run revision.`)
    }
    const nextEvent = buildWorkflowRunEvent({
      run: nextRun,
      kind,
      occurredAt,
      previousEvent: eventState.head,
      previousRunHash
    })
    const journal = buildWorkflowRunJournal({
      transactionId: randomUUID(),
      runId,
      createdAt: occurredAt,
      previousRunHash,
      previousEventHash: eventState.head?.hash,
      nextRun,
      nextEvent
    })
    const journalBytes = Buffer.from(serializeWorkflowRunJournal(journal), "utf8")
    await writeWorkflowRunJournal(this.workspaceRoot, runId, journal)
    await this.durabilityFault?.("afterJournal")
    await writeContainedRunFile(this.workspaceRoot, runId, serializeWorkflowRunState(nextRun))
    await syncRunMaterializedFile(this.workspaceRoot, runId)
    await this.durabilityFault?.("afterRun")
    await appendWorkflowRunEvent(this.workspaceRoot, runId, nextEvent)
    await this.durabilityFault?.("afterEvent")
    const removed = await removeRunDurabilityFile(this.workspaceRoot, runId, "run-state.journal.json", journalBytes)
    if (!removed) throw new Error(`Workflow run '${runId}' journal changed before commit cleanup.`)
    return nextEvent.runHash
  }

  private async nextRunId(workflowName: string, createdAt: string): Promise<string> {
    const stamp = createdAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace(/[^\dTZ]/g, "")
    const base = `${stamp}-${sanitize(workflowName)}`
    for (let index = 0; index < 10; index += 1) {
      const candidate = `${base}-${randomUUID().replace(/-/g, "").slice(0, 12)}`
      if (!await optionalReadRun(this.workspaceRoot, candidate)) return candidate
    }
    throw new Error(`Could not allocate unique workflow run id for '${workflowName}'.`)
  }

  private setLoadDiagnostic(diagnostic: RunStateLoadDiagnostic): void {
    this.loadDiagnostics.set(diagnostic.runId, diagnostic)
  }

  private recordInvalidLoad(runId: string, error: unknown): void {
    this.setLoadDiagnostic({
      runId,
      severity: "error",
      code: "invalid",
      message: formatError(error)
    })
  }

  private recordLoadFailure(runId: string, error: unknown): void {
    const message = formatError(error)
    const code = diagnosticCodeForError(message)
    this.setLoadDiagnostic({
      runId,
      severity: code === "lock-busy" ? "warning" : "error",
      code,
      message
    })
  }

  private clearTransientLoadDiagnostic(runId: string): void {
    const existing = this.loadDiagnostics.get(runId)
    if (existing && !PERSISTENT_INFORMATION_CODES.has(existing.code)) this.loadDiagnostics.delete(runId)
  }
}

function coordinateRunLoad(
  workspaceRoot: string,
  runId: string,
  operation: () => Promise<SharedRunLoadResult>
): Promise<SharedRunLoadResult> {
  const key = JSON.stringify([normalizeWorkspaceRootIdentity(workspaceRoot), runId])
  const existing = inFlightRunLoads.get(key)
  if (existing) return existing
  let coordinated!: Promise<SharedRunLoadResult>
  coordinated = Promise.resolve().then(operation).finally(() => {
    if (inFlightRunLoads.get(key) === coordinated) inFlightRunLoads.delete(key)
  })
  inFlightRunLoads.set(key, coordinated)
  return coordinated
}

async function optionalReadRun(workspaceRoot: string, runId: string): Promise<Awaited<ReturnType<typeof readContainedRunFile>> | undefined> {
  try {
    return await readContainedRunFile(workspaceRoot, runId)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

async function readRunBytes(workspaceRoot: string, runId: string): Promise<Buffer | undefined> {
  return (await optionalReadRun(workspaceRoot, runId))?.bytes
}

function rememberLoadedRevision(run: WorkflowRunState, bytes: Buffer): void {
  runRevisionByObject.set(run, hashWorkflowRunBytes(bytes))
  rememberExplicitRunTarget(run)
}

function rememberExplicitRunTarget(run: WorkflowRunState): void {
  if (run.inputs && typeof run.inputs === "object" && !Array.isArray(run.inputs)) {
    explicitRunTargetByInputs.set(run.inputs, run.runId)
  }
}

function workflowDefinitionMatches(run: WorkflowRunState, workflow: CoreWorkflowDefinition): boolean {
  if (run.workflowDefinitionHash && workflow.definitionHash && run.workflowDefinitionHash !== workflow.definitionHash) return false
  if (run.workflowFile && workflow.filePath && run.workflowFile !== workflow.filePath) return false
  return true
}

function isRecoverableRun(run: WorkflowRunState, workflow: CoreWorkflowDefinition, expectedInputs: string, options: RecoverableRunLookupOptions): boolean {
  if (!isCurrentWorkflowRunState(run)) return false
  if (run.workflowId !== workflow.id) return false
  if (!workflowDefinitionMatches(run, workflow)) return false
  if (stableJson(run.inputs) !== expectedInputs) return false
  if (RECOVERABLE_RUN_STATUSES.has(run.status)) return true
  if (run.status !== "failed" || options.executionMode !== "singleStep" || !options.stepId) return false
  if (run.currentStep !== options.stepId) return false
  const stepIndex = workflow.engineSteps.findIndex((step) => step.id === options.stepId)
  if (stepIndex < 0) return false
  if (run.steps[stepIndex]?.status !== "failed") return false
  const reviewOrHeldGateIndex = run.steps.slice(0, stepIndex).findIndex((step) => step.status === "reviewing" || step.status === "held")
  if (reviewOrHeldGateIndex >= 0) {
    return run.steps.slice(0, reviewOrHeldGateIndex).every((step) => step.status === "completed")
  }
  return run.steps.slice(0, stepIndex).every((step) => step.status === "completed")
}

function diagnosticCodeForError(message: string): RunStateLoadDiagnosticCode {
  const normalized = message.toLowerCase()
  if (normalized.includes("event log")) return "event-log-invalid"
  if (normalized.includes("journal")) return "journal-conflict"
  if (normalized.includes("stale revision") || normalized.includes("changed since it was loaded") || normalized.includes("changed since it was created")) return "stale-write"
  if (normalized.includes("busy or locked") || normalized.includes("lock ownership") || normalized.includes("lock disappeared")) return "lock-busy"
  return "invalid"
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalJson(value))
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

function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workflow"
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
