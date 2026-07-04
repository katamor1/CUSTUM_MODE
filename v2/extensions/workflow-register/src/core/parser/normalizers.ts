import {
  EngineStep,
  ResultSinkDefinition,
  ResultSourceDefinition,
  WorkflowBranchingDefinition,
  WorkflowInputDefinition,
  WorkflowManualApprovalDefinition,
  WorkflowManualFormDefinition,
  WorkflowStepCompletionMode,
  WorkflowStepExecutionDefinition,
  WorkflowStepExecutionMode,
  WorkflowStepMessageMode,
  WorkflowStepReviewDefinition,
  WorkflowStepReviewPauseAfter,
  WorkflowStepTransitionDefinition,
  WorkflowTransitionConditionDefinition,
  WorkflowUserActionDefinition
} from "../model"
import { asRecord, listField, optionalBoolean, optionalNumber, optionalString, requiredString } from "./yamlFields"

export function stepCompletion(fields: Record<string, unknown>, fallback: WorkflowStepCompletionMode): WorkflowStepCompletionMode {
  const value = optionalString(fields, "stepCompletion")
  return value === "auto" || value === "manual" ? value : fallback
}

export function stepMessage(fields: Record<string, unknown>, fallback: WorkflowStepMessageMode): WorkflowStepMessageMode {
  const value = optionalString(fields, "stepMessage")
  return value === "full" || value === "current" || value === "silent" || value === "step" ? value : fallback
}

export function normalizeStepExecution(value: unknown, fallbackMode: WorkflowStepExecutionMode): WorkflowStepExecutionDefinition {
  const record = asRecord(value)
  const mode = stepExecutionMode(optionalString(record, "mode"), fallbackMode)
  return {
    mode,
    allowOutOfOrder: optionalBoolean(record, "allowOutOfOrder") ?? false,
    showInBob: optionalBoolean(record, "showInBob") ?? true
  }
}

function stepExecutionMode(value: string | undefined, fallback: WorkflowStepExecutionMode): WorkflowStepExecutionMode {
  return value === "full" || value === "todo" || value === "engineSteps" ? value : fallback
}

export function normalizeStepReview(value: unknown, stepCompletionValue: WorkflowStepCompletionMode): WorkflowStepReviewDefinition {
  const record = asRecord(value)
  const enabled = optionalBoolean(record, "enabled") ?? stepCompletionValue === "manual"
  const pauseAfter = stepReviewPauseAfter(optionalString(record, "pauseAfter"), enabled ? "everyStep" : "none")
  return {
    enabled,
    pauseAfter,
    requireAcceptBeforeNext: optionalBoolean(record, "requireAcceptBeforeNext") ?? enabled,
    allowRetry: optionalBoolean(record, "allowRetry") ?? true,
    allowEditBeforeRetry: optionalBoolean(record, "allowEditBeforeRetry") ?? true,
    preserveAttempts: optionalBoolean(record, "preserveAttempts") ?? true
  }
}

function stepReviewPauseAfter(value: string | undefined, fallback: WorkflowStepReviewPauseAfter): WorkflowStepReviewPauseAfter {
  return value === "everyStep" || value === "agentAndCommand" || value === "none" ? value : fallback
}

export function normalizeInputs(inputs: Record<string, unknown>): Record<string, WorkflowInputDefinition> {
  const output: Record<string, WorkflowInputDefinition> = {}
  for (const [key, value] of Object.entries(inputs)) {
    const record = asRecord(value)
    output[key] = {
      type: requiredString(record, "type") as WorkflowInputDefinition["type"],
      title: optionalString(record, "title"),
      required: optionalBoolean(record, "required"),
      requiredWhen: optionalString(record, "requiredWhen"),
      prompt: optionalBoolean(record, "prompt"),
      default: record.default,
      options: listField(record, "options")
    }
  }
  return output
}

export function normalizeRequires(record: Record<string, unknown>) {
  const bob = asRecord(record.bob)
  return {
    workspace: optionalBoolean(record, "workspace"),
    bob: Object.keys(bob).length > 0 ? { minVersion: optionalString(bob, "minVersion") } : undefined,
    files: listField(record, "files")
  }
}

