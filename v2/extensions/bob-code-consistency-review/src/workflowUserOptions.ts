export const BLOCKED_WORKFLOW_OPTION_KEYS = [
  "bobRoot",
  "bzrPath",
  "diffFixturePath",
  "logicalWorkflowId",
  "runId",
  "stepId",
  "workflowFile",
  "workflowFolderName",
  "workflowId",
  "workflowRoot",
  "workspaceRoot"
] as const

export function buildSafeWorkflowOptions(input: {
  commandId: string
  inputs?: Record<string, unknown>
  args: unknown
  allowedKeys: readonly string[]
}): Record<string, unknown> {
  const blocked = new Set<string>(BLOCKED_WORKFLOW_OPTION_KEYS)
  const merged = {
    ...optionRecord(input.inputs),
    ...optionRecord(input.args)
  }
  const rejected = Object.keys(merged)
    .filter((key) => blocked.has(key))
    .sort()
  if (rejected.length > 0) {
    throw new Error(`${input.commandId} workflow options are not allowed: ${rejected.join(", ")}`)
  }

  const result: Record<string, unknown> = {}
  for (const key of input.allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(merged, key)) result[key] = merged[key]
  }
  return result
}

export function optionRecord(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return optionRecord(value[0])
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
}
