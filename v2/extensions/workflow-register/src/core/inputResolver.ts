import { WorkflowInputDefinition } from "./model"

export interface WorkflowInputResolution {
  key: string
  definition: WorkflowInputDefinition
  required: boolean
  prompt: boolean
  reason: string
}

export function resolveWorkflowInputsToPrompt(inputs: Record<string, WorkflowInputDefinition>, provided: Record<string, unknown>): WorkflowInputResolution[] {
  const resolved: WorkflowInputResolution[] = []
  for (const [key, definition] of Object.entries(inputs)) {
    const value = provided[key]
    const hasValue = !isMissing(value)
    const conditional = matchesRequiredWhen(definition, provided)
    const required = definition.required === true || conditional
    const promptEnabled = definition.prompt !== false
    if (hasValue) resolved.push({ key, definition, required, prompt: false, reason: "provided" })
    else if (!promptEnabled) resolved.push({ key, definition, required, prompt: false, reason: required ? "missing-required-prompt-disabled" : "prompt-disabled" })
    else if (required) resolved.push({ key, definition, required, prompt: true, reason: conditional ? "missing-conditional" : "missing-required" })
    else if (definition.requiredWhen) resolved.push({ key, definition, required, prompt: false, reason: "skipped-conditional" })
    else resolved.push({ key, definition, required, prompt: true, reason: "missing-optional" })
  }
  return resolved
}

export function validateWorkflowInputs(inputs: Record<string, WorkflowInputDefinition>, provided: Record<string, unknown>): string[] {
  const problems: string[] = []
  for (const [key, definition] of Object.entries(inputs)) {
    const value = provided[key]
    const required = definition.required === true || matchesRequiredWhen(definition, provided)
    if (required && isMissing(value)) problems.push(`Missing required workflow input: ${key}`)
    else if (!isMissing(value)) {
      const typeProblem = validateInputType(key, definition, value)
      if (typeProblem) problems.push(typeProblem)
    }
  }
  return problems
}

export function matchesRequiredWhen(definition: WorkflowInputDefinition, inputs: Record<string, unknown>): boolean {
  const expression = definition.requiredWhen
  if (!expression) return false
  const equals = expression.split(" == ")
  if (equals.length === 2) return String(inputs[fieldName(equals[0])] ?? "") === unquote(equals[1])
  const notEquals = expression.split(" != ")
  if (notEquals.length === 2) return String(inputs[fieldName(notEquals[0])] ?? "") !== unquote(notEquals[1])
  return false
}

export function validateInputType(key: string, definition: WorkflowInputDefinition, value: unknown): string | undefined {
  if (definition.type === "number" && (typeof value !== "number" || Number.isNaN(value))) return `Workflow input must be a number: ${key}`
  if (definition.type === "boolean" && typeof value !== "boolean") return `Workflow input must be a boolean: ${key}`
  if (definition.type === "select" && definition.options && !definition.options.includes(String(value))) return `Workflow input has an unsupported option: ${key}`
  return undefined
}

export function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === ""
}

function fieldName(value: string): string {
  return value.trim().replace(/^inputs\./, "")
}

function unquote(value: string): string {
  return value.trim().replace(/^["']/, "").replace(/["']$/, "")
}