export function normalizePreflight(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    const record = asRecord(entry)
    return {
      id: requiredString(record, "id"),
      title: optionalString(record, "title"),
      required: optionalBoolean(record, "required"),
      checks: listField(record, "checks"),
      files: listField(record, "files"),
      failurePolicy: optionalString(record, "failurePolicy") as "stop" | "continue" | "warn" | undefined
    }
  })
}

export function normalizeTools(tools: Record<string, unknown>) {
  const output: Record<string, { purpose?: string; required?: boolean; outputKey?: string; inputSource?: string; failurePolicy?: "stop" | "continue" | "warn" }> = {}
  for (const [key, value] of Object.entries(tools)) {
    const record = asRecord(value)
    output[key] = {
      purpose: optionalString(record, "purpose"),
      required: optionalBoolean(record, "required"),
      outputKey: optionalString(record, "outputKey"),
      inputSource: optionalString(record, "inputSource"),
      failurePolicy: optionalString(record, "failurePolicy") as "stop" | "continue" | "warn" | undefined
    }
  }
  return output
}

export function normalizeGuardrails(record: Record<string, unknown>) {
  const approvals = Array.isArray(record.requireApproval) ? record.requireApproval : []
  return {
    allowedCommands: listField(record, "allowedCommands"),
    deniedCommands: listField(record, "deniedCommands"),
    allowedCommandIds: listField(record, "allowedCommandIds"),
    deniedCommandIds: listField(record, "deniedCommandIds"),
    requireApproval: approvals.map((approval) => {
      const approvalRecord = asRecord(approval)
      return { id: optionalString(approvalRecord, "id"), when: optionalString(approvalRecord, "when"), message: optionalString(approvalRecord, "message") }
    })
  }
}

export function normalizeArtifacts(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    const record = asRecord(entry)
    return { id: requiredString(record, "id"), producedBy: optionalString(record, "producedBy"), path: requiredString(record, "path"), schema: optionalString(record, "schema") }
  })
}

export function normalizeCompletion(record: Record<string, unknown>) {
  const visualization = asRecord(record.visualization)
  return {
    summary: optionalString(record, "summary"),
    includeArtifacts: optionalBoolean(record, "includeArtifacts"),
    validateResult: optionalBoolean(record, "validateResult"),
    visualization: Object.keys(visualization).length > 0 ? { type: optionalString(visualization, "type"), enabled: optionalBoolean(visualization, "enabled") } : undefined
  }
}

export function normalizeBranching(value: unknown): WorkflowBranchingDefinition | undefined {
  const record = asRecord(value)
  if (Object.keys(record).length === 0) return undefined
  const loops = Array.isArray(record.loops) ? record.loops.map((entry) => {
    const loop = asRecord(entry)
    const checkpoint = asRecord(loop.checkpoint)
    return {
      id: requiredString(loop, "id"),
      title: optionalString(loop, "title"),
      entryStep: requiredString(loop, "entryStep"),
      maxIterations: optionalNumber(loop, "maxIterations") ?? 0,
      extensionSize: optionalNumber(loop, "extensionSize") ?? 0,
      checkpoint: Object.keys(checkpoint).length > 0 ? {
        title: optionalString(checkpoint, "title"),
        message: optionalString(checkpoint, "message")
      } : undefined
    }
  }) : []
  return {
    enabled: optionalBoolean(record, "enabled") ?? false,
    loops
  }
}

