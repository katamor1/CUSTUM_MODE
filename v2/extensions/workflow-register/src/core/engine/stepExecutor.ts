import type { ActionRegistry } from "../actionRegistry"
import {
  findCommandApprovalRequirement,
  markApprovalRequired
} from "../approvalGuardrails"
import { validateCommandGuardrails } from "../guardrails"
import type {
  AgentProvider,
  CoreWorkflowDefinition,
  EngineStep,
  WorkflowCommandResultMetadata,
  WorkflowProviderArtifactMetadata,
  WorkflowRunState
} from "../model"
import { reportedActionError } from "../reportedActionError"
import type { ResultSinkRegistry } from "../resultSinkRegistry"
import { reservedWorkflowStateKeyError } from "../stateKeys"
import type { WorkflowEngineEventInput, WorkflowEngineOptions } from "../engineTypes"
import { takeRetryResultRecoveryReason } from "./recoveryState"
import {
  formatStateValue,
  renderTemplate,
  renderValue
} from "./templateRenderer"
import { writeResultSinks } from "./resultWriters"

type RecoverResultText = NonNullable<WorkflowEngineOptions["recoverResultText"]>
type EngineEmitter = (input: WorkflowEngineEventInput) => Promise<void>
export interface StagedCommandResult {
  commandValue: unknown
  stateUpdates: Record<string, string>
}

export type AutomatedStepResult =
  | {
    ok: true
    providerArtifacts?: WorkflowProviderArtifactMetadata[]
    stagedCommandResult?: StagedCommandResult
  }
  | { ok: false; held?: boolean; error: string }

export async function executeAutomatedStep(input: {
  workflow: CoreWorkflowDefinition
  run: WorkflowRunState
  step: EngineStep
  actions: ActionRegistry
  resultSinks: ResultSinkRegistry
  agentProvider?: AgentProvider
  recoverResultText?: RecoverResultText
  emitAgentOutput: EngineEmitter
  emitHandoffFailed: EngineEmitter
}): Promise<AutomatedStepResult> {
  const { workflow, run, step } = input
  if (step.type === "agent") return executeAgentStep({ ...input, step })
  if (step.type === "command") return executeCommandStep({ ...input, step })
  if (step.type !== "result") return { ok: false, error: `Unsupported workflow step type: ${step.type}` }
  return writeResultSinks({
    workflow,
    run,
    step,
    result: step.result,
    resultSinks: input.resultSinks,
    recoverResultText: input.recoverResultText,
    emitHandoffFailed: input.emitHandoffFailed
  })
}

