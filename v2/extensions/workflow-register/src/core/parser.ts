import * as path from "path"
import { createHash } from "crypto"
import Ajv from "ajv"
import {
  CoreWorkflowDefinition,
  EngineStep,
  ParseWorkflowRequest,
  ParseWorkflowResult,
  ResultSinkDefinition,
  ResultSourceDefinition,
  WorkflowInputDefinition,
  WorkflowStepCompletionMode,
  WorkflowStepMessageMode,
  WorkflowTodoDefinition
} from "./model"
import { knownWorkflowV1TopLevelFields, workflowV1Schema } from "./workflowSchema"

const yaml = require("js-yaml") as { load(text: string): unknown }
const ajv = new Ajv({ allErrors: true, strict: false })
const validateV1 = ajv.compile(workflowV1Schema as object)

export function parseWorkflowMarkdown(request: ParseWorkflowRequest): ParseWorkflowResult {
  const split = splitMarkdownFrontMatter(request.text)
  if (!split) return { ok: false, diagnostics: [`- fail: ${request.filePath}: missing YAML front matter.`] }

  let fields: Record<string, unknown>
  try {
    fields = asRecord(yaml.load(split.frontMatter))
  } catch (error) {
    return { ok: false, diagnostics: [`- fail: ${request.filePath}: invalid YAML: ${formatError(error)}`] }
  }

  if (fields.schemaVersion === "workflow-register/v1") return parseV1Workflow(request, fields, split.body, request.text)
  return parseLegacyWorkflow(request, fields, split.body)
}

function parseV1Workflow(request: ParseWorkflowRequest, fields: Record<string, unknown>, body: string, fullText: string): ParseWorkflowResult {
  const valid = validateV1(fields)
  const diagnostics = valid ? [] : formatValidationErrors(request.filePath)
  const warnings = unknownTopLevelWarnings(request.filePath, fields)
  if (diagnostics.length > 0) return { ok: false, diagnostics }

  const hasTypedSteps = Object.prototype.hasOwnProperty.call(fields, "steps")
  const stepRecords = Array.isArray(fields.steps) ? fields.steps.map((step) => asRecord(step)) : []
  const engineSteps = hasTypedSteps ? stepRecords.map(normalizeEngineStep) : legacyEngineStepsFromWorkflow(fields, body)
  const todos = workflowTodos(fields, body, engineSteps, hasTypedSteps)
  const todoEnabled = optionalBoolean(fields, "todo") ?? todos.length > 0
  const permissions = listField(fields, "permissions", todoEnabled ? ["read", "mcp", "skill", "todo"] : ["read", "mcp", "skill"])
  if (todoEnabled && !permissions.includes("todo")) permissions.push("todo")

  const name = requiredString(fields, "name")
  const prompt = optionalString(fields, "prompt") ?? body.trim()
  const workflow: CoreWorkflowDefinition = {
    id: optionalString(fields, "id") ?? `${request.sourceId}.${name}`,
    name,
    label: optionalString(fields, "label") ?? optionalString(fields, "title") ?? name,
    menuLabel: optionalString(fields, "menuLabel") ?? optionalString(fields, "label") ?? optionalString(fields, "title") ?? name,
    description: requiredString(fields, "description"),
    schemaVersion: "workflow-register/v1",
    definitionHash: `sha256:${createHash("sha256").update(fullText).digest("hex")}`,
    filePath: request.filePath,
    prompt,
    promptWithoutTodo: removeMarkdownStepSections(removeMarkdownSection(prompt, "Todo")).trim(),
    command: optionalString(fields, "command"),
    commandArgs: arrayField(fields, "commandArgs"),
    mode: optionalString(fields, "mode") ?? "agent",
    category: optionalString(fields, "category"),
    permissions,
    autoApprovalEnabled: optionalBoolean(fields, "autoApproval") ?? true,
    workspaceRequired: optionalBoolean(fields, "workspaceRequired") ?? true,
    hidden: optionalBoolean(fields, "hidden") ?? false,
    todoEnabled,
    todoRequired: optionalBoolean(fields, "todoRequired") ?? false,
    todoAsSteps: optionalBoolean(fields, "todoAsSteps") ?? (todoEnabled && todos.length > 0),
    stepCompletion: stepCompletion(fields, todoEnabled && todos.length > 0 ? "manual" : "auto"),
    stepMessage: stepMessage(fields, "current"),
    todos,
    inputs: normalizeInputs(asRecord(fields.inputs)),
    requires: normalizeRequires(asRecord(fields.requires)),
    preflight: normalizePreflight(fields.preflight),
    tools: normalizeTools(asRecord(fields.tools)),
    guardrails: normalizeGuardrails(asRecord(fields.guardrails)),
    artifacts: normalizeArtifacts(fields.artifacts),
    completion: normalizeCompletion(asRecord(fields.completion)),
    engineSteps
  }
  return { ok: true, workflow, diagnostics: [...warnings, `- ok: ${request.filePath}: ${workflow.id}; schemaVersion=workflow-register/v1; steps=${workflow.engineSteps.length}`] }
}

