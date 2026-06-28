import * as path from "path"
import * as vscode from "vscode"
import { StepCompletion, StepDef, StepMessage, Todo, WorkflowDef } from "./model"

export async function loadWorkflows(sourceId: string): Promise<{ workflows: WorkflowDef[]; lines: string[] }> {
  const workflows: WorkflowDef[] = []
  const lines: string[] = []
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, ".bob/workflows/*/WORKFLOW.md"))
    lines.push(`- workspace: ${folder.name}; workflow files: ${files.length}`)
    for (const file of files) {
      const loaded = await loadWorkflow(sourceId, file)
      lines.push(...loaded.lines)
      if (loaded.workflow) workflows.push(loaded.workflow)
    }
  }
  return { workflows, lines }
}

async function loadWorkflow(sourceId: string, file: vscode.Uri): Promise<{ workflow?: WorkflowDef; lines: string[] }> {
  const rel = vscode.workspace.asRelativePath(file, false)
  const text = Buffer.from(await vscode.workspace.fs.readFile(file)).toString("utf8").replace(/^\uFEFF/, "")
  const split = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!split) return { lines: [`- fail: ${rel}: missing YAML front matter.`] }

  const fields = parseYaml(split[1])
  const name = stringField(fields, "name") ?? path.basename(path.dirname(file.fsPath))
  const description = stringField(fields, "description") ?? ""
  if (!description) return { lines: [`- fail: ${rel}: missing required field 'description'.`] }

  const body = split[2]
  const todoSource = stringField(fields, "todoSource") ?? "markdown"
  const yamlTodos = listField(fields, "todos").map(parseTodo)
  const markdownTodos = todoSource === "markdown" ? extractTodos(body) : []
  const todos = markdownTodos.length ? markdownTodos : yamlTodos
  const todoEnabled = boolField(fields, "todo", todos.length > 0)
  const todoAsSteps = boolField(fields, "todoAsSteps", todoEnabled && todos.length > 0)
  const stepMessage = stepMessageField(fields)
  const stepsById = extractSteps(body)
  const prompt = removeStepSections(todoSource === "markdown" ? removeSection(body.trim(), "Todo") : body.trim()).trim()

  const permissions = listField(fields, "permissions", todoEnabled ? ["read", "mcp", "skill", "todo"] : ["read", "mcp", "skill"])
  if (todoEnabled && !permissions.includes("todo")) permissions.push("todo")

  const workflow: WorkflowDef = {
    id: stringField(fields, "id") ?? `${sourceId}.${name}`,
    name,
    label: stringField(fields, "label") ?? stringField(fields, "title") ?? name,
    menuLabel: stringField(fields, "menuLabel") ?? stringField(fields, "label") ?? stringField(fields, "title") ?? name,
    description,
    mode: stringField(fields, "mode") ?? "agent",
    promptWithoutTodo: prompt,
    command: stringField(fields, "command"),
    commandArgs: listField(fields, "commandArgs"),
    permissions,
    autoApprovalEnabled: boolField(fields, "autoApproval", true),
    workspaceRequired: boolField(fields, "workspaceRequired", true),
    hidden: boolField(fields, "hidden", false),
    todoEnabled,
    todoAsSteps,
    stepCompletion: stepCompletionField(fields, todoAsSteps ? "manual" : "auto"),
    stepMessage,
    todos,
    stepsById,
    file
  }

  const stepCommands = Object.values(stepsById).filter((s) => s.command).length
  const lines = [`- ok: ${rel}: ${workflow.id}; todos=${todos.length}; todo=${todoEnabled}; steps=${todoAsSteps ? todos.length : 1}; stepCompletion=${workflow.stepCompletion}; stepMessage=${stepMessage}; stepPrompts=${Object.values(stepsById).filter((s) => s.prompt).length}; stepCommands=${stepCommands}`]
  for (const step of Object.values(stepsById).filter((s) => s.command)) {
    lines.push(`- step command: ${step.id} -> ${step.command}; sendResult=${step.sendResult}; required=${step.required}; completeOnSuccess=${step.completeOnSuccess}`)
  }
  return { workflow, lines }
}

function extractTodos(md: string): Todo[] {
  const section = sectionNamed(md, "Todo")
  if (!section) return []
  return section.split(/\r?\n/).map((line, i) => {
    const m = line.match(/^\s*[-*]\s+\[[ xX]\]\s+(.+)$/)
    return m ? parseTodo(m[1], i + 1) : undefined
  }).filter((x): x is Todo => Boolean(x))
}

function extractSteps(md: string): Record<string, StepDef> {
  const lines = md.split(/\r?\n/)
  const out: Record<string, StepDef> = {}
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/)
    const id = m ? stepHeading(m[2]) : undefined
    if (!m || !id) continue
    const level = m[1].length
    const body: string[] = []
    for (let j = i + 1; j < lines.length; j++) {
      const h = lines[j].match(/^(#{1,6})\s+/)
      if (h && h[1].length <= level) break
      body.push(lines[j])
    }
    out[id] = parseStep(id, body.join("\n"))
  }
  return out
}

