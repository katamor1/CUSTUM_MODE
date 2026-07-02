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
    this.includeMessages = options.includeMessages !== false
    this.pruneOnSave = options.pruneOnSave !== false
  }

  async saveSnapshot(snapshot: TaskSnapshotPayload): Promise<{ path: string }> {
    const prepared = prepareSnapshot({ ...snapshot, createdAt: this.now() }, {
      includeMessages: this.includeMessages,
      maxBytes: this.maxBytes
    })
    const root = this.snapshotRoot(snapshot.runId)
    await fs.mkdir(root, { recursive: true })
    const file = path.join(root, snapshotFileName(prepared))
    await atomicWriteFile(file, `${JSON.stringify(prepared, null, 2)}\n`)
    await atomicWriteFile(path.join(root, "latest.json"), `${JSON.stringify(prepared, null, 2)}\n`)
    if (this.pruneOnSave) await this.pruneSnapshots(snapshot.runId)
    return { path: file }
  }

  async loadLatest(runId: string): Promise<TaskSnapshotPayload | undefined> {
    return readSnapshot(path.join(this.snapshotRoot(runId), "latest.json"))
  }

  async listSnapshots(runId: string): Promise<TaskSnapshotSummary[]> {
    const snapshots = await this.loadSnapshots(runId)
    return snapshots.map(({ fileName, snapshot }) => summarizeSnapshot(fileName, snapshot))
  }

  async findLatestSnapshot(runId: string, predicate: (snapshot: TaskSnapshotPayload) => boolean): Promise<TaskSnapshotPayload | undefined> {
    const snapshots = await this.loadSnapshots(runId)
    for (let index = snapshots.length - 1; index >= 0; index -= 1) {
      if (predicate(snapshots[index].snapshot)) return snapshots[index].snapshot
    }
    return undefined
  }

  private async loadSnapshots(runId: string): Promise<Array<{ fileName: string; snapshot: TaskSnapshotPayload }>> {
    const root = this.snapshotRoot(runId)
    let entries: string[]
    try {
      entries = await fs.readdir(root)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
      throw error
    }
    const snapshots: Array<{ fileName: string; snapshot: TaskSnapshotPayload }> = []
    for (const fileName of entries.filter((entry) => entry.endsWith(".json") && entry !== "latest.json")) {
      const snapshot = await readSnapshot(path.join(root, fileName))
      if (snapshot) snapshots.push({ fileName, snapshot })
    }
    return snapshots.sort((a, b) => a.snapshot.createdAt.localeCompare(b.snapshot.createdAt) || a.fileName.localeCompare(b.fileName))
  }

  private async pruneSnapshots(runId: string): Promise<void> {
    if (this.maxPerRun <= 0) return
    const snapshots = await this.loadSnapshots(runId)
    const excess = snapshots.length - this.maxPerRun
    if (excess <= 0) return
    const root = this.snapshotRoot(runId)
    await Promise.all(snapshots.slice(0, excess).map((entry) => fs.rm(path.join(root, entry.fileName), { force: true })))
  }

  private snapshotRoot(runId: string): string {
    return path.join(this.workspaceRoot, ".bob", "workflows", "runs", safeSegment(runId, "runId"), "task-snapshots")
  }
}

export function createBobTaskSnapshotProvider(task: {
  getMessages?: () => unknown[]
  getAllMetadata?: () => Record<string, unknown>
  toSerializable?: () => unknown
}): TaskSnapshotProvider {
  return {
    exportTask: (input) => {
      const rawMessages = task.getMessages?.()
      const messages = Array.isArray(rawMessages) ? rawMessages : []
      const lastAssistantText = input.lastAssistantText ?? extractLastAssistantText(messages)
      return {
        schemaVersion: "workflow-register/task-snapshot/v1",
        createdAt: new Date().toISOString(),
        reason: input.reason,
        runId: input.run.runId,
        workflowId: input.workflow.id,
        logicalWorkflowId: input.workflow.logicalWorkflowId,
        workflowDefinitionHash: input.workflow.definitionHash,
        stepId: input.step?.id ?? input.run.currentStep ?? "workflow",
        runStatus: input.run.status,
        runCurrentStep: input.run.currentStep,
        taskMetadata: recordValue(task.getAllMetadata?.()),
        messages,
        messageCount: messages.length,
        taskExport: safeCall(() => task.toSerializable?.()),
        lastAssistantText,
        handoff: input.handoff
      }
    }
  }
}

