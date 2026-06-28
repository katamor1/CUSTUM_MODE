import { WorkflowInputDefinition } from "./model"
import { isMissing, resolveWorkflowInputsToPrompt, validateInputType } from "./inputResolver"

export type WorkflowInputPrompt = (key: string, definition: WorkflowInputDefinition, required: boolean) => Promise<unknown>

export interface CollectWorkflowInputsOptions {
  inputs: Record<string, WorkflowInputDefinition>
  provided?: Record<string, unknown>
  prompt: WorkflowInputPrompt
}

export async function collectWorkflowInputsWithResolver(options: CollectWorkflowInputsOptions): Promise<Record<string, unknown> | undefined> {
  const resolved: Record<string, unknown> = { ...(options.provided ?? {}) }
  for (;;) {
    const next = resolveWorkflowInputsToPrompt(options.inputs, resolved)
      .find((item) => item.prompt && isMissing(resolved[item.key]))
    if (!next) return resolved

    const value = await options.prompt(next.key, next.definition, next.required)
    if (value === undefined && next.required) return undefined
    if (value === undefined) {
      resolved[next.key] = ""
      continue
    }

    const typeProblem = validateInputType(next.key, next.definition, value)
    if (typeProblem) throw new Error(typeProblem)
    resolved[next.key] = value
  }
}