function parseStep(id: string, md: string): StepDef {
  const match = md.match(/(^|\r?\n)```workflow-step\s*\r?\n([\s\S]*?)\r?\n```\s*(?:\r?\n)?/i)
  const config = match ? parseYaml(match[2]) : {}
  const prompt = match ? md.slice(0, match.index) + md.slice((match.index ?? 0) + match[0].length) : md
  return {
    id,
    prompt: prompt.trim(),
    command: stringField(config, "command"),
    commandArgs: listField(config, "commandArgs"),
    sendResult: boolField(config, "sendResult", false),
    required: boolField(config, "required", true),
    completeOnSuccess: boolField(config, "completeOnSuccess", false),
    runAgent: boolField(config, "runAgent", false),
    resultKey: stringField(config, "resultKey"),
    includeState: listField(config, "includeState"),
    maxResultBytes: numberField(config, "maxResultBytes", 20000),
    stateRequired: boolField(config, "stateRequired", true),
    captureResult: boolField(config, "captureResult", false),
    resultSource: resultSourceField(config),
    resultCommand: stringField(config, "resultCommand"),
    resultCommandArgs: listField(config, "resultCommandArgs")
  }
}

function sectionNamed(md: string, name: string): string | undefined {
  const lines = md.split(/\r?\n/)
  let start = -1
  let level = 0
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/)
    if (m && m[2].trim().toLowerCase() === name.toLowerCase()) { start = i + 1; level = m[1].length; break }
  }
  if (start < 0) return undefined
  const body: string[] = []
  for (let i = start; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/)
    if (m && m[1].length <= level) break
    body.push(lines[i])
  }
  return body.join("\n").trim()
}

function removeSection(md: string, name: string): string {
  const lines = md.split(/\r?\n/)
  let start = -1
  let end = lines.length
  let level = 0
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/)
    if (m && m[2].trim().toLowerCase() === name.toLowerCase()) { start = i; level = m[1].length; break }
  }
  if (start < 0) return md
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/)
    if (m && m[1].length <= level) { end = i; break }
  }
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n").replace(/\n{3,}/g, "\n\n")
}

function removeStepSections(md: string): string {
  const lines = md.split(/\r?\n/)
  const out: string[] = []
  for (let i = 0; i < lines.length;) {
    const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/)
    if (!m || !stepHeading(m[2])) { out.push(lines[i]); i++; continue }
    const level = m[1].length
    i++
    while (i < lines.length) {
      const h = lines[i].match(/^(#{1,6})\s+/)
      if (h && h[1].length <= level) break
      i++
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n")
}

function stepHeading(text: string): string | undefined { return text.trim().match(/^Step(?::|\s+)\s*([A-Za-z0-9_.-]+)\s*$/i)?.[1] }
function parseTodo(value: string, index = 1): Todo { const raw = value.trim(); const text = raw.replace(/^[-*]\s+\[[ xX]\]\s+/, ""); const m = text.match(/^([A-Za-z0-9_.-]+):\s+(.+)$/); return m ? { id: m[1], text: m[2].trim(), raw } : { id: `todo-${index}`, text, raw } }
function parseYaml(text: string): Record<string, unknown> { const out: Record<string, unknown> = {}; let listKey: string | undefined; for (const raw of text.split(/\r?\n/)) { const line = raw.replace(/\s+#.*$/, "").trim(); if (!line || line.startsWith("#")) continue; if (listKey && /^-\s+/.test(line)) { const arr = Array.isArray(out[listKey]) ? out[listKey] as unknown[] : []; arr.push(scalar(line.replace(/^-\s+/, ""))); out[listKey] = arr; continue } listKey = undefined; const m = line.match(/^([A-Za-z0-9_.-]+):(?:\s*(.*))?$/); if (!m) continue; if ((m[2] ?? "") === "") { out[m[1]] = []; listKey = m[1] } else out[m[1]] = scalar(m[2]) } return out }
function scalar(value: string): unknown { const text = value.trim(); if (text === "true") return true; if (text === "false") return false; if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) return text.slice(1, -1); return text }
function stringField(obj: Record<string, unknown>, key: string): string | undefined { const value = obj[key]; return typeof value === "string" && value.trim() ? value.trim() : undefined }
function boolField(obj: Record<string, unknown>, key: string, fallback: boolean): boolean { return typeof obj[key] === "boolean" ? obj[key] as boolean : fallback }
function numberField(obj: Record<string, unknown>, key: string, fallback: number): number { const value = obj[key]; if (typeof value === "number" && Number.isFinite(value)) return value; if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim()); return fallback }
function listField(obj: Record<string, unknown>, key: string, fallback: string[] = []): string[] { const value = obj[key]; if (Array.isArray(value)) return value.map(String).filter(Boolean); if (typeof value === "string" && value.trim()) return [value.trim()]; return fallback }
function stepCompletionField(obj: Record<string, unknown>, fallback: StepCompletion): StepCompletion { const value = stringField(obj, "stepCompletion"); if (value === "auto" || value === "manual") return value; return typeof obj.autoCompleteSteps === "boolean" ? (obj.autoCompleteSteps ? "auto" : "manual") : fallback }
function stepMessageField(obj: Record<string, unknown>): StepMessage { const value = stringField(obj, "stepMessage"); return value === "full" || value === "current" || value === "silent" || value === "step" ? value : "current" }
function resultSourceField(obj: Record<string, unknown>): "agent" | "lastAssistant" | undefined { const value = stringField(obj, "resultSource"); return value === "agent" || value === "lastAssistant" ? value : undefined }
