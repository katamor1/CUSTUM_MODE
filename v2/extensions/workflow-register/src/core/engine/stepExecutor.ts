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
  WorkflowRunState
} from "../model"
import { reportedActionError } from "../reportedActionError"
import type { ResultSinkRegistry } from "../resultSinkRegistry"
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

export async function executeAutomatedStep(input: {
  workflow: CoreWorkflowDefinition
  run: WorkflowRunState
  step: EngineStep
  actions: ActionRegistry
  resultSinks: ResultSinkRegistry
  agentProvider?: AgentProvider
  recoverResultText?: RecoverResultText
  emitAgentOutput: EngineEmitter
  emitCommandResult: EngineEmitter
  emitHandoffFailed: EngineEmitter
}): Promise<{ ok: true } | { ok: false; held?: boolean; error: string }> {
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
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { workflow, run, step } = input
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
  emitCommandResult: EngineEmitter
}): Promise<{ ok: true } | { ok: false; held?: boolean; error: string }> {
  const { workflow, run, step } = input
  const args = renderValue(step.action.args, { inputs: run.inputs, state: run.state, run, workflow, step })
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
  if (step.resultKey) run.state[step.resultKey] = formatStateValue(result.value)
  await input.emitCommandResult({ workflow, run, step, commandValue: result.value })
  return { ok: true }
}
