import * as fs from "fs/promises"
import * as path from "path"
import { CoreWorkflowDefinition, EngineStep, RunStatus, WorkflowRunState } from "./model"

export type TaskSnapshotReason =
  | "workflow-start"
  | "step-start"
  | "agent-output"
  | "handoff-failed"
  | "held"
  | "failed"
  | "review-required"
  | "pause-requested"
  | "paused"
  | "completed"

export interface TaskSnapshotHandoff {
  resultCommand?: string
  error?: string
}

export interface TaskSnapshotPayload {
  schemaVersion: "workflow-register/task-snapshot/v1"
  createdAt: string
  reason: TaskSnapshotReason
  runId: string
  workflowId: string
  logicalWorkflowId?: string
  workflowDefinitionHash?: string
  stepId: string
  runStatus?: RunStatus
  runCurrentStep?: string
  taskMetadata?: Record<string, unknown>
  messages?: unknown[]
  messageCount?: number
  omittedMessageCount?: number
  truncated?: boolean
  taskExport?: unknown
  lastAssistantText?: string
  handoff?: TaskSnapshotHandoff
}

export interface TaskSnapshotSummary {
  fileName: string
  createdAt: string
  reason: TaskSnapshotReason
  workflowId: string
  workflowDefinitionHash?: string
  stepId: string
  hasLastAssistantText: boolean
  handoffError?: string
  truncated?: boolean
}

export interface TaskSnapshotInput {
  reason: TaskSnapshotReason
  workflow: CoreWorkflowDefinition
  run: WorkflowRunState
  step?: EngineStep
  lastAssistantText?: string
  handoff?: TaskSnapshotHandoff
}

export interface TaskSnapshotProvider {
  exportTask(input: TaskSnapshotInput): Promise<TaskSnapshotPayload | undefined> | TaskSnapshotPayload | undefined
}

export interface TaskSnapshotStore {
  saveSnapshot(snapshot: TaskSnapshotPayload): Promise<{ path: string }>
  loadLatest(runId: string): Promise<TaskSnapshotPayload | undefined>
  listSnapshots(runId: string): Promise<TaskSnapshotSummary[]>
  findLatestSnapshot(runId: string, predicate: (snapshot: TaskSnapshotPayload) => boolean): Promise<TaskSnapshotPayload | undefined>
}

export interface FileTaskSnapshotStoreOptions {
  workspaceRoot: string
  now?: () => string
  maxBytes?: number
  maxPerRun?: number
  includeMessages?: boolean
  pruneOnSave?: boolean
}

export class FileTaskSnapshotStore implements TaskSnapshotStore {
  private readonly workspaceRoot: string
  private readonly now: () => string
  private readonly maxBytes: number
  private readonly maxPerRun: number
  private readonly includeMessages: boolean
  private readonly pruneOnSave: boolean

  constructor(options: FileTaskSnapshotStoreOptions) {
    this.workspaceRoot = options.workspaceRoot
    this.now = options.now ?? (() => new Date().toISOString())
    this.maxBytes = options.maxBytes ?? 262_144
    this.maxPerRun = options.maxPerRun ?? 50
    this.includeMessages = options.includeMessages ?? true
    this.pruneOnSave = options.pruneOnSave ?? true
  }

  async saveSnapshot(snapshot: TaskSnapshotPayload): Promise<{ path: string }> {
    const pruned = this.prepareSnapshot(snapshot)
    const dir = this.snapshotDir(snapshot.runId)
    await fs.mkdir(dir, { recursive: true })
    const file = path.join(dir, `${safeTimestamp(pruned.createdAt)}-${pruned.reason}.json`)
    await atomicWriteFile(file, `${JSON.stringify(pruned, null, 2)}\n`)
    await atomicWriteFile(path.join(dir, "latest.json"), `${JSON.stringify(pruned, null, 2)}\n`)
    if (this.pruneOnSave) await this.pruneSnapshots(dir)
    return { path: file }
  }

  async loadLatest(runId: string): Promise<TaskSnapshotPayload | undefined> {
    try {
      return JSON.parse(await fs.readFile(path.join(this.snapshotDir(runId), "latest.json"), "utf8")) as TaskSnapshotPayload
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
      throw error
    }
  }

