import { CoreWorkflowDefinition, EngineStep, WorkflowArtifactDefinition, WorkflowRunState } from "../model"

export interface WorkflowTemplateContext {
  inputs: Record<string, unknown>
  state: Record<string, string>
  run: WorkflowRunState
  workflow: CoreWorkflowDefinition
  step: EngineStep
}

export function renderArtifactPath(artifact: WorkflowArtifactDefinition, context: WorkflowTemplateContext): string {
  return renderTemplate(artifact.path, context)
}

export function renderValue(value: unknown, context: WorkflowTemplateContext): unknown {
  if (typeof value === "string") return renderTemplate(value, context)
  if (Array.isArray(value)) return value.map((item) => renderValue(item, context))
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) output[key] = renderValue(item, context)
    return output
  }
  return value
}

export function renderTemplate(value: string, context: WorkflowTemplateContext): string {
  return value
    .replace(/\{\{\s*inputs\.([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, key) => String(context.inputs[key] ?? ""))
    .replace(/\{\{\s*state\.([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, key) => String(context.state[key] ?? ""))
    .replace(/\{\{\s*run\.id\s*\}\}/g, context.run.runId)
    .replace(/\{\{\s*workflow\.id\s*\}\}/g, context.workflow.id)
    .replace(/\{\{\s*step\.id\s*\}\}/g, context.step.id)
    .replace(/\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g, (match, key) => placeholderValue(key, context) ?? match)
}

function placeholderValue(key: string, context: { inputs: Record<string, unknown>; state: Record<string, string> }): string | undefined {
  if (Object.prototype.hasOwnProperty.call(context.inputs, key)) return formatTemplateValue(context.inputs[key])
  if (Object.prototype.hasOwnProperty.call(context.state, key)) return context.state[key]
  for (const value of Object.values(context.state)) {
    const parsed = parseJsonObjectFromText(value)
    if (!parsed || !Object.prototype.hasOwnProperty.call(parsed, key)) continue
    return formatTemplateValue(parsed[key])
  }
  return undefined
}

function parseJsonObjectFromText(value: string): Record<string, unknown> | undefined {
  const parsed = parseJsonObject(value)
  if (parsed) return parsed
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return fenced ? parseJsonObject(fenced[1]) : undefined
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function formatTemplateValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}

export function formatStateValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value)
}

export function replacementResultText(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  for (const key of ["jsonText", "artifactText", "resultText"]) {
    if (typeof record[key] === "string") return record[key] as string
  }
  return undefined
}