export function snapshotMatchesRun(snapshot: TaskSnapshotPayload, workflow: CoreWorkflowDefinition, run: WorkflowRunState, step: EngineStep): boolean {
  if (snapshot.runId !== run.runId) return false
  if (snapshot.workflowId !== workflow.id) return false
  if (snapshot.stepId !== step.id) return false
  if (snapshot.workflowDefinitionHash && workflow.definitionHash && snapshot.workflowDefinitionHash !== workflow.definitionHash) return false
  return true
}

function prepareSnapshot(snapshot: TaskSnapshotPayload, options: { includeMessages: boolean; maxBytes: number }): TaskSnapshotPayload {
  const prepared: TaskSnapshotPayload = {
    ...snapshot,
    messages: options.includeMessages ? [...(snapshot.messages ?? [])] : undefined,
    messageCount: snapshot.messageCount ?? snapshot.messages?.length
  }
  if (!options.includeMessages && snapshot.messages?.length) {
    prepared.omittedMessageCount = snapshot.messages.length
    prepared.truncated = true
  }
  while (options.maxBytes > 0 && byteLength(prepared) > options.maxBytes && (prepared.messages?.length ?? 0) > 0) {
    prepared.messages?.shift()
    prepared.omittedMessageCount = (prepared.omittedMessageCount ?? 0) + 1
    prepared.truncated = true
  }
  if (options.maxBytes > 0 && byteLength(prepared) > options.maxBytes && prepared.lastAssistantText) {
    prepared.lastAssistantText = truncateUtf8(prepared.lastAssistantText, Math.max(128, Math.floor(options.maxBytes / 3)))
    prepared.truncated = true
  }
  if (options.maxBytes > 0 && byteLength(prepared) > options.maxBytes && prepared.taskExport !== undefined) {
    prepared.taskExport = undefined
    prepared.truncated = true
  }
  if (options.maxBytes > 0 && byteLength(prepared) > options.maxBytes && prepared.taskMetadata !== undefined) {
    prepared.taskMetadata = undefined
    prepared.truncated = true
  }
  return prepared
}

function summarizeSnapshot(fileName: string, snapshot: TaskSnapshotPayload): TaskSnapshotSummary {
  return {
    fileName,
    createdAt: snapshot.createdAt,
    reason: snapshot.reason,
    workflowId: snapshot.workflowId,
    workflowDefinitionHash: snapshot.workflowDefinitionHash,
    stepId: snapshot.stepId,
    hasLastAssistantText: Boolean(snapshot.lastAssistantText?.trim()),
    handoffError: snapshot.handoff?.error,
    truncated: snapshot.truncated
  }
}

async function readSnapshot(file: string): Promise<TaskSnapshotPayload | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as TaskSnapshotPayload
    return parsed?.schemaVersion === "workflow-register/task-snapshot/v1" ? parsed : undefined
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    return undefined
  }
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

function snapshotFileName(snapshot: TaskSnapshotPayload): string {
  const stamp = snapshot.createdAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace(/[^\dTZ]/g, "")
  const reason = safeSegment(snapshot.reason, "reason")
  const step = safeSegment(snapshot.stepId, "step")
  return `${stamp}-${reason}-${step}.json`
}

function extractLastAssistantText(messages: unknown[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = recordValue(messages[index])
    const role = String(message.role ?? message.type ?? "").toLowerCase()
    if (role && role !== "assistant" && role !== "ai") continue
    const content = textFromMessage(message)
    if (content.trim()) return content
  }
  return undefined
}

function textFromMessage(message: Record<string, unknown>): string {
  const candidates = [message.text, message.content, message.message]
  for (const candidate of candidates) {
    const text = textValue(candidate)
    if (text.trim()) return text
  }
  return ""
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join("\n")
  const record = recordValue(value)
  if (typeof record.text === "string") return record.text
  if (typeof record.content === "string") return record.content
  return ""
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function safeCall<T>(run: () => T): T | undefined {
  try { return run() } catch { return undefined }
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8")
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value
  let output = value
  while (Buffer.byteLength(output, "utf8") > maxBytes && output.length > 0) output = output.slice(0, Math.max(0, output.length - 512))
  return `${output}\n... [truncated to ${maxBytes} bytes]`
}

function safeSegment(value: string, fallback: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || fallback
}