export function normalizeEngineStep(step: Record<string, unknown>): EngineStep {
  const base = {
    id: requiredString(step, "id"),
    title: requiredString(step, "title"),
    required: optionalBoolean(step, "required"),
    prompt: optionalString(step, "prompt"),
    sendResult: optionalBoolean(step, "sendResult"),
    completeOnSuccess: optionalBoolean(step, "completeOnSuccess"),
    includeState: listField(step, "includeState"),
    maxResultBytes: optionalNumber(step, "maxResultBytes"),
    stateRequired: optionalBoolean(step, "stateRequired"),
    transition: normalizeStepTransition(step.transition),
    userAction: normalizeUserAction(step.userAction)
  }
  if (step.type === "command") {
    const action = asRecord(step.action)
    return { ...base, type: "command", action: { provider: requiredString(action, "provider"), args: action.args }, resultKey: optionalString(step, "resultKey") }
  }
  if (step.type === "agent") return { ...base, type: "agent", resultKey: optionalString(step, "resultKey"), result: step.result ? normalizeResult(step.result) : undefined }
  if (step.type === "result") return { ...base, type: "result", result: normalizeResult(step.result) }
  return {
    ...base,
    type: "manual",
    form: normalizeManualForm(step.form),
    approval: normalizeManualApproval(step.approval)
  }
}

function normalizeStepTransition(value: unknown): WorkflowStepTransitionDefinition | undefined {
  const record = asRecord(value)
  if (Object.keys(record).length === 0) return undefined
  const decisions = Array.isArray(record.decisions) ? record.decisions.map((entry) => {
    const decision = asRecord(entry)
    return {
      id: requiredString(decision, "id"),
      when: normalizeTransitionCondition(decision.when),
      goto: requiredString(decision, "goto"),
      loop: optionalString(decision, "loop")
    }
  }) : []
  return {
    decisions,
    default: optionalString(record, "default") ?? "next"
  }
}

function normalizeTransitionCondition(value: unknown): WorkflowTransitionConditionDefinition {
  const record = asRecord(value)
  return {
    stateKey: requiredString(record, "stateKey"),
    equals: record.equals,
    notEquals: record.notEquals,
    in: Array.isArray(record.in) ? record.in : undefined,
    exists: optionalBoolean(record, "exists"),
    truthy: optionalBoolean(record, "truthy")
  }
}

function normalizeManualForm(value: unknown): WorkflowManualFormDefinition | undefined {
  const record = asRecord(value)
  if (Object.keys(record).length === 0) return undefined
  const fields = Array.isArray(record.fields) ? record.fields.map((entry) => {
    const field = asRecord(entry)
    return {
      id: requiredString(field, "id"),
      title: optionalString(field, "title"),
      type: requiredString(field, "type") as "string" | "number" | "boolean" | "select",
      required: optionalBoolean(field, "required"),
      multiline: optionalBoolean(field, "multiline"),
      options: listField(field, "options")
    }
  }) : []
  return {
    resultKey: requiredString(record, "resultKey"),
    fields
  }
}

function normalizeManualApproval(value: unknown): WorkflowManualApprovalDefinition | undefined {
  const record = asRecord(value)
  if (Object.keys(record).length === 0) return undefined
  return {
    resultKey: requiredString(record, "resultKey"),
    approveLabel: optionalString(record, "approveLabel"),
    rejectLabel: optionalString(record, "rejectLabel"),
    message: optionalString(record, "message")
  }
}

export function normalizeUserAction(value: unknown): WorkflowUserActionDefinition | undefined {
  const record = asRecord(value)
  const normalized = {
    message: optionalString(record, "message"),
    completeLabel: optionalString(record, "completeLabel"),
    confirmOnComplete: optionalBoolean(record, "confirmOnComplete"),
    confirmMessage: optionalString(record, "confirmMessage")
  }
  return Object.values(normalized).some((entry) => entry !== undefined) ? normalized : undefined
}

export function normalizeResult(value: unknown): ResultSourceDefinition {
  const record = asRecord(value)
  const sinks = Array.isArray(record.sinks) ? record.sinks.map((sink) => normalizeSink(asRecord(sink))) : []
  if (record.source === "state") return { source: "state", stateKey: requiredString(record, "stateKey"), sinks }
  if (record.source === "literal") return { source: "literal", text: requiredString(record, "text"), sinks }
  return { source: "agent", sinks }
}

export function normalizeSink(record: Record<string, unknown>): ResultSinkDefinition {
  if (record.type === "command") return { type: "command", command: requiredString(record, "command"), args: listField(record, "args") }
  return { type: "file", path: requiredString(record, "path"), encoding: optionalString(record, "encoding") as BufferEncoding | undefined }
}
