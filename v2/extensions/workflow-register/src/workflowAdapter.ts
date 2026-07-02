import { createHash } from "crypto"
import * as path from "path"
import * as vscode from "vscode"
import {
  DEFAULT_MAX_RESULT_BYTES
} from "./bobWorkflowTypes"
import type {
  WorkflowDefinition,
  WorkflowStepDefinition
} from "./bobWorkflowTypes"
import type {
  CoreWorkflowDefinition,
  EngineStep,
  ResultSinkDefinition
} from "./core/model"

export function adaptCoreWorkflowForBob(core: CoreWorkflowDefinition, file: vscode.Uri): WorkflowDefinition {
  const todos = core.todos.map((todo, index) => ({
    id: todo.id,
    text: todo.title,
    raw: todo.raw ?? `${todo.id}: ${todo.title || `Step ${index + 1}`}`
  }))
  return {
    id: core.id,
    logicalWorkflowId: core.logicalWorkflowId ?? core.id,
    name: core.name,
    label: core.label,
    menuLabel: core.menuLabel ?? core.label,
    description: core.description,
    prompt: core.prompt,
    promptWithoutTodo: core.promptWithoutTodo,
    command: core.command,
    commandArgs: core.commandArgs,
    mode: core.mode,
    permissions: [...core.permissions],
    autoApprovalEnabled: core.autoApprovalEnabled,
    workspaceRequired: core.workspaceRequired,
    hidden: core.hidden,
    todoEnabled: core.todoEnabled,
    todoRequired: core.todoRequired,
    todoSource: "core",
    todoAsSteps: core.todoAsSteps,
    stepCompletion: core.stepCompletion,
    stepMessage: core.stepMessage,
    stepExecution: core.stepExecution,
    stepsById: Object.fromEntries(
      core.engineSteps.map((step) => [step.id, workflowStepDefinitionFromEngineStep(step)])
    ),
    todos,
    inputs: core.inputs,
    guardrails: core.guardrails,
    workflowRoot: core.workflowRoot,
    workflowFile: core.workflowFile,
    workflowFolderName: core.workflowFolderName,
    file,
    core
  }
}

export function qualifyDuplicateWorkflowIds(
  workflows: WorkflowDefinition[],
  coreWorkflows: CoreWorkflowDefinition[]
): void {
  const counts = new Map<string, number>()
  for (const workflow of coreWorkflows) counts.set(workflow.id, (counts.get(workflow.id) ?? 0) + 1)
  for (const workflow of coreWorkflows) {
    const logicalId = workflow.logicalWorkflowId ?? workflow.id
    workflow.logicalWorkflowId = logicalId
    if ((counts.get(logicalId) ?? 0) > 1) {
      workflow.id = qualifiedWorkflowId(logicalId, workflow.workflowRoot)
    }
  }
  for (const workflow of workflows) {
    const logicalId = workflow.logicalWorkflowId ?? workflow.id
    workflow.logicalWorkflowId = logicalId
    if ((counts.get(logicalId) ?? 0) > 1) {
      workflow.id = qualifiedWorkflowId(logicalId, workflow.workflowRoot)
    }
  }
}

function qualifiedWorkflowId(logicalId: string, workflowRoot: string | undefined): string {
  const root = workflowRoot ?? "unknown"
  const slug = path.basename(root).replace(/[^A-Za-z0-9_-]+/g, "-") || "workspace"
  const hash = createHash("sha1").update(root).digest("hex").slice(0, 8)
  return `${logicalId}.${slug}-${hash}`
}

function workflowStepDefinitionFromEngineStep(step: EngineStep): WorkflowStepDefinition {
  const commandSink = commandResultSink(step)
  return {
    id: step.id,
    prompt: step.prompt?.trim() ?? "",
    command: step.type === "command" ? step.action.provider : undefined,
    commandArgs: step.type === "command" ? argumentList(step.action.args) : [],
    sendResult: step.sendResult ?? false,
    required: step.required !== false,
    completeOnSuccess: step.completeOnSuccess ?? false,
    runAgent: step.type === "agent",
    resultKey: "resultKey" in step ? step.resultKey : undefined,
    includeState: step.includeState ?? [],
    maxResultBytes: step.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES,
    stateRequired: step.stateRequired !== false,
    captureResult: Boolean(commandSink),
    resultSource: step.type === "agent" && step.result?.source === "agent" ? "agent" : undefined,
    resultCommand: commandSink?.command,
    resultCommandArgs: commandSink?.args ?? []
  }
}

function commandResultSink(step: EngineStep): Extract<ResultSinkDefinition, { type: "command" }> | undefined {
  const result = "result" in step ? step.result : undefined
  return result?.sinks.find(
    (sink): sink is Extract<ResultSinkDefinition, { type: "command" }> => sink.type === "command"
  )
}

function argumentList(value: unknown): unknown[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}
