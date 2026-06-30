import { ActionRegistry } from "./core/actionRegistry"

export type ResultSource = "agent" | "lastAssistant"

export interface ResultHandoffStep {
  captureResult?: boolean
  runAgent?: boolean
  resultSource?: ResultSource
  resultCommand?: string
  resultCommandArgs?: unknown[]
}

export interface ResultHandoffDeps {
  actions?: ActionRegistry
  executeCommand?: (command: string, ...args: unknown[]) => Promise<unknown> | unknown
  inputs?: Record<string, unknown>
  state?: Record<string, string>
  workflowId?: string
  runId?: string
  stepId?: string
  recoverResultText?: (input: ResultHandoffRecoveryInput) => Promise<string | undefined> | string | undefined
}

export interface ResultHandoffRecoveryInput {
  workflowId?: string
  runId?: string
  stepId?: string
  reason: "missing-result-text"
}

export interface ResultHandoffResult {
  ok: boolean
  skipped?: boolean
  command?: string
  value?: unknown
  error?: string
}

interface MessageLike {
  role?: unknown
  content?: unknown
}

export function resultSourceForStep(step: ResultHandoffStep): ResultSource {
  return step.resultSource ?? (step.runAgent ? "agent" : "lastAssistant")
}

export function extractLastAssistantText(messages: unknown[], startIndex = 0): string | undefined {
  for (let index = messages.length - 1; index >= Math.max(0, startIndex); index -= 1) {
    const message = messages[index] as MessageLike
    if (message?.role !== "assistant") continue
    const content = textContent(message.content)
    if (content) return content
  }
  return undefined
}

export async function executeResultHandoff(step: ResultHandoffStep, resultText: string | undefined, deps: ResultHandoffDeps): Promise<ResultHandoffResult> {
  if (!step.captureResult) return { ok: true, skipped: true }
  const recoveredText = resultText?.trim() ? resultText : await deps.recoverResultText?.({
    workflowId: deps.workflowId,
    runId: deps.runId,
    stepId: deps.stepId,
    reason: "missing-result-text"
  })
  const artifactText = recoveredText?.trim()
  if (!artifactText) return { ok: false, error: "No result text was available to hand off." }
  if (!step.resultCommand) return { ok: false, error: "captureResult requires resultCommand." }
  const actions = deps.actions ?? createCommandFallbackRegistry(step.resultCommand, deps.executeCommand)
  try {
    const result = await actions.execute(step.resultCommand, {
      args: [artifactText, ...(step.resultCommandArgs ?? [])],
      inputs: deps.inputs ?? {},
      state: deps.state,
      workflowId: deps.workflowId,
      runId: deps.runId,
      stepId: deps.stepId,
      latestAssistantText: artifactText,
      resultText: artifactText,
      artifactText
    })
    if (!result.ok) return { ok: false, command: step.resultCommand, error: result.error ?? `Result handoff action failed: ${step.resultCommand}` }
    const reportedError = commandReportedError(result.value)
    if (reportedError) return { ok: false, command: step.resultCommand, error: reportedError }
    return { ok: true, command: step.resultCommand, value: result.value }
  } catch (error) {
    return { ok: false, command: step.resultCommand, error: error instanceof Error ? error.message : String(error) }
  }
}

function createCommandFallbackRegistry(command: string, executeCommand: ResultHandoffDeps["executeCommand"]): ActionRegistry {
  const registry = new ActionRegistry()
  if (executeCommand) {
    registry.register({
      id: command,
      execute: (input) => {
        const args = Array.isArray(input.args) ? input.args : input.args === undefined ? [] : [input.args]
        return executeCommand(command, ...args)
      }
    })
  }
  return registry
}

function textContent(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  return undefined
}

function commandReportedError(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  if (record.status !== "error" && record.valid !== false) return undefined
  const issues = Array.isArray(record.issues)
    ? record.issues.map(formatIssue).filter(Boolean).join("; ")
    : undefined
  return issues
    ? `result command reported an error: ${issues}`
    : "result command reported an error."
}

function formatIssue(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined
  const issue = value as Record<string, unknown>
  const path = typeof issue.path === "string" ? issue.path : "$"
  const message = typeof issue.message === "string" ? issue.message : "validation failed"
  return `${path}: ${message}`
}
