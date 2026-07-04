import { WorkflowInputDefinition } from "./model"
import { isMissing, matchesRequiredWhen, resolveWorkflowInputsToPrompt, validateInputType } from "./inputResolver"

export type WorkflowInputPrompt = (key: string, definition: WorkflowInputDefinition, required: boolean) => Promise<unknown>

export interface CollectWorkflowInputsOptions {
  inputs: Record<string, WorkflowInputDefinition>
  provided?: Record<string, unknown>
  prompt: WorkflowInputPrompt
}

export async function collectWorkflowInputsWithResolver(options: CollectWorkflowInputsOptions): Promise<Record<string, unknown> | undefined> {
  const defaults = withDefaults(options.inputs, options.provided ?? {})
  const resolved: Record<string, unknown> = defaults.resolved
  const skippedOptional = new Set<string>(defaults.resolvedEmptyOptionalKeys)
  for (;;) {
    const next = resolveWorkflowInputsToPrompt(options.inputs, resolved)
      .find((item) => item.prompt && isMissing(resolved[item.key]) && !skippedOptional.has(item.key))
    if (!next) return resolved

    const value = await options.prompt(next.key, next.definition, next.required)
    if (value === undefined && next.required) return undefined
    if (value === undefined) {
      skippedOptional.add(next.key)
      continue
    }

    const typeProblem = validateInputType(next.key, next.definition, value)
    if (typeProblem) throw new Error(typeProblem)
    resolved[next.key] = value
  }
}

function withDefaults(
  inputs: Record<string, WorkflowInputDefinition>,
  provided: Record<string, unknown>
): { resolved: Record<string, unknown>; resolvedEmptyOptionalKeys: string[] } {
  const resolved: Record<string, unknown> = { ...provided }
  const resolvedEmptyOptionalKeys: string[] = []
  for (const [key, definition] of Object.entries(inputs)) {
    if (!isMissing(resolved[key])) continue
    if (definition.default === undefined) continue
    const value = coerceDefaultValue(definition)
    const typeProblem = validateInputType(key, definition, value)
    if (typeProblem) throw new Error(typeProblem)
    resolved[key] = value
    const required = definition.required === true || matchesRequiredWhen(definition, resolved)
    if (!required && isMissing(value)) resolvedEmptyOptionalKeys.push(key)
  }
  return { resolved, resolvedEmptyOptionalKeys }
}

function coerceDefaultValue(definition: WorkflowInputDefinition): unknown {
  if (definition.type === "number") return typeof definition.default === "number" ? definition.default : Number(definition.default)
  if (definition.type === "boolean") {
    if (typeof definition.default === "boolean") return definition.default
    return String(definition.default).toLowerCase() === "true"
  }
  return definition.default
}
