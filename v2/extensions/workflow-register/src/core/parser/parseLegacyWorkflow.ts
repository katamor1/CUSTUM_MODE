import { createHash } from "crypto"
import * as path from "path"
import { CoreWorkflowDefinition, ParseWorkflowRequest, ParseWorkflowResult } from "../model"
import { legacyStepsFromMarkdown, legacyTodosFromMarkdown } from "./legacyMarkdown"
import { removeMarkdownSection, removeMarkdownStepSections } from "./markdownSections"
import { normalizeStepExecution, normalizeStepReview, stepCompletion, stepMessage } from "./normalizers"
import { arrayField, listField, optionalBoolean, optionalString } from "./yamlFields"

export function parseLegacyWorkflow(request: ParseWorkflowRequest, fields: Record<string, unknown>, body: string, fullText: string): ParseWorkflowResult {
  const name = optionalString(fields, "name") ?? path.basename(path.dirname(request.filePath))
  const description = optionalString(fields, "description")
  const diagnostics: string[] = []
  if (!description) diagnostics.push(`- fail: ${request.filePath}: missing required field 'description'.`)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) diagnostics.push(`- fail: ${request.filePath}: field 'name' must contain only letters, numbers, dot, underscore, or hyphen and must not start with punctuation.`)
  if (diagnostics.length > 0) return { ok: false, diagnostics }

  const prompt = optionalString(fields, "prompt") ?? body.trim()
  const engineSteps = legacyStepsFromMarkdown(body)
  const stepCompletionValue = stepCompletion(fields, "manual")
  const workflow: CoreWorkflowDefinition = {
    id: optionalString(fields, "id") ?? `${request.sourceId}.${name}`,
    name,
    label: optionalString(fields, "label") ?? optionalString(fields, "title") ?? name,
    menuLabel: optionalString(fields, "menuLabel") ?? optionalString(fields, "label") ?? optionalString(fields, "title") ?? name,
    description: description ?? "",
    schemaVersion: "legacy",
    definitionHash: `sha256:${createHash("sha256").update(fullText).digest("hex")}`,
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
    stepCompletion: stepCompletionValue,
    stepMessage: stepMessage(fields, "current"),
    stepExecution: normalizeStepExecution(fields.stepExecution, "todo"),
    stepReview: normalizeStepReview(fields.stepReview, stepCompletionValue),
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
