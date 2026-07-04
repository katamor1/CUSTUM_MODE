import type { ActiveStep } from "../bobWorkflowTypes"
import type { CoreWorkflowDefinition, EngineStep, WorkflowRunState } from "../core/model"
import { renderTemplate } from "../core/engine/templateRenderer"

export interface ManualStepActionViewModel {
  activeKey?: string
  runId: string
  workflowId: string
  workflowLabel: string
  stepId: string
  stepTitle: string
  status: "active" | "heldWithoutActiveTask" | "completed" | "error"
  message: string
  completeLabel: string
  confirmOnComplete: boolean
  confirmMessage?: string
  workflowFile?: string
  stateKeys: string[]
}

interface BuildManualStepActionViewModelInput {
  workflow: CoreWorkflowDefinition
  run: WorkflowRunState
  step: EngineStep
  active?: Pick<ActiveStep, "key">
}

export interface ManualStepPanelInput {
  workflow: CoreWorkflowDefinition
  run: WorkflowRunState
  step: EngineStep
  active?: Pick<ActiveStep, "key">
}

export function buildManualStepActionViewModel(input: BuildManualStepActionViewModelInput): ManualStepActionViewModel {
  const { workflow, run, step, active } = input
  const userAction = step.userAction
  const messageTemplate = userAction?.message ?? step.prompt ?? `${step.title} の操作が完了したら、完了ボタンを押してください。`
  const confirmMessageTemplate = userAction?.confirmMessage ?? (userAction?.confirmOnComplete ? "この step を完了済みとして workflow を進めます。よろしいですか？" : undefined)
  const context = { inputs: run.inputs, state: run.state, run, workflow, step }
  return {
    activeKey: active?.key,
    runId: run.runId,
    workflowId: workflow.id,
    workflowLabel: workflow.label,
    stepId: step.id,
    stepTitle: step.title,
    status: active ? "active" : run.status === "completed" ? "completed" : "heldWithoutActiveTask",
    message: renderTemplate(messageTemplate, context),
    completeLabel: userAction?.completeLabel ?? "完了",
    confirmOnComplete: userAction?.confirmOnComplete ?? false,
    confirmMessage: confirmMessageTemplate ? renderTemplate(confirmMessageTemplate, context) : undefined,
    workflowFile: workflow.workflowFile,
    stateKeys: Object.keys(run.state).sort()
  }
}
