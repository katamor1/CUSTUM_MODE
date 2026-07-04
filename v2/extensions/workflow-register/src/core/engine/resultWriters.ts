import type {
  CoreWorkflowDefinition,
  EngineStep,
  ResultSourceDefinition,
  WorkflowRunState
} from "../model"
import type { ResultSinkRegistry } from "../resultSinkRegistry"
import type { WorkflowEngineEventInput, WorkflowEngineOptions } from "../engineTypes"
import { markResultHandoffFailed } from "./recoveryState"
import {
  renderArtifactPath,
  replacementResultText
} from "./templateRenderer"

type RecoverResultText = NonNullable<WorkflowEngineOptions["recoverResultText"]>
type HandoffEmitter = (input: WorkflowEngineEventInput) => Promise<void>

export async function writeResultSinks(input: {
  workflow: CoreWorkflowDefinition
  run: WorkflowRunState
  step: EngineStep
  result: ResultSourceDefinition
  resultSinks: ResultSinkRegistry
  recoverResultText?: RecoverResultText
  emitHandoffFailed: HandoffEmitter
  agentText?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { workflow, run, step, result, resultSinks, recoverResultText, emitHandoffFailed, agentText } = input
  try {
    const text = await resultText({ workflow, run, step, result, recoverResultText, agentText })
    for (const sink of result.sinks) {
      // result sink はファイル書き込みやコマンド連携を含む副作用境界なので、失敗は run state に記録して再開可能にする。
      const write = await resultSinks.write(sink, {
        workflowId: workflow.id,
        logicalWorkflowId: workflow.logicalWorkflowId,
        workflowRoot: workflow.workflowRoot,
        workflowFile: workflow.workflowFile,
        workflowFolderName: workflow.workflowFolderName,
        runId: run.runId,
        stepId: step.id,
        inputs: run.inputs,
        state: run.state,
        text
      })
      if (!write.ok) {
        const error = write.error ?? `Result sink failed: ${sink.type}`
        markResultHandoffFailed(run, step, error)
        await emitHandoffFailed({ workflow, run, step, agentText: text, error })
        return { ok: false, error }
      }
      const replacementText = replacementResultText(write.value)
      if (replacementText !== undefined && "resultKey" in step && step.resultKey) {
        run.state[step.resultKey] = replacementText
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    markResultHandoffFailed(run, step, message)
    await emitHandoffFailed({ workflow, run, step, agentText, error: message })
    return { ok: false, error: message }
  }
  return { ok: true }
}

export async function writeProducedArtifacts(input: {
  workflow: CoreWorkflowDefinition
  run: WorkflowRunState
  step: EngineStep
  resultSinks: ResultSinkRegistry
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { workflow, run, step, resultSinks } = input
  const artifacts = workflow.artifacts ?? []
  for (const artifact of artifacts.filter((item) => item.producedBy === step.id)) {
    const value = run.state[artifact.id]
    if (value === undefined) continue
    const path = renderArtifactPath(artifact, { inputs: run.inputs, state: run.state, run, workflow, step })
    // artifact path に未解決テンプレートが残る場合は、誤った literal path への生成物書き込みを避ける。
    if (path.includes("{{")) continue
    const write = await resultSinks.write({ type: "file", path }, {
      workflowId: workflow.id,
      logicalWorkflowId: workflow.logicalWorkflowId,
      workflowRoot: workflow.workflowRoot,
      workflowFile: workflow.workflowFile,
      workflowFolderName: workflow.workflowFolderName,
      runId: run.runId,
      stepId: step.id,
      inputs: run.inputs,
      state: run.state,
      text: value
    })
    if (!write.ok) return { ok: false, error: write.error ?? `Failed to write artifact: ${artifact.id}` }
  }
  return { ok: true }
}

async function resultText(input: {
  workflow: CoreWorkflowDefinition
  run: WorkflowRunState
  step: EngineStep
  result: ResultSourceDefinition
  recoverResultText?: RecoverResultText
  agentText?: string
}): Promise<string> {
  const { workflow, run, step, result, recoverResultText, agentText } = input
  if (result.source === "literal") return result.text
  if (result.source === "agent") {
    const recovered = agentText ?? await recoverResultText?.({
      workflow,
      run,
      step,
      reason: "missing-result-text"
    })
    if (recovered === undefined) throw new Error("Agent result source is not available for this step.")
    return recovered
  }
  const value = run.state[result.stateKey]
  if (value === undefined) throw new Error(`Workflow state is missing: ${result.stateKey}`)
  return value
}
