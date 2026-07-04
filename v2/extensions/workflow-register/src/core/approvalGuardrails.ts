import type {
  CoreWorkflowDefinition,
  EngineStep,
  WorkflowApprovalRuleDefinition,
  WorkflowRunState
} from "./model"

const APPROVAL_STATE_PREFIX = "workflow.approval."

type ApprovalComparisonOperator = "==" | "!=" | ">" | ">=" | "<" | "<="

type ApprovalExpression =
  | { kind: "always" }
  | { kind: "command" }
  | { kind: "providerEquals"; value: string }
  | { kind: "commandIdEquals"; value: string }
  | { kind: "stepIdEquals"; value: string }
  | { kind: "knownNonCommand" }
  | { kind: "comparison"; path: string; operator: ApprovalComparisonOperator; value: string | number }

export interface CommandApprovalRequirement {
  rule: WorkflowApprovalRuleDefinition
  message: string
}

export function findCommandApprovalRequirement(input: {
  workflow: CoreWorkflowDefinition
  run: WorkflowRunState
  step: Extract<EngineStep, { type: "command" }>
  providerId: string
  args: unknown
}): CommandApprovalRequirement | { error: string } | undefined {
  for (const rule of input.workflow.guardrails?.requireApproval ?? []) {
    const parsed = parseApprovalExpression(rule.when)
    if (!parsed.ok) return { error: unsupportedApprovalExpressionMessage(rule, parsed.error) }
    if (!approvalExpressionMatches(parsed.expression, input)) continue
    if (approvalAlreadyGranted(input.run, input.step.id, rule)) continue
    return {
      rule,
      message: approvalRequiredMessage(rule)
    }
  }
  return undefined
}

export function markApprovalRequired(run: WorkflowRunState, stepId: string, requirement: CommandApprovalRequirement): void {
  run.state[approvalStateKey(stepId)] = JSON.stringify({
    status: "required",
    ruleId: requirement.rule.id,
    message: requirement.message,
    requestedAt: new Date().toISOString()
  })
}

export function approveHeldWorkflowStep(run: WorkflowRunState, stepId: string): boolean {
  const state = readApprovalState(run, stepId)
  if (state?.status !== "required") return false
  run.state[approvalStateKey(stepId)] = JSON.stringify({
    ...state,
    status: "approved",
    approvedAt: new Date().toISOString()
  })
  return true
}

export function validateApprovalExpression(expression: string | undefined): string | undefined {
  const parsed = parseApprovalExpression(expression)
  return parsed.ok ? undefined : parsed.error
}