function parseLegacyWorkflow(request: ParseWorkflowRequest, fields: Record<string, unknown>, body: string): ParseWorkflowResult {
  const name = optionalString(fields, "name") ?? path.basename(path.dirname(request.filePath))
  const description = optionalString(fields, "description")
  const diagnostics: string[] = []
  if (!description) diagnostics.push(`- fail: ${request.filePath}: missing required field 'description'.`)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) diagnostics.push(`- fail: ${request.filePath}: field 'name' must contain only letters, numbers, dot, underscore, or hyphen and must not start with punctuation.`)
  if (diagnostics.length > 0) return { ok: false, diagnostics }

  const prompt = optionalString(fields, "prompt") ?? body.trim()
  const engineSteps = legacyStepsFromMarkdown(body)
  const workflow: CoreWorkflowDefinition = {
    id: optionalString(fields, "id") ?? `${request.sourceId}.${name}`,
    name,
    label: optionalString(fields, "label") ?? optionalString(fields, "title") ?? name,
    menuLabel: optionalString(fields, "menuLabel") ?? optionalString(fields, "label") ?? optionalString(fields, "title") ?? name,
    description: description ?? "",
    schemaVersion: "legacy",
    filePath: request.filePath,
    prompt,
    promptWithoutTodo: removeMarkdownStepSections(removeMarkdownSection(prompt, "Todo")).trim(),
    command: optionalString(fields, "command"),
    commandArgs: arrayField(fields, "commandArgs"),
    mode: optionalString(fields, "mode") ?? "agent",
    category: optionalString(fields, "category"),
    permissions: listField(fields, "permissions", ["read", "mcp", "skill"]),
    autoApprovalEnabled: optionalBoolean(fields, "autoApproval") ?? true,
    workspaceRequired: optionalBoolean(fields, "workspaceRequired") ?? true,
    hidden: optionalBoolean(fields, "hidden") ?? false,
    todoEnabled: engineSteps.length > 0,
    todoRequired: optionalBoolean(fields, "todoRequired") ?? false,
    todoAsSteps: true,
    stepCompletion: stepCompletion(fields, "manual"),
    stepMessage: stepMessage(fields, "current"),
    todos: legacyTodosFromMarkdown(body),
    inputs: {},
    requires: {},
    preflight: [],
    tools: {},
    guardrails: {},
    artifacts: [],
    completion: {},
    engineSteps
  }
  return { ok: true, workflow, diagnostics: [`- ok: ${request.filePath}: ${workflow.id}; schemaVersion=legacy; steps=${workflow.engineSteps.length}`] }
}

function unknownTopLevelWarnings(filePath: string, fields: Record<string, unknown>): string[] {
  return Object.keys(fields)
    .filter((key) => !knownWorkflowV1TopLevelFields.has(key))
    .map((key) => `- warn: ${filePath}: unknown top-level field '${key}'.`)
}

function workflowTodos(fields: Record<string, unknown>, body: string, steps: EngineStep[], hasTypedSteps: boolean): WorkflowTodoDefinition[] {
  const yamlTodos = legacyTodosFromYamlList(fields.todos).map((todo) => ({ id: todo.id, title: todo.title, raw: `${todo.id}: ${todo.title}` }))
  if (yamlTodos.length > 0) return yamlTodos
  if (hasTypedSteps) return steps.map((step) => ({ id: step.id, title: step.title, raw: `${step.id}: ${step.title}` }))
  return legacyTodosFromMarkdown(body)
}

