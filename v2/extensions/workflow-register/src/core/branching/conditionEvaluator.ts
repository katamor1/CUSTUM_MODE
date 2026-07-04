import type { WorkflowTransitionConditionDefinition } from "../model"

export interface ConditionEvaluationResult {
  matched: boolean
  snapshot: {
    stateKey: string
    value?: unknown
  }
}

export function evaluateTransitionCondition(
  condition: WorkflowTransitionConditionDefinition,
  state: Record<string, string>
): ConditionEvaluationResult {
  const value = resolveStateValue(state, condition.stateKey)
  const snapshot = { stateKey: condition.stateKey, value }
  if (condition.equals !== undefined) return { matched: jsonEqual(value, condition.equals), snapshot }
  if (condition.notEquals !== undefined) return { matched: !jsonEqual(value, condition.notEquals), snapshot }
  if (condition.in !== undefined) return { matched: condition.in.some((item) => jsonEqual(value, item)), snapshot }
  if (condition.exists !== undefined) return { matched: (value !== undefined) === condition.exists, snapshot }
  if (condition.truthy !== undefined) return { matched: Boolean(value) === condition.truthy, snapshot }
  return { matched: false, snapshot }
}

function resolveStateValue(state: Record<string, string>, stateKey: string): unknown {
  const [rootKey, ...path] = stateKey.split(".")
  if (!rootKey) return undefined
  const raw = state[rootKey]
  if (raw === undefined) return undefined
  let current: unknown = parseJsonOrString(raw)
  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function parseJsonOrString(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