  async listSnapshots(runId: string): Promise<TaskSnapshotSummary[]> {
    const dir = this.snapshotDir(runId)
    let entries: string[]
    try {
      entries = await fs.readdir(dir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
      throw error
    }
    const jsonEntries = entries.filter((entry) => entry.endsWith(".json") && entry !== "latest.json")
    const snapshots = await Promise.all(jsonEntries.map(async (entry) => {
      try {
        const snapshot = JSON.parse(await fs.readFile(path.join(dir, entry), "utf8")) as TaskSnapshotPayload
        return summarizeSnapshot(entry, snapshot)
      } catch {
        return undefined
      }
    }))
    return snapshots
      .filter((snapshot): snapshot is TaskSnapshotSummary => Boolean(snapshot))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async findLatestSnapshot(runId: string, predicate: (snapshot: TaskSnapshotPayload) => boolean): Promise<TaskSnapshotPayload | undefined> {
    const dir = this.snapshotDir(runId)
    let entries: string[]
    try {
      entries = await fs.readdir(dir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
      throw error
    }
    const jsonEntries = entries.filter((entry) => entry.endsWith(".json") && entry !== "latest.json").sort().reverse()
    for (const entry of jsonEntries) {
      try {
        const snapshot = JSON.parse(await fs.readFile(path.join(dir, entry), "utf8")) as TaskSnapshotPayload
        if (predicate(snapshot)) return snapshot
      } catch {
        // Ignore unreadable snapshots.
      }
    }
    return undefined
  }

  private prepareSnapshot(snapshot: TaskSnapshotPayload): TaskSnapshotPayload {
    let prepared: TaskSnapshotPayload = {
      ...snapshot,
      createdAt: this.now(),
      messages: this.includeMessages ? snapshot.messages : undefined
    }
    while (Buffer.byteLength(JSON.stringify(prepared), "utf8") > this.maxBytes && prepared.messages && prepared.messages.length > 0) {
      prepared = {
        ...prepared,
        messages: prepared.messages.slice(1),
        omittedMessageCount: (prepared.omittedMessageCount ?? 0) + 1,
        truncated: true
      }
    }
    if (Buffer.byteLength(JSON.stringify(prepared), "utf8") > this.maxBytes && prepared.taskExport !== undefined) {
      prepared = { ...prepared, taskExport: undefined, truncated: true }
    }
    if (Buffer.byteLength(JSON.stringify(prepared), "utf8") > this.maxBytes && prepared.lastAssistantText) {
      prepared = { ...prepared, lastAssistantText: truncateToBytes(prepared.lastAssistantText, Math.max(1024, Math.floor(this.maxBytes / 4))), truncated: true }
    }
    return prepared
  }

  private async pruneSnapshots(dir: string): Promise<void> {
    if (this.maxPerRun <= 0) return
    const entries = (await fs.readdir(dir))
      .filter((entry) => entry.endsWith(".json") && entry !== "latest.json")
      .sort()
    const excess = entries.length - this.maxPerRun
    if (excess <= 0) return
    await Promise.all(entries.slice(0, excess).map((entry) => fs.rm(path.join(dir, entry), { force: true })))
  }

  private snapshotDir(runId: string): string {
    return path.join(this.workspaceRoot, ".bob", "workflows", "runs", sanitize(runId), "task-snapshots")
  }
}

export function createBobTaskSnapshotProvider(task: {
  getMessages?: () => unknown[]
  getAllMetadata?: () => Record<string, unknown>
  toSerializable?: () => unknown
}): TaskSnapshotProvider {
  return {
    exportTask: (input) => {
      const messages = task.getMessages?.()
      const lastAssistantText = input.lastAssistantText ?? extractLastAssistantText(messages ?? [])
      return {
        schemaVersion: "workflow-register/task-snapshot/v1",
        createdAt: new Date().toISOString(),
        reason: input.reason,
        runId: input.run.runId,
        workflowId: input.workflow.id,
        logicalWorkflowId: input.workflow.logicalWorkflowId,
        workflowDefinitionHash: input.workflow.definitionHash,
        stepId: input.step?.id ?? input.run.currentStep ?? "none",
        runStatus: input.run.status,
        runCurrentStep: input.run.currentStep,
        taskMetadata: safeObject(task.getAllMetadata?.()),
        messages,
        messageCount: messages?.length,
        taskExport: task.toSerializable?.(),
        lastAssistantText,
        handoff: input.handoff
      }
    }
  }
}

export function snapshotMatchesRun(
  snapshot: TaskSnapshotPayload,
  workflow: CoreWorkflowDefinition,
  run: WorkflowRunState,
  step?: EngineStep
): boolean {
  if (snapshot.runId !== run.runId) return false
  if (snapshot.workflowId !== workflow.id) return false
  if (snapshot.workflowDefinitionHash && workflow.definitionHash && snapshot.workflowDefinitionHash !== workflow.definitionHash) return false
  if (step && snapshot.stepId !== step.id) return false
  if (!step && run.currentStep && snapshot.stepId !== run.currentStep) return false
  return true
}

function summarizeSnapshot(fileName: string, snapshot: TaskSnapshotPayload): TaskSnapshotSummary {
  return {
    fileName,
    createdAt: snapshot.createdAt,
    reason: snapshot.reason,
    workflowId: snapshot.workflowId,
    workflowDefinitionHash: snapshot.workflowDefinitionHash,
    stepId: snapshot.stepId,
    hasLastAssistantText: Boolean(snapshot.lastAssistantText),
    handoffError: snapshot.handoff?.error,
    truncated: snapshot.truncated
  }
}

function extractLastAssistantText(messages: unknown[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index]
    if (!candidate || typeof candidate !== "object") continue
    const record = candidate as Record<string, unknown>
    const role = record.role ?? record.sender ?? record.type
    if (role !== "assistant" && role !== "ai") continue
    const text = record.text ?? record.content ?? record.message
    if (typeof text === "string" && text.trim()) return text
  }
  return undefined
}

function safeObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

async function atomicWriteFile(file: string, content: string): Promise<void> {
  const tempFile = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  try {
    await fs.writeFile(tempFile, content, "utf8")
    await fs.rename(tempFile, file)
  } catch (error) {
    await fs.rm(tempFile, { force: true }).catch(() => undefined)
    throw error
  }
}

function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "run"
}

function safeTimestamp(value: string): string {
  return value.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace(/[^\dTZ]/g, "") || Date.now().toString()
}

function truncateToBytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value
  let output = value
  while (Buffer.byteLength(output, "utf8") > maxBytes && output.length > 0) {
    output = output.slice(0, Math.max(0, output.length - 512))
  }
  return `${output}\n... [truncated to ${maxBytes} bytes]`
}
