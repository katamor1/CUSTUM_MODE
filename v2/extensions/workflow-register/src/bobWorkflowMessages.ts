import {
  DEFAULT_MAX_RESULT_BYTES
} from "./bobWorkflowTypes"
import type {
  WorkflowDefinition,
  WorkflowStateEntry,
  WorkflowStepCommandResult,
  WorkflowStepDefinition,
  WorkflowTodoItem
} from "./bobWorkflowTypes"
import { appendWorkflowContext } from "./workflowPromptContext"

export function buildStepMessage(
  definition: WorkflowDefinition,
  todo: WorkflowTodoItem,
  index: number,
  stepDefinition?: WorkflowStepDefinition,
  commandResult?: WorkflowStepCommandResult,
  stateEntries: WorkflowStateEntry[] = []
): string | undefined {
  if (index === 0) {
    return buildWorkflowStartMessage(
      definition,
      todo,
      index,
      stepDefinition,
      commandResult,
      stateEntries
    )
  }
  if (definition.stepMessage === "silent") {
    return shouldIncludeCommandResult(stepDefinition, commandResult) || stateEntries.length > 0
      ? buildCommandResultMessage(definition, todo, index, commandResult, stateEntries)
      : undefined
  }
  if (definition.stepMessage === "full") {
    return buildWorkflowTodoStepMessage(definition, todo, index, stepDefinition, commandResult, stateEntries)
  }
  if (definition.stepMessage === "step") {
    return buildStepPromptMessage(definition, todo, index, stepDefinition, commandResult, stateEntries)
      ?? buildCurrentTodoMessage(definition, todo, index, stepDefinition, commandResult, stateEntries)
  }
  return buildCurrentTodoMessage(definition, todo, index, stepDefinition, commandResult, stateEntries)
}

export function buildWorkflowStartMessage(
  definition: WorkflowDefinition,
  currentTodo?: WorkflowTodoItem,
  currentIndex = 0,
  stepDefinition?: WorkflowStepDefinition,
  commandResult?: WorkflowStepCommandResult,
  stateEntries: WorkflowStateEntry[] = []
): string {
  const lines = [
    "You are starting the following Bob workflow.",
    "",
    "Workflow:",
    `- id: ${definition.id}`,
    `- name: ${definition.name}`,
    `- title: ${definition.label}`,
    `- mode: ${definition.mode}`,
    ""
  ]
  appendWorkflowContext(lines, {
    workflowRoot: definition.workflowRoot,
    workflowFile: definition.workflowFile,
    workflowFolderName: definition.workflowFolderName,
    stateEntries
  })
  if (definition.todoEnabled) {
    lines.push(
      "First, create or update your Todo list using exactly the items below.",
      "Do not immediately mark them complete. Work through them one by one and only mark an item complete after the corresponding work is actually done.",
      "",
      "<workflow_todos>",
      ...definition.todos.map((todo) => `- [ ] ${todo.id}: ${todo.text}`),
      "</workflow_todos>",
      ""
    )
  }
  lines.push(
    "Then follow the workflow instructions below.",
    "",
    "<workflow_instructions>",
    definition.promptWithoutTodo,
    "</workflow_instructions>"
  )
  if (definition.stepMessage === "step" && currentTodo) {
    const stepBlock = buildStepPromptBlock(stepDefinition, currentTodo, currentIndex)
    if (stepBlock) lines.push("", "Current workflow step:", stepBlock)
  }
  appendCommandResult(lines, stepDefinition, commandResult)
  appendWorkflowState(lines, stateEntries)
  return lines.join("\n")
}

function buildCurrentTodoMessage(
  definition: WorkflowDefinition,
  todo: WorkflowTodoItem,
  index: number,
  stepDefinition?: WorkflowStepDefinition,
  commandResult?: WorkflowStepCommandResult,
  stateEntries: WorkflowStateEntry[] = []
): string {
  const lines = [
    "Current workflow Todo item:",
    `<workflow_todo index=\"${index + 1}\" id=\"${todo.id}\">`,
    `- [ ] ${todo.id}: ${todo.text}`,
    "</workflow_todo>"
  ]
  appendWorkflowContext(lines, {
    workflowRoot: definition.workflowRoot,
    workflowFile: definition.workflowFile,
    workflowFolderName: definition.workflowFolderName,
    stateEntries
  })
  appendCommandResult(lines, stepDefinition, commandResult)
  appendWorkflowState(lines, stateEntries)
  return lines.join("\n")
}

export function buildCommandResultMessage(
  definition: WorkflowDefinition,
  todo: WorkflowTodoItem,
  index: number,
  commandResult?: WorkflowStepCommandResult,
  stateEntries: WorkflowStateEntry[] = []
): string | undefined {
  const lines = [
    "Workflow step command result:",
    `<workflow_todo index=\"${index + 1}\" id=\"${todo.id}\">`,
    `- [ ] ${todo.id}: ${todo.text}`,
    "</workflow_todo>"
  ]
  appendWorkflowContext(lines, {
    workflowRoot: definition.workflowRoot,
    workflowFile: definition.workflowFile,
    workflowFolderName: definition.workflowFolderName,
    stateEntries
  })
  if (commandResult) lines.push("", buildCommandResultBlock(commandResult))
  appendWorkflowState(lines, stateEntries)
  return lines.join("\n")
}

