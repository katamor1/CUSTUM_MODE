import type { WorkflowDefinition } from "./bobWorkflowTypes"
import { resultSourceForStep } from "./resultHandoff"

export interface WorkflowDiagnosticsInput {
  relativePath: string
  folderName: string
  parsedWorkflowName: string
  workflow: WorkflowDefinition
}

export interface WorkflowDiagnosticsResult {
  ok: boolean
  diagnostics: string[]
}

export function validateAndDescribeWorkflow(input: WorkflowDiagnosticsInput): WorkflowDiagnosticsResult {
  const { relativePath, folderName, parsedWorkflowName, workflow } = input
  const diagnostics: string[] = []
  if (folderName !== parsedWorkflowName) {
    diagnostics.push(
      `- warn: ${relativePath}: folder name '${folderName}' differs from workflow name '${parsedWorkflowName}'.`
    )
  }
  if (workflow.todoRequired && workflow.todos.length === 0) {
    return {
      ok: false,
      diagnostics: [`- fail: ${relativePath}: todoRequired is true but no todo items were found.`]
    }
  }
  if (workflow.stepMessage === "step") {
    for (const todo of workflow.todos) {
      if (!workflow.stepsById[todo.id]?.prompt) {
        diagnostics.push(`- warn: ${relativePath}: missing prompt for workflow step '${todo.id}'.`)
      }
    }
  }
  const stepCount = workflow.todoEnabled && workflow.todoAsSteps && workflow.todos.length > 0
    ? workflow.todos.length
    : 1
  const stepPromptCount = Object.values(workflow.stepsById)
    .filter((step) => step.prompt.length > 0)
    .length
  const stepCommandCount = Object.values(workflow.stepsById)
    .filter((step) => step.command)
    .length
  const agentStepCount = Object.values(workflow.stepsById)
    .filter((step) => step.runAgent)
    .length
  const stateKeyCount = Object.values(workflow.stepsById)
    .filter((step) => step.resultKey)
    .length
  const includeStateCount = Object.values(workflow.stepsById)
    .filter((step) => step.includeState.length > 0)
    .length
  const captureResultCount = Object.values(workflow.stepsById)
    .filter((step) => step.captureResult)
    .length
  diagnostics.push([
    `- ok: ${relativePath}: ${workflow.id}`,
    `todos=${workflow.todos.length}`,
    `todo=${workflow.todoEnabled}`,
    `steps=${stepCount}`,
    `stepCompletion=${workflow.stepCompletion}`,
    `stepMessage=${workflow.stepMessage}`,
    `stepPrompts=${stepPromptCount}`,
    `stepCommands=${stepCommandCount}`,
    `agentSteps=${agentStepCount}`,
    `stateKeys=${stateKeyCount}`,
    `includeState=${includeStateCount}`,
    `captureResults=${captureResultCount}`
  ].join("; "))
  for (const step of Object.values(workflow.stepsById).filter((candidate) => candidate.command)) {
    diagnostics.push(
      `- step command: ${step.id} -> ${step.command}; sendResult=${step.sendResult}; required=${step.required}; completeOnSuccess=${step.completeOnSuccess}`
    )
  }
  for (const step of Object.values(workflow.stepsById).filter((candidate) => candidate.runAgent)) {
    diagnostics.push(
      `- agent step: ${step.id}; resultKey=${step.resultKey ?? "none"}; maxResultBytes=${step.maxResultBytes}`
    )
  }
  for (const step of Object.values(workflow.stepsById).filter(
    (candidate) => candidate.resultKey || candidate.includeState.length > 0
  )) {
    const savePart = step.resultKey ? `resultKey=${step.resultKey}` : "resultKey=none"
    const includePart = step.includeState.length > 0
      ? `includeState=${step.includeState.join(",")}`
      : "includeState=none"
    diagnostics.push(
      `- step state: ${step.id}; ${savePart}; ${includePart}; stateRequired=${step.stateRequired}; maxResultBytes=${step.maxResultBytes}`
    )
  }
  for (const step of Object.values(workflow.stepsById).filter((candidate) => candidate.captureResult)) {
    diagnostics.push(
      `- step capture: ${step.id}; resultSource=${resultSourceForStep(step)}; resultCommand=${step.resultCommand ?? "none"}`
    )
  }
  return { ok: true, diagnostics }
}
