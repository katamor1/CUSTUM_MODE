import { createHash } from "crypto"
import Ajv from "ajv"
import {
  CoreWorkflowDefinition,
  EngineStep,
  ParseWorkflowRequest,
  ParseWorkflowResult,
  WorkflowTodoDefinition
} from "../model"
import { knownWorkflowV1TopLevelFields, workflowV1Schema } from "../workflowSchema"
import { legacyEngineStepsFromWorkflow, legacyTodosFromMarkdown, legacyTodosFromYamlList } from "./legacyMarkdown"
import { removeMarkdownSection, removeMarkdownStepSections } from "./markdownSections"
import {
  normalizeArtifacts,
  normalizeCompletion,
  normalizeEngineStep,
  normalizeGuardrails,
  normalizeInputs,
  normalizePreflight,
  normalizeRequires,
  normalizeStepReview,
  normalizeTools,
  stepCompletion,
  stepMessage
} from "./normalizers"
import { arrayField, asRecord, listField, optionalBoolean, optionalString, requiredString } from "./yamlFields"

const ajv = new Ajv({ allErrors: true, strict: false })
const validateV1 = ajv.compile(workflowV1Schema as object)

export function parseV1Workflow(request: ParseWorkflowRequest, fields: Record<string, unknown>, body: string, fullText: string): ParseWorkflowResult {
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
  const stepCompletionValue = stepCompletion(fields, todoEnabled && todos.length > 0 ? "manual" : "auto")
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
    stepCompletion: stepCompletionValue,
    stepMessage: stepMessage(fields, "current"),
    stepReview: normalizeStepReview(fields.stepReview, stepCompletionValue),
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

function formatValidationErrors(filePath: string): string[] {
  return (validateV1.errors ?? []).map((error) => {
    const location = error.instancePath || "/"
    return `- fail: ${filePath}: ${location} ${error.message ?? "is invalid"}.`
  })
}