function buildStepPromptMessage(
  definition: WorkflowDefinition,
  todo: WorkflowTodoItem,
  index: number,
  stepDefinition?: WorkflowStepDefinition,
  commandResult?: WorkflowStepCommandResult,
  stateEntries: WorkflowStateEntry[] = []
): string | undefined {
  const stepBlock = buildStepPromptBlock(stepDefinition, todo, index)
  if (!stepBlock) return undefined
  const lines = ["Continue the Bob workflow using the current Step instructions.", "", stepBlock]
  appendWorkflowContext(lines, {
    workflowRoot: definition.workflowRoot,
    workflowFile: definition.workflowFile,
    workflowFolderName: definition.workflowFolderName,
    stateEntries
  })
  appendCommandResult(lines, stepDefinition, commandResult)
  appendWorkflowState(lines, stateEntries)
  return lines.join("\n")
}

function buildStepPromptBlock(
  stepDefinition: WorkflowStepDefinition | undefined,
  todo: WorkflowTodoItem,
  index: number
): string | undefined {
  const prompt = stepDefinition?.prompt.trim()
  if (!prompt) return undefined
  return [
    `<workflow_step index=\"${index + 1}\" id=\"${todo.id}\">`,
    `Title: ${todo.text}`,
    "",
    "<workflow_step_instructions>",
    prompt,
    "</workflow_step_instructions>",
    "</workflow_step>"
  ].join("\n")
}

function buildWorkflowTodoStepMessage(
  definition: WorkflowDefinition,
  todo: WorkflowTodoItem,
  index: number,
  stepDefinition?: WorkflowStepDefinition,
  commandResult?: WorkflowStepCommandResult,
  stateEntries: WorkflowStateEntry[] = []
): string {
  const lines = [
    "Continue the Bob workflow Todo list.",
    "",
    "Workflow:",
    `- id: ${definition.id}`,
    `- name: ${definition.name}`,
    `- title: ${definition.label}`,
    `- mode: ${definition.mode}`,
    "",
    "Current Todo item:",
    `<workflow_todo index=\"${index + 1}\" id=\"${todo.id}\">`,
    `- [ ] ${todo.id}: ${todo.text}`,
    "</workflow_todo>",
    "",
    "Work only on this Todo item now. Mark it complete only after the corresponding work is actually done."
  ]
  appendWorkflowContext(lines, {
    workflowRoot: definition.workflowRoot,
    workflowFile: definition.workflowFile,
    workflowFolderName: definition.workflowFolderName,
    stateEntries
  })
  appendCommandResult(lines, stepDefinition, commandResult)
  appendWorkflowState(lines, stateEntries)
  return lines.join("\n")
}

function appendCommandResult(
  lines: string[],
  stepDefinition?: WorkflowStepDefinition,
  commandResult?: WorkflowStepCommandResult
): void {
  if (shouldIncludeCommandResult(stepDefinition, commandResult) && commandResult) {
    lines.push("", buildCommandResultBlock(commandResult, stepDefinition?.maxResultBytes))
  }
}

function appendWorkflowState(lines: string[], stateEntries: WorkflowStateEntry[]): void {
  if (stateEntries.length === 0) return
  lines.push("", "<workflow_state>")
  for (const entry of stateEntries) {
    lines.push(`<state key=\"${escapeXmlAttribute(entry.key)}\">`, entry.value, "</state>", "")
  }
  if (lines[lines.length - 1] === "") lines.pop()
  lines.push("</workflow_state>")
}

export function shouldIncludeCommandResult(
  stepDefinition?: WorkflowStepDefinition,
  commandResult?: WorkflowStepCommandResult
): boolean {
  return Boolean(commandResult && (stepDefinition?.sendResult || !commandResult.ok))
}

function buildCommandResultBlock(
  commandResult: WorkflowStepCommandResult,
  maxBytes = DEFAULT_MAX_RESULT_BYTES
): string {
  return [
    `<workflow_step_command_result command=\"${escapeXmlAttribute(commandResult.command)}\" ok=\"${commandResult.ok}\">`,
    commandResult.ok ? formatCommandResult(commandResult.value, maxBytes) : `ERROR: ${commandResult.error}`,
    "</workflow_step_command_result>"
  ].join("\n")
}

function formatCommandResult(value: unknown, maxBytes = DEFAULT_MAX_RESULT_BYTES): string {
  let formatted: string
  if (value === undefined) formatted = "undefined"
  else if (typeof value === "string") formatted = value
  else {
    try {
      formatted = JSON.stringify(value, null, 2)
    } catch {
      formatted = String(value)
    }
  }
  return truncateText(formatted, maxBytes)
}

function truncateText(value: string, maxBytes: number): string {
  if (maxBytes <= 0 || Buffer.byteLength(value, "utf8") <= maxBytes) return value
  let output = value
  while (Buffer.byteLength(output, "utf8") > maxBytes && output.length > 0) {
    output = output.slice(0, Math.max(0, output.length - 512))
  }
  return `${output}\n... [truncated to ${maxBytes} bytes]`
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/\"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}
