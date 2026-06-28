import { CommandResult, StepDef, Todo, WorkflowDef } from "./model"

export function stepMessage(def: WorkflowDef, todo: Todo, index: number, step?: StepDef, result?: CommandResult): string | undefined {
  if (index === 0) return startMessage(def, todo, index, step, result)
  if (def.stepMessage === "silent") return includeResult(step, result) ? resultMessage(todo, index, result) : undefined
  if (def.stepMessage === "full") return currentMessage(todo, index, step, result, true)
  if (def.stepMessage === "step") return stepPrompt(todo, index, step, result) ?? currentMessage(todo, index, step, result)
  return currentMessage(todo, index, step, result)
}

export function startMessage(def: WorkflowDef, todo?: Todo, index = 0, step?: StepDef, result?: CommandResult): string {
  const lines = ["You are starting the following Bob workflow.", "", "Workflow:", `- id: ${def.id}`, `- name: ${def.name}`, `- title: ${def.label}`, `- mode: ${def.mode}`, ""]
  if (def.todoEnabled) {
    lines.push("First, create or update your Todo list using exactly the items below.", "Do not immediately mark them complete. Work through them one by one and only mark an item complete after the corresponding work is actually done.", "", "<workflow_todos>", ...def.todos.map((t) => `- [ ] ${t.id}: ${t.text}`), "</workflow_todos>", "")
  }
  lines.push("Then follow the workflow instructions below.", "", "<workflow_instructions>", def.promptWithoutTodo, "</workflow_instructions>")
  if (def.stepMessage === "step" && todo) {
    const block = stepBlock(todo, index, step)
    if (block) lines.push("", "Current workflow step:", block)
  }
  appendResult(lines, step, result)
  return lines.join("\n")
}

function currentMessage(todo: Todo, index: number, step?: StepDef, result?: CommandResult, full = false): string {
  const lines = full ? ["Continue the Bob workflow Todo list.", ""] : []
  lines.push("Current workflow Todo item:", `<workflow_todo index=\"${index + 1}\" id=\"${todo.id}\">`, `- [ ] ${todo.id}: ${todo.text}`, "</workflow_todo>")
  appendResult(lines, step, result)
  return lines.join("\n")
}

function stepPrompt(todo: Todo, index: number, step?: StepDef, result?: CommandResult): string | undefined {
  const block = stepBlock(todo, index, step)
  if (!block) return undefined
  const lines = ["Continue the Bob workflow using the current Step instructions.", "", block]
  appendResult(lines, step, result)
  return lines.join("\n")
}

function stepBlock(todo: Todo, index: number, step?: StepDef): string | undefined {
  if (!step?.prompt) return undefined
  return [`<workflow_step index=\"${index + 1}\" id=\"${todo.id}\">`, `Title: ${todo.text}`, "", "<workflow_step_instructions>", step.prompt, "</workflow_step_instructions>", "</workflow_step>"].join("\n")
}

function resultMessage(todo: Todo, index: number, result?: CommandResult): string | undefined {
  if (!result) return undefined
  return ["Workflow step command result:", `<workflow_todo index=\"${index + 1}\" id=\"${todo.id}\">`, `- [ ] ${todo.id}: ${todo.text}`, "</workflow_todo>", "", resultBlock(result)].join("\n")
}

function appendResult(lines: string[], step?: StepDef, result?: CommandResult): void {
  if (includeResult(step, result) && result) lines.push("", resultBlock(result))
}

function includeResult(step?: StepDef, result?: CommandResult): boolean {
  return Boolean(result && (step?.sendResult || !result.ok))
}

function resultBlock(result: CommandResult): string {
  return [`<workflow_step_command_result command=\"${xml(result.command)}\" ok=\"${result.ok}\">`, result.ok ? format(result.value) : `ERROR: ${result.error}`, "</workflow_step_command_result>"].join("\n")
}

function format(value: unknown): string {
  if (value === undefined) return "undefined"
  if (typeof value === "string") return value
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/\"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
