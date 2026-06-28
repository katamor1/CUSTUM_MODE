import { WorkflowDiagnosticExplanation, WorkflowDiagnosticExplanationItem, WorkflowRepairProposal } from "./workflowAiProvider"
import { WorkflowDesignDraft } from "./workflowDesignDraft"
import { workflowTemplates, WorkflowTemplateKind } from "./workflowScaffold"

const MAX_TEXT_LENGTH = 200_000
const knownTemplates: ReadonlySet<string> = new Set(workflowTemplates.map((template) => template.id))

export interface ProviderValidationResult<T> {
  ok: boolean
  value?: T
  errors: string[]
}

export function validateWorkflowAiDesignOutput(value: unknown): ProviderValidationResult<WorkflowDesignDraft> {
  const errors: string[] = []
  const record = asRecord(value)
  if (!record) return fail("AI design output must be an object.")
  const name = stringValue(record.name)
  const title = optionalStringValue(record.title)
  const description = stringValue(record.description)
  const template = optionalStringValue(record.template)
  if (!name) errors.push("AI design output must include a non-empty name.")
  if (!description) errors.push("AI design output must include a non-empty description.")
  if (template && !knownTemplates.has(template)) errors.push(`AI design output uses unknown template '${template}'.`)
  const notes = optionalStringArray(record.notes, "notes", errors)
  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    errors: [],
    value: {
      name,
      ...(title ? { title } : {}),
      description,
      ...(template ? { template: template as WorkflowTemplateKind } : {}),
      ...(notes ? { notes } : {})
    }
  }
}

export function validateWorkflowAiRepairOutput(value: unknown): ProviderValidationResult<WorkflowRepairProposal> {
  const errors: string[] = []
  const record = asRecord(value)
  if (!record) return fail("AI repair output must be an object.")
  const summary = stringValue(record.summary) || "AI repair provider returned no summary."
  const notes = optionalStringArray(record.notes, "notes", errors) ?? []
  const replacementMarkdown = optionalLongString(record.replacementMarkdown, "replacementMarkdown", errors)
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, errors: [], value: { summary, notes, ...(replacementMarkdown ? { replacementMarkdown } : {}) } }
}

export function validateWorkflowAiExplainOutput(value: unknown): ProviderValidationResult<WorkflowDiagnosticExplanation> {
  const errors: string[] = []
  const record = asRecord(value)
  if (!record) return fail("AI explanation output must be an object.")
  const summary = stringValue(record.summary) || "AI diagnostic provider returned no summary."
  const rawItems = record.items
  if (rawItems !== undefined && !Array.isArray(rawItems)) errors.push("AI explanation output field 'items' must be an array.")
  const items: WorkflowDiagnosticExplanationItem[] = []
  if (Array.isArray(rawItems)) {
    for (const [index, rawItem] of rawItems.entries()) {
      const item = asRecord(rawItem)
      if (!item) {
        errors.push(`AI explanation item ${index} must be an object.`)
        continue
      }
      const message = stringValue(item.message)
      const explanation = stringValue(item.explanation)
      if (!message) errors.push(`AI explanation item ${index} must include a non-empty message.`)
      if (!explanation) errors.push(`AI explanation item ${index} must include a non-empty explanation.`)
      if (message && explanation) {
        const likelyFix = optionalLongString(item.likelyFix, `items[${index}].likelyFix`, errors)
        const repairTarget = optionalLongString(item.repairTarget, `items[${index}].repairTarget`, errors)
        items.push({ message, explanation, ...(likelyFix ? { likelyFix } : {}), ...(repairTarget ? { repairTarget } : {}) })
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, errors: [], value: { summary, items } }
}

function fail<T>(message: string): ProviderValidationResult<T> {
  return { ok: false, errors: [message] }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function stringValue(value: unknown): string {
  return typeof value === "string" && value.trim() ? truncateText(value.trim()) : ""
}

function optionalStringValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  return typeof value === "string" && value.trim() ? truncateText(value.trim()) : undefined
}

function optionalLongString(value: unknown, field: string, errors: string[]): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== "string") {
    errors.push(`AI provider field '${field}' must be a string.`)
    return undefined
  }
  return truncateText(value)
}

function optionalStringArray(value: unknown, field: string, errors: string[]): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) {
    errors.push(`AI provider field '${field}' must be an array of strings.`)
    return undefined
  }
  const output: string[] = []
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string") {
      errors.push(`AI provider field '${field}[${index}]' must be a string.`)
      continue
    }
    output.push(truncateText(item))
  }
  return output
}

function truncateText(value: string): string {
  return value.length > MAX_TEXT_LENGTH ? value.slice(0, MAX_TEXT_LENGTH) : value
}