function parseApprovalExpression(expression: string | undefined): { ok: true; expression: ApprovalExpression } | { ok: false; error: string } {
  const trimmed = expression?.trim()
  if (!trimmed) return { ok: true, expression: { kind: "always" } }
  if (trimmed === "command.requiresApproval" || trimmed === "before-command") return { ok: true, expression: { kind: "command" } }
  if (trimmed === "artifact.externalOutput") return { ok: true, expression: { kind: "knownNonCommand" } }
  if (trimmed === "sink.type == 'file'" || trimmed === 'sink.type == "file"') return { ok: true, expression: { kind: "knownNonCommand" } }

  const equality = trimmed.match(/^(provider|command\.provider|commandId|command\.id|step\.id)\s*==\s*(['"])(.*?)\2$/)
  if (equality) {
    const [, field, , value] = equality
    if (field === "provider" || field === "command.provider") return { ok: true, expression: { kind: "providerEquals", value } }
    if (field === "commandId" || field === "command.id") return { ok: true, expression: { kind: "commandIdEquals", value } }
    return { ok: true, expression: { kind: "stepIdEquals", value } }
  }

  const pathMatch = trimmed.match(/^path\s+matches\s*(['"])(.*?)\1$/)
  if (pathMatch) return { ok: true, expression: { kind: "knownNonCommand" } }

  const comparison = trimmed.match(/^([A-Za-z0-9_.-]+)\s*(==|!=|>=|<=|>|<)\s*(?:(['"])(.*?)\3|(-?\d+(?:\.\d+)?))$/)
  if (comparison) {
    const [, path, operator, , stringValue, numberValue] = comparison
    return {
      ok: true,
      expression: {
        kind: "comparison",
        path,
        operator: operator as ApprovalComparisonOperator,
        value: numberValue === undefined ? stringValue : Number(numberValue)
      }
    }
  }

  return { ok: false, error: `Unsupported approval guardrail expression: ${trimmed}` }
}

function approvalExpressionMatches(expression: ApprovalExpression, input: {
  run: WorkflowRunState
  step: Extract<EngineStep, { type: "command" }>
  providerId: string
  args: unknown
}): boolean {
  switch (expression.kind) {
    case "always":
    case "command":
      return true
    case "providerEquals":
      return input.providerId === expression.value
    case "commandIdEquals":
      return firstArgument(input.args) === expression.value
    case "stepIdEquals":
      return input.step.id === expression.value
    case "knownNonCommand":
      return false
    case "comparison":
      return compareValues(resolvePath(input.run, input.step, expression.path), expression.operator, expression.value)
  }
}

function compareValues(actual: unknown, operator: ApprovalComparisonOperator, expected: string | number): boolean {
  if (typeof expected === "number") {
    const actualNumber = typeof actual === "number" ? actual : Number(actual)
    if (!Number.isFinite(actualNumber)) return false
    if (operator === ">") return actualNumber > expected
    if (operator === ">=") return actualNumber >= expected
    if (operator === "<") return actualNumber < expected
    if (operator === "<=") return actualNumber <= expected
    if (operator === "==") return actualNumber === expected
    return actualNumber !== expected
  }
  const actualText = actual === undefined || actual === null ? "" : String(actual)
  return operator === "!=" ? actualText !== expected : operator === "==" && actualText === expected
}

function resolvePath(run: WorkflowRunState, step: EngineStep, pathExpression: string): unknown {
  const segments = pathExpression.split(".").filter(Boolean)
  const [first, ...rest] = segments
  if (!first) return undefined
  if (first === "inputs") return readPath(run.inputs, rest)
  if (first === "state") return readPath(run.state, rest)
  if (first === "step") return readPath(step, rest)
  if (first === "run") return readPath(run, rest)
  if (Object.prototype.hasOwnProperty.call(run.state, first)) return readPath(parseStateValue(run.state[first]), rest)
  if (Object.prototype.hasOwnProperty.call(run.inputs, first)) return readPath(run.inputs[first], rest)
  return undefined
}

function readPath(value: unknown, segments: string[]): unknown {
  let current = typeof value === "string" ? parseStateValue(value) : value
  for (const segment of segments) {
    if (typeof current === "string") current = parseStateValue(current)
    if (!current || typeof current !== "object") return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function parseStateValue(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function firstArgument(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value
}

function approvalAlreadyGranted(run: WorkflowRunState, stepId: string, rule: WorkflowApprovalRuleDefinition): boolean {
  const state = readApprovalState(run, stepId)
  if (state?.status !== "approved") return false
  return !rule.id || state.ruleId === rule.id
}

function readApprovalState(run: WorkflowRunState, stepId: string): Record<string, unknown> | undefined {
  const raw = run.state[approvalStateKey(stepId)]
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function approvalStateKey(stepId: string): string {
  return `${APPROVAL_STATE_PREFIX}${stepId}`
}

function approvalRequiredMessage(rule: WorkflowApprovalRuleDefinition): string {
  const id = rule.id ? ` '${rule.id}'` : ""
  return rule.message?.trim()
    ? `Approval required by workflow guardrail${id}: ${rule.message.trim()}`
    : `Approval required by workflow guardrail${id}.`
}

function unsupportedApprovalExpressionMessage(rule: WorkflowApprovalRuleDefinition, error: string): string {
  const id = rule.id ? ` '${rule.id}'` : ""
  return `Unsupported approval guardrail expression${id}: ${error}`
}
