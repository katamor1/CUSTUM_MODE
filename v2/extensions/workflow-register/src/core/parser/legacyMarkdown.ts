import { EngineStep, WorkflowTodoDefinition } from "../model"
import { extractMarkdownSection, parseStepHeading } from "./markdownSections"
import { asRecord, listField, optionalBoolean, optionalNumber, optionalString } from "./yamlFields"

const yaml = require("js-yaml") as { load(text: string): unknown }

export function legacyTodosFromMarkdown(body: string): WorkflowTodoDefinition[] {
  return extractLegacyTodos(body).map((todo) => ({ id: todo.id, title: todo.title, raw: `${todo.id}: ${todo.title}` }))
}

export function legacyStepsFromMarkdown(body: string): EngineStep[] {
  return legacyEngineStepsFromTodos(extractLegacyTodos(body), body)
}

export function legacyEngineStepsFromWorkflow(fields: Record<string, unknown>, body: string): EngineStep[] {
  const todoSource = optionalString(fields, "todoSource") ?? "markdown"
  const yamlTodos = legacyTodosFromYamlList(fields.todos)
  const markdownTodos = todoSource === "markdown" ? extractLegacyTodos(body) : []
  const todos = markdownTodos.length > 0 ? markdownTodos : yamlTodos
  return legacyEngineStepsFromTodos(todos, body)
}

function legacyEngineStepsFromTodos(todos: Array<{ id: string; title: string }>, body: string): EngineStep[] {
  const stepConfigs = extractLegacyStepConfigs(body)
  return todos.map((todo) => {
    const legacyStep = stepConfigs[todo.id] ?? { config: {}, prompt: "" }
    const config = legacyStep.config
    const base = {
      id: todo.id,
      title: todo.title,
      prompt: legacyStep.prompt.trim() || undefined,
      required: optionalBoolean(config, "required"),
      sendResult: optionalBoolean(config, "sendResult"),
      completeOnSuccess: optionalBoolean(config, "completeOnSuccess"),
      includeState: listField(config, "includeState"),
      maxResultBytes: optionalNumber(config, "maxResultBytes"),
      stateRequired: optionalBoolean(config, "stateRequired")
    }
    const command = optionalString(config, "command")
    if (command) return { ...base, type: "command", action: { provider: command, args: config.commandArgs }, resultKey: optionalString(config, "resultKey") }
    if (config.runAgent === true) {
      const resultCommand = optionalString(config, "resultCommand")
      return {
        ...base,
        type: "agent",
        resultKey: optionalString(config, "resultKey"),
        result: config.captureResult === true && resultCommand ? { source: "agent", sinks: [{ type: "command", command: resultCommand, args: listField(config, "resultCommandArgs") }] } : undefined
      }
    }
    return { ...base, type: "manual" }
  })
}

export function extractLegacyTodos(body: string): Array<{ id: string; title: string }> {
  const section = extractMarkdownSection(body, "Todo")
  if (!section) return []
  return section.split(/\r?\n/).flatMap((line, index) => {
    const match = line.match(/^\s*[-*]\s+\[[ xX]\]\s+(.+)$/)
    if (!match) return []
    const text = match[1].trim()
    const idMatch = text.match(/^([A-Za-z0-9_.-]+):\s+(.+)$/)
    return idMatch ? [{ id: idMatch[1], title: idMatch[2].trim() }] : [{ id: `todo-${index + 1}`, title: text }]
  })
}

export function legacyTodosFromYamlList(value: unknown): Array<{ id: string; title: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index) => {
    if (typeof item === "string") return [parseLegacyTodoText(item, index + 1)]
    const entries = Object.entries(asRecord(item))
    if (entries.length !== 1) return []
    const [id, title] = entries[0]
    return [{ id, title: String(title).trim() }]
  })
}

function parseLegacyTodoText(text: string, index: number): { id: string; title: string } {
  const trimmed = text.trim().replace(/^[-*]\s+\[[ xX]\]\s+/, "")
  const idMatch = trimmed.match(/^([A-Za-z0-9_.-]+):\s+(.+)$/)
  return idMatch ? { id: idMatch[1], title: idMatch[2].trim() } : { id: `todo-${index}`, title: trimmed }
}

function extractLegacyStepConfigs(body: string): Record<string, { config: Record<string, unknown>; prompt: string }> {
  const lines = body.split(/\r?\n/)
  const out: Record<string, { config: Record<string, unknown>; prompt: string }> = {}
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^(#{1,6})\s+(.+?)\s*$/)
    const id = heading ? parseStepHeading(heading[2]) : undefined
    if (!heading || !id) continue
    const level = heading[1].length
    const section: string[] = []
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const nextHeading = lines[cursor].match(/^(#{1,6})\s+/)
      if (nextHeading && nextHeading[1].length <= level) break
      section.push(lines[cursor])
    }
    out[id] = extractWorkflowStepConfig(section.join("\n"))
  }
  return out
}

function extractWorkflowStepConfig(markdown: string): { config: Record<string, unknown>; prompt: string } {
  const match = markdown.match(/(^|\r?\n)```workflow-step\s*\r?\n([\s\S]*?)\r?\n```\s*(?:\r?\n)?/i)
  if (!match) return { config: {}, prompt: markdown }
  const prompt = `${markdown.slice(0, match.index)}${markdown.slice((match.index ?? 0) + match[0].length)}`.trim()
  return { config: asRecord(yaml.load(match[2])), prompt }
}
