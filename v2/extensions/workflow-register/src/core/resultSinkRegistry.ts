import * as fs from "fs/promises"
import * as path from "path"
import { ResultSinkDefinition, ResultSinkWriteInput, ResultSinkWriteResult } from "./model"
import { requireWorkspaceTrust, type WorkspaceTrustCheck } from "./workspaceTrust"

type SinkHandler = (sink: ResultSinkDefinition, input: ResultSinkWriteInput) => Promise<ResultSinkWriteResult>

export class ResultSinkRegistry {
  private readonly handlers = new Map<string, SinkHandler>()

  register(type: string, handler: SinkHandler): void {
    if (!type.trim()) throw new Error("Result sink type is required.")
    this.handlers.set(type, handler)
  }

  list(): string[] {
    return Array.from(this.handlers.keys()).sort()
  }

  async write(sink: ResultSinkDefinition, input: ResultSinkWriteInput): Promise<ResultSinkWriteResult> {
    const handler = this.handlers.get(sink.type)
    if (!handler) return { ok: false, error: `Unsupported result sink: ${sink.type}` }
    try {
      return await handler(sink, input)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}

export interface DefaultResultSinkRegistryOptions {
  workspaceRoot: string
  executeCommand: (command: string, ...args: unknown[]) => Promise<unknown> | unknown
  allowedCommandSinks?: string[]
  isWorkspaceTrusted?: WorkspaceTrustCheck
}

export function createDefaultResultSinkRegistry(options: DefaultResultSinkRegistryOptions): ResultSinkRegistry {
  const allowedCommandSinks = new Set(options.allowedCommandSinks ?? ["bobBazaar.captureReviewResult"])
  const registry = new ResultSinkRegistry()

  registry.register("command", async (sink, input) => {
    if (sink.type !== "command") return { ok: false, error: `Invalid command sink: ${sink.type}` }
    requireWorkspaceTrust(options.isWorkspaceTrusted, "writing command result sink")
    if (!allowedCommandSinks.has(sink.command)) return { ok: false, error: `Unsupported result command: ${sink.command}` }
    const value = await Promise.resolve(options.executeCommand(sink.command, input.text, ...(sink.args ?? []), commandContext(input, options.workspaceRoot)))
    const reportedError = commandReportedError(value)
    if (reportedError) return { ok: false, value, error: reportedError }
    return { ok: true, value }
  })

  registry.register("file", async (sink, input) => {
    if (sink.type !== "file") return { ok: false, error: `Invalid file sink: ${sink.type}` }
    requireWorkspaceTrust(options.isWorkspaceTrusted, "writing file result sink")
    const target = resolveWorkspacePath(options.workspaceRoot, renderTemplate(sink.path, input))
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, input.text, { encoding: sink.encoding ?? "utf8" })
    return { ok: true, path: target }
  })

  return registry
}

function resolveWorkspacePath(workspaceRoot: string, sinkPath: string): string {
  const root = path.resolve(workspaceRoot)
  const target = path.resolve(root, sinkPath)
  const relative = path.relative(root, target)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Result file path escapes the workspace: ${sinkPath}`)
  }
  return target
}

function renderTemplate(value: string, input: ResultSinkWriteInput): string {
  return value
    .replace(/\{\{\s*run\.id\s*\}\}/g, input.runId)
    .replace(/\{\{\s*runId\s*\}\}/g, input.runId)
    .replace(/\{\{\s*step\.id\s*\}\}/g, input.stepId)
    .replace(/\{\{\s*stepId\s*\}\}/g, input.stepId)
    .replace(/\{\{\s*workflow\.id\s*\}\}/g, input.workflowId)
}

function commandContext(input: ResultSinkWriteInput, workspaceRoot: string): Record<string, unknown> {
  return compactObject({
    workflowId: input.workflowId,
    logicalWorkflowId: input.logicalWorkflowId,
    workflowRoot: input.workflowRoot ?? workspaceRoot,
    workflowFile: input.workflowFile,
    workflowFolderName: input.workflowFolderName,
    runId: input.runId,
    stepId: input.stepId,
    inputs: input.inputs,
    state: input.state,
    latestAssistantText: input.text,
    resultText: input.text,
    artifactText: input.text
  })
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

function commandReportedError(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  if (record.status !== "error" && record.valid !== false) return undefined
  const issues = Array.isArray(record.issues)
    ? record.issues.map(formatIssue).filter(Boolean).join("; ")
    : undefined
  return issues ? `result command reported an error: ${issues}` : "result command reported an error."
}

function formatIssue(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined
  const issue = value as Record<string, unknown>
  const issuePath = typeof issue.path === "string" ? issue.path : "$"
  const message = typeof issue.message === "string" ? issue.message : "validation failed"
  return `${issuePath}: ${message}`
}
