const RESERVED_WORKFLOW_STATE_PREFIX = "workflow."

export function isReservedWorkflowStateKey(key: string): boolean {
  const trimmed = key.trim()
  return trimmed === "workflow" || trimmed.startsWith(RESERVED_WORKFLOW_STATE_PREFIX)
}

export function reservedWorkflowStateKeyError(key: string, source: string): string | undefined {
  return isReservedWorkflowStateKey(key)
    ? `Reserved workflow state key cannot be written by ${source}: ${key}`
    : undefined
}

export function assertUserWritableStateKey(key: string, source: string): void {
  const error = reservedWorkflowStateKeyError(key, source)
  if (error) throw new Error(error)
}