function legacyTodosFromMarkdown(body: string): WorkflowTodoDefinition[] {
  return extractLegacyTodos(body).map((todo) => ({ id: todo.id, title: todo.title, raw: `${todo.id}: ${todo.title}` }))
}

function stepCompletion(fields: Record<string, unknown>, fallback: WorkflowStepCompletionMode): WorkflowStepCompletionMode {
  const value = optionalString(fields, "stepCompletion")
  return value === "auto" || value === "manual" ? value : fallback
}

function stepMessage(fields: Record<string, unknown>, fallback: WorkflowStepMessageMode): WorkflowStepMessageMode {
  const value = optionalString(fields, "stepMessage")
  return value === "full" || value === "current" || value === "silent" || value === "step" ? value : fallback
}

function normalizeInputs(inputs: Record<string, unknown>): Record<string, WorkflowInputDefinition> {
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

function normalizeRequires(record: Record<string, unknown>) {
  const bob = asRecord(record.bob)
  return {
    workspace: optionalBoolean(record, "workspace"),
    bob: Object.keys(bob).length > 0 ? { minVersion: optionalString(bob, "minVersion") } : undefined,
    files: listField(record, "files")
  }
}

function normalizePreflight(value: unknown) {
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

function normalizeTools(tools: Record<string, unknown>) {
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

function normalizeGuardrails(record: Record<string, unknown>) {
  const approvals = Array.isArray(record.requireApproval) ? record.requireApproval : []
  return {
    allowedCommands: listField(record, "allowedCommands"),
    deniedCommands: listField(record, "deniedCommands"),
    requireApproval: approvals.map((approval) => {
      const approvalRecord = asRecord(approval)
      return { id: optionalString(approvalRecord, "id"), when: optionalString(approvalRecord, "when"), message: optionalString(approvalRecord, "message") }
    })
  }
}

function normalizeArtifacts(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    const record = asRecord(entry)
    return { id: requiredString(record, "id"), producedBy: optionalString(record, "producedBy"), path: requiredString(record, "path"), schema: optionalString(record, "schema") }
  })
}

function normalizeCompletion(record: Record<string, unknown>) {
  const visualization = asRecord(record.visualization)
  return {
    summary: optionalString(record, "summary"),
    includeArtifacts: optionalBoolean(record, "includeArtifacts"),
    validateResult: optionalBoolean(record, "validateResult"),
    visualization: Object.keys(visualization).length > 0 ? { type: optionalString(visualization, "type"), enabled: optionalBoolean(visualization, "enabled") } : undefined
  }
}

function normalizeEngineStep(step: Record<string, unknown>): EngineStep {
  const base = {
    id: requiredString(step, "id"),
    title: requiredString(step, "title"),
    required: optionalBoolean(step, "required"),
    prompt: optionalString(step, "prompt"),
    sendResult: optionalBoolean(step, "sendResult"),
    completeOnSuccess: optionalBoolean(step, "completeOnSuccess"),
    includeState: listField(step, "includeState"),
    maxResultBytes: optionalNumber(step, "maxResultBytes"),
    stateRequired: optionalBoolean(step, "stateRequired")
  }
  if (step.type === "command") {
    const action = asRecord(step.action)
    return { ...base, type: "command", action: { provider: requiredString(action, "provider"), args: action.args }, resultKey: optionalString(step, "resultKey") }
  }
  if (step.type === "agent") return { ...base, type: "agent", resultKey: optionalString(step, "resultKey"), result: step.result ? normalizeResult(step.result) : undefined }
  if (step.type === "result") return { ...base, type: "result", result: normalizeResult(step.result) }
  return { ...base, type: "manual" }
}

function normalizeResult(value: unknown): ResultSourceDefinition {
  const record = asRecord(value)
  const sinks = Array.isArray(record.sinks) ? record.sinks.map((sink) => normalizeSink(asRecord(sink))) : []
  if (record.source === "state") return { source: "state", stateKey: requiredString(record, "stateKey"), sinks }
  if (record.source === "literal") return { source: "literal", text: requiredString(record, "text"), sinks }
  return { source: "agent", sinks }
}

function normalizeSink(record: Record<string, unknown>): ResultSinkDefinition {
  if (record.type === "command") return { type: "command", command: requiredString(record, "command"), args: listField(record, "args") }
  return { type: "file", path: requiredString(record, "path"), encoding: optionalString(record, "encoding") as BufferEncoding | undefined }
}

function legacyStepsFromMarkdown(body: string): EngineStep[] {
  return legacyEngineStepsFromTodos(extractLegacyTodos(body), body)
}

function legacyEngineStepsFromWorkflow(fields: Record<string, unknown>, body: string): EngineStep[] {
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

function extractLegacyTodos(body: string): Array<{ id: string; title: string }> {
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

function legacyTodosFromYamlList(value: unknown): Array<{ id: string; title: string }> {
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

function parseStepHeading(text: string): string | undefined {
  return text.trim().match(/^Step(?::|\s+)\s*([A-Za-z0-9_.-]+)\s*$/i)?.[1]
}

function extractWorkflowStepConfig(markdown: string): { config: Record<string, unknown>; prompt: string } {
  const match = markdown.match(/(^|\r?\n)```workflow-step\s*\r?\n([\s\S]*?)\r?\n```\s*(?:\r?\n)?/i)
  if (!match) return { config: {}, prompt: markdown }
  const prompt = `${markdown.slice(0, match.index)}${markdown.slice((match.index ?? 0) + match[0].length)}`.trim()
  return { config: asRecord(yaml.load(match[2])), prompt }
}

function extractMarkdownSection(markdown: string, headingName: string): string | undefined {
  const lines = markdown.split(/\r?\n/)
  let start = -1
  let level = 0
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^(#{1,6})\s+(.+?)\s*$/)
    if (heading && heading[2].trim().toLowerCase() === headingName.toLowerCase()) {
      start = index + 1
      level = heading[1].length
      break
    }
  }
  if (start < 0) return undefined
  const body: string[] = []
  for (let index = start; index < lines.length; index += 1) {
    const heading = lines[index].match(/^(#{1,6})\s+/)
    if (heading && heading[1].length <= level) break
    body.push(lines[index])
  }
  return body.join("\n").trim()
}

function removeMarkdownSection(markdown: string, headingName: string): string {
  const lines = markdown.split(/\r?\n/)
  let start = -1
  let level = 0
  let end = lines.length
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^(#{1,6})\s+(.+?)\s*$/)
    if (heading && heading[2].trim().toLowerCase() === headingName.toLowerCase()) {
      start = index
      level = heading[1].length
      break
    }
  }
  if (start < 0) return markdown
  for (let index = start + 1; index < lines.length; index += 1) {
    const heading = lines[index].match(/^(#{1,6})\s+/)
    if (heading && heading[1].length <= level) {
      end = index
      break
    }
  }
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n").replace(/\n{3,}/g, "\n\n")
}

function removeMarkdownStepSections(markdown: string): string {
  const lines = markdown.split(/\r?\n/)
  const kept: string[] = []
  for (let index = 0; index < lines.length;) {
    const heading = lines[index].match(/^(#{1,6})\s+(.+?)\s*$/)
    if (!heading || !parseStepHeading(heading[2])) {
      kept.push(lines[index])
      index += 1
      continue
    }
    const level = heading[1].length
    index += 1
    while (index < lines.length) {
      const nextHeading = lines[index].match(/^(#{1,6})\s+/)
      if (nextHeading && nextHeading[1].length <= level) break
      index += 1
    }
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n")
}

function formatValidationErrors(filePath: string): string[] {
  return (validateV1.errors ?? []).map((error) => {
    const location = error.instancePath || "/"
    return `- fail: ${filePath}: ${location} ${error.message ?? "is invalid"}.`
  })
}

function splitMarkdownFrontMatter(text: string): { frontMatter: string; body: string } | undefined {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  return match ? { frontMatter: match[1], body: match[2] } : undefined
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = optionalString(record, key)
  if (!value) throw new Error(`Missing required string: ${key}`)
  return value
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function optionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  return typeof record[key] === "boolean" ? record[key] as boolean : undefined
}

function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return undefined
}

function arrayField(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key]
  return Array.isArray(value) ? value : []
}

function listField(record: Record<string, unknown>, key: string, fallback: string[] = []): string[] {
  const value = record[key]
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === "string" && value.trim()) return [value.trim()]
  return fallback
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