async function executeAgentStep(input: {
  workflow: CoreWorkflowDefinition
  run: WorkflowRunState
  step: Extract<EngineStep, { type: "agent" }>
  resultSinks: ResultSinkRegistry
  agentProvider?: AgentProvider
  recoverResultText?: RecoverResultText
  emitAgentOutput: EngineEmitter
  emitHandoffFailed: EngineEmitter
}): Promise<AutomatedStepResult> {
  const { workflow, run, step } = input
  const stateKeyError = step.resultKey ? reservedWorkflowStateKeyError(step.resultKey, "workflow resultKey") : undefined
  if (stateKeyError) return { ok: false, error: stateKeyError }
  try {
    let agentText = step.resultKey ? run.state[step.resultKey] : undefined
    if (agentText === undefined) {
      const recoveryReason = takeRetryResultRecoveryReason(run, step)
      if (recoveryReason) {
        agentText = await input.recoverResultText?.({ workflow, run, step, reason: recoveryReason })
      }
    }
    if (agentText === undefined) {
      if (!input.agentProvider) return { ok: false, error: "Agent provider is required for agent workflow steps." }
      const prompt = renderTemplate(step.prompt ?? "", { inputs: run.inputs, state: run.state, run, workflow, step })
      agentText = await Promise.resolve(input.agentProvider.run({
        workflowId: workflow.id,
        logicalWorkflowId: workflow.logicalWorkflowId,
        workflowRoot: workflow.workflowRoot,
        workflowFile: workflow.workflowFile,
        workflowFolderName: workflow.workflowFolderName,
        runId: run.runId,
        stepId: step.id,
        prompt,
        inputs: run.inputs,
        state: run.state
      }))
    }
    if (step.resultKey) run.state[step.resultKey] = agentText
    await input.emitAgentOutput({ workflow, run, step, agentText })
    if (step.result) {
      return writeResultSinks({
        workflow,
        run,
        step,
        result: step.result,
        agentText,
        resultSinks: input.resultSinks,
        recoverResultText: input.recoverResultText,
        emitHandoffFailed: input.emitHandoffFailed
      })
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function executeCommandStep(input: {
  workflow: CoreWorkflowDefinition
  run: WorkflowRunState
  step: Extract<EngineStep, { type: "command" }>
  actions: ActionRegistry
}): Promise<AutomatedStepResult> {
  const { workflow, run, step } = input
  const stateKeyError = step.resultKey ? reservedWorkflowStateKeyError(step.resultKey, "workflow resultKey") : undefined
  if (stateKeyError) return { ok: false, error: stateKeyError }
  const args = renderValue(step.action.args, { inputs: run.inputs, state: run.state, run, workflow, step })
  // renderValue 後の args が実際の実行値なので、承認・guardrails はテンプレート展開後に評価する。
  const guardrail = validateCommandGuardrails(workflow, step.action.provider, args)
  if (guardrail) return { ok: false, error: guardrail }
  const approval = findCommandApprovalRequirement({
    workflow,
    run,
    step,
    providerId: step.action.provider,
    args
  })
  if (approval && "error" in approval) return { ok: false, error: approval.error }
  if (approval) {
    markApprovalRequired(run, step.id, approval)
    return { ok: false, held: true, error: approval.message }
  }
  const result = await input.actions.execute(step.action.provider, {
    args,
    inputs: run.inputs,
    state: run.state,
    workflowId: workflow.id,
    logicalWorkflowId: workflow.logicalWorkflowId,
    workflowRoot: workflow.workflowRoot,
    workflowFile: workflow.workflowFile,
    workflowFolderName: workflow.workflowFolderName,
    runId: run.runId,
    stepId: step.id
  })
  if (!result.ok) return { ok: false, error: result.error ?? `Action provider failed: ${step.action.provider}` }
  const actionError = reportedActionError(result.value)
  if (actionError) return { ok: false, error: actionError }
  const commandResult = splitWorkflowCommandResult(result.value)
  if (!commandResult.ok) return commandResult
  return {
    ok: true,
    providerArtifacts: commandResult.providerArtifacts,
    stagedCommandResult: {
      commandValue: commandResult.payload,
      stateUpdates: step.resultKey ? { [step.resultKey]: formatStateValue(commandResult.payload) } : {}
    }
  }
}

function splitWorkflowCommandResult(value: unknown): {
  ok: true
  payload: unknown
  providerArtifacts?: WorkflowProviderArtifactMetadata[]
} | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("$workflow" in value)) {
    return { ok: true, payload: value }
  }
  const record = value as Record<string, unknown>
  if (!isRecord(record.$workflow)) {
    return { ok: false, error: "Command result $workflow metadata must be an object." }
  }
  const workflowMetadata = record.$workflow as Partial<WorkflowCommandResultMetadata>
  if (!Array.isArray(workflowMetadata.artifacts)) {
    return { ok: false, error: "Command result $workflow.artifacts must be an array." }
  }
  const providerArtifacts: WorkflowProviderArtifactMetadata[] = []
  const ids = new Set<string>()
  for (let index = 0; index < workflowMetadata.artifacts.length; index += 1) {
    const candidate = workflowMetadata.artifacts[index] as unknown
    if (!isRecord(candidate)) {
      return { ok: false, error: `Command result $workflow.artifacts[${index}] must be an object.` }
    }
    if (typeof candidate.id !== "string" || !candidate.id.trim()) {
      return { ok: false, error: `Command result $workflow.artifacts[${index}].id must be a non-empty string.` }
    }
    const id = candidate.id.trim()
    if (candidate.ownership !== "provider") {
      return { ok: false, error: `Command result $workflow.artifacts[${index}].ownership must be 'provider'.` }
    }
    if (typeof candidate.path !== "string" || !candidate.path.trim()) {
      return { ok: false, error: `Command result $workflow.artifacts[${index}].path must be a non-empty string.` }
    }
    if (ids.has(id)) {
      return { ok: false, error: `Command result has duplicate provider artifact metadata id '${id}'.` }
    }
    ids.add(id)
    providerArtifacts.push({ id, ownership: "provider", path: candidate.path })
  }
  const { $workflow: _metadata, ...payload } = record
  return { ok: true, payload, providerArtifacts }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
