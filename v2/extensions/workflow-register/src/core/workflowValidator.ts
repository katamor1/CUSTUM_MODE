import {
  CoreWorkflowDefinition,
  EngineStep,
  ResultSinkDefinition,
  ResultSourceDefinition
} from "./model"
import { validateApprovalExpression } from "./approvalGuardrails"
import { parseWorkflowMarkdown } from "./parser"

export type WorkflowDiagnosticSeverity = "error" | "warning" | "info"

export interface WorkflowDiagnostic {
  severity: WorkflowDiagnosticSeverity
  message: string
  filePath?: string
}

export interface ValidateWorkflowTextOptions {
  sourceId: string
  filePath: string
  text: string
  strict?: boolean
  availableActionProviders?: string[]
  availablePreflightChecks?: string[]
}

export interface ValidateWorkflowResult {
  ok: boolean
  workflow?: CoreWorkflowDefinition
  diagnostics: WorkflowDiagnostic[]
}

export function validateWorkflowText(options: ValidateWorkflowTextOptions): ValidateWorkflowResult {
  const parsed = parseWorkflowMarkdown({ sourceId: options.sourceId, filePath: options.filePath, text: options.text })
  const diagnostics = parsed.diagnostics.map((line) => diagnosticFromParserLine(line, options.filePath))
  if (parsed.ok) diagnostics.push(...validateCoreWorkflow(parsed.workflow, options))
  if (options.strict) for (const item of diagnostics) if (item.severity === "warning") item.severity = "error"
  return {
    ok: parsed.ok && !diagnostics.some((item) => item.severity === "error"),
    workflow: parsed.ok ? parsed.workflow : undefined,
    diagnostics
  }
}

export function validateCoreWorkflow(
  workflow: CoreWorkflowDefinition,
  options: Omit<ValidateWorkflowTextOptions, "sourceId" | "text">
): WorkflowDiagnostic[] {
  const diagnostics: WorkflowDiagnostic[] = []
  const filePath = options.filePath
  const stepIds = new Set<string>()
  const resultKeys = new Set<string>()

  if (workflow.todoRequired && workflow.todos.length === 0) {
    diagnostics.push(error(filePath, "todoRequired is true but no todo items were found."))
  }
  if (workflow.stepMessage === "step") {
    for (const step of workflow.engineSteps) {
      if (!step.prompt?.trim()) {
        diagnostics.push(warning(filePath, `stepMessage is 'step' but step '${step.id}' has no prompt.`))
      }
    }
  }

  for (const step of workflow.engineSteps) {
    if (stepIds.has(step.id)) diagnostics.push(error(filePath, `Duplicate step id '${step.id}'.`))
    stepIds.add(step.id)
    if ("resultKey" in step && step.resultKey) resultKeys.add(step.resultKey)
    if (step.maxResultBytes !== undefined && step.maxResultBytes <= 0) {
      diagnostics.push(error(filePath, `Step '${step.id}' maxResultBytes must be greater than zero.`))
    }
    if (step.type === "command") validateCommandStep(step, options, diagnostics, filePath)
  }

  validateTodoStepMapping(workflow, stepIds, diagnostics, filePath)
  validateStateReferences(workflow.engineSteps, resultKeys, diagnostics, filePath)
  validateArtifacts(workflow, stepIds, diagnostics, filePath)
  validateInputs(workflow, diagnostics, filePath)
  validatePreflight(workflow, options, diagnostics, filePath)
  validateGuardrails(workflow, diagnostics, filePath)
  validateTemplatePlaceholders(workflow, diagnostics, filePath)
  return diagnostics
}

export function formatWorkflowDiagnostics(result: ValidateWorkflowResult): string[] {
  if (result.diagnostics.length === 0) return ["- ok: No workflow diagnostics."]
  const lines: string[] = []
  for (const item of result.diagnostics) {
    lines.push(`- ${item.severity}: ${item.filePath ? `${item.filePath}: ` : ""}${item.message}`)
    const hint = diagnosticHint(item.message)
    if (hint) lines.push(`  - hint: ${hint}`)
  }
  return lines
}

function validateCommandStep(
  step: Extract<EngineStep, { type: "command" }>,
  options: Omit<ValidateWorkflowTextOptions, "sourceId" | "text">,
  diagnostics: WorkflowDiagnostic[],
  filePath: string
): void {
  if (!step.action.provider.trim()) diagnostics.push(error(filePath, `Command step '${step.id}' action.provider is empty.`))
  if (options.availableActionProviders && !options.availableActionProviders.includes(step.action.provider)) {
    diagnostics.push(error(filePath, `Command step '${step.id}' uses unsupported action provider '${step.action.provider}'.`))
  }
}

function validateTodoStepMapping(workflow: CoreWorkflowDefinition, stepIds: Set<string>, diagnostics: WorkflowDiagnostic[], filePath: string): void {
  if (!workflow.todoAsSteps) return
  const todoIds = new Set(workflow.todos.map((todo) => todo.id))
  for (const todo of workflow.todos) {
    if (!stepIds.has(todo.id)) diagnostics.push(error(filePath, `Todo '${todo.id}' has no matching step.`))
  }
  for (const step of workflow.engineSteps) {
    if (!todoIds.has(step.id)) diagnostics.push(warning(filePath, `Step '${step.id}' has no matching Todo item.`))
  }
}

function validateStateReferences(steps: EngineStep[], resultKeys: Set<string>, diagnostics: WorkflowDiagnostic[], filePath: string): void {
  for (const step of steps) {
    for (const key of step.includeState ?? []) {
      if (!resultKeys.has(key)) {
        diagnostics.push(error(filePath, `Step '${step.id}' includeState references unknown resultKey '${key}'.`))
      }
    }
    if ((step.type === "agent" || step.type === "result") && step.result) {
      validateResultSource(step.id, step.result, resultKeys, diagnostics, filePath)
    }
  }
}

function validateResultSource(
  stepId: string,
  result: ResultSourceDefinition,
  resultKeys: Set<string>,
  diagnostics: WorkflowDiagnostic[],
  filePath: string
): void {
  if (result.source === "state" && !resultKeys.has(result.stateKey)) {
    diagnostics.push(error(filePath, `Step '${stepId}' result references unknown stateKey '${result.stateKey}'.`))
  }
  for (const sink of result.sinks) validateResultSink(stepId, sink, diagnostics, filePath)
}

function validateResultSink(stepId: string, sink: ResultSinkDefinition, diagnostics: WorkflowDiagnostic[], filePath: string): void {
  if (sink.type === "command" && !sink.command.trim()) diagnostics.push(error(filePath, `Step '${stepId}' command result sink has no command.`))
  if (sink.type === "file" && !sink.path.trim()) diagnostics.push(error(filePath, `Step '${stepId}' file result sink has no path.`))
}

function validateArtifacts(workflow: CoreWorkflowDefinition, stepIds: Set<string>, diagnostics: WorkflowDiagnostic[], filePath: string): void {
  const artifactIds = new Set<string>()
  for (const artifact of workflow.artifacts) {
    if (artifactIds.has(artifact.id)) diagnostics.push(error(filePath, `Duplicate artifact id '${artifact.id}'.`))
    artifactIds.add(artifact.id)
    if (artifact.producedBy && !stepIds.has(artifact.producedBy)) {
      diagnostics.push(error(filePath, `Artifact '${artifact.id}' references unknown producedBy step '${artifact.producedBy}'.`))
    }
  }
}

function validateInputs(workflow: CoreWorkflowDefinition, diagnostics: WorkflowDiagnostic[], filePath: string): void {
  for (const [key, input] of Object.entries(workflow.inputs)) {
    if (input.type === "select" && (!input.options || input.options.length === 0)) {
      diagnostics.push(error(filePath, `Input '${key}' is select but has no options.`))
    }
    if (input.requiredWhen) {
      const referenced = input.requiredWhen.match(/^\s*(?:inputs\.)?([A-Za-z0-9_.-]+)\s*(?:==|!=)\s*.+$/)?.[1]
      if (!referenced) {
        diagnostics.push(warning(filePath, `Input '${key}' has an unsupported requiredWhen expression: ${input.requiredWhen}`))
      } else if (!workflow.inputs[referenced]) {
        diagnostics.push(error(filePath, `Input '${key}' requiredWhen references unknown input '${referenced}'.`))
      }
    }
  }
}

function validatePreflight(
  workflow: CoreWorkflowDefinition,
  options: Omit<ValidateWorkflowTextOptions, "sourceId" | "text">,
  diagnostics: WorkflowDiagnostic[],
  filePath: string
): void {
  if (!options.availablePreflightChecks) return
  for (const preflight of workflow.preflight) {
    for (const check of preflight.checks ?? []) {
      if (!options.availablePreflightChecks.includes(check)) {
        diagnostics.push(warning(filePath, `Preflight '${preflight.id}' references unknown check '${check}'.`))
      }
    }
  }
}

function validateGuardrails(workflow: CoreWorkflowDefinition, diagnostics: WorkflowDiagnostic[], filePath: string): void {
  const allowed = new Set(workflow.guardrails.allowedCommands ?? [])
  for (const denied of workflow.guardrails.deniedCommands ?? []) {
    if (allowed.has(denied)) diagnostics.push(error(filePath, `Guardrail command '${denied}' is both allowed and denied.`))
  }
  const allowedCommandIds = new Set(workflow.guardrails.allowedCommandIds ?? [])
  for (const denied of workflow.guardrails.deniedCommandIds ?? []) {
    if (allowedCommandIds.has(denied)) diagnostics.push(error(filePath, `Guardrail command id '${denied}' is both allowed and denied.`))
  }
  for (const rule of workflow.guardrails.requireApproval ?? []) {
    const issue = validateApprovalExpression(rule.when)
    if (issue) diagnostics.push(error(filePath, rule.id ? `${issue} (rule: ${rule.id})` : issue))
  }
}

function validateTemplatePlaceholders(workflow: CoreWorkflowDefinition, diagnostics: WorkflowDiagnostic[], filePath: string): void {
  for (const artifact of workflow.artifacts) {
    warnBareTemplatePlaceholders(artifact.path, `artifact '${artifact.id}' path`, diagnostics, filePath)
  }
  for (const step of workflow.engineSteps) {
    warnBareTemplatePlaceholders(step.prompt, `step '${step.id}' prompt`, diagnostics, filePath)
    if (step.type === "command") warnBareTemplateValues(step.action.args, `step '${step.id}' action.args`, diagnostics, filePath)
    if ((step.type === "agent" || step.type === "result") && step.result) {
      if (step.result.source === "literal") warnBareTemplatePlaceholders(step.result.text, `step '${step.id}' result.text`, diagnostics, filePath)
      for (const sink of step.result.sinks) {
        if (sink.type === "file") warnBareTemplatePlaceholders(sink.path, `step '${step.id}' file sink path`, diagnostics, filePath)
        if (sink.type === "command") warnBareTemplateValues(sink.args, `step '${step.id}' command sink args`, diagnostics, filePath)
      }
    }
  }
}

function warnBareTemplateValues(value: unknown, location: string, diagnostics: WorkflowDiagnostic[], filePath: string): void {
  if (typeof value === "string") {
    warnBareTemplatePlaceholders(value, location, diagnostics, filePath)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => warnBareTemplateValues(item, `${location}[${index}]`, diagnostics, filePath))
    return
  }
  if (!value || typeof value !== "object") return
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    warnBareTemplateValues(item, `${location}.${key}`, diagnostics, filePath)
  }
}

function warnBareTemplatePlaceholders(value: string | undefined, location: string, diagnostics: WorkflowDiagnostic[], filePath: string): void {
  if (!value) return
  const matches = value.matchAll(/\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g)
  for (const match of matches) {
    diagnostics.push(warning(
      filePath,
      `Deprecated bare template placeholder '{{${match[1]}}}' in ${location}; use an explicit namespace such as '{{inputs.${match[1]}}}', '{{state.${match[1]}}}', or '{{json state.<resultKey>.${match[1]}}}'.`
    ))
  }
}

function diagnosticFromParserLine(line: string, filePath: string): WorkflowDiagnostic {
  const trimmed = line.replace(/^[-*]\s*/, "")
  if (trimmed.startsWith("fail:")) return error(filePath, trimmed.slice(5).trim())
  if (trimmed.startsWith("warn:")) return warning(filePath, trimmed.slice(5).trim())
  return { severity: "info", filePath, message: trimmed.replace(/^ok:\s*/, "") }
}

function diagnosticHint(message: string): string | undefined {
  if (message.includes("includeState references unknown resultKey")) {
    return "Add resultKey to an earlier command or agent step, or remove the includeState entry."
  }
  if (message.includes("result references unknown stateKey")) return "Use a stateKey produced by an earlier resultKey."
  if (message.includes("Duplicate step id")) return "Each step id must be unique within one WORKFLOW.md."
  if (message.includes("select but has no options")) return "Add an options list to the select input."
  if (message.includes("producedBy step")) return "Set producedBy to the id of a step that exists in steps."
  if (message.includes("command id")) return "Keep each VS Code command id in either allowedCommandIds or deniedCommandIds, not both."
  if (message.includes("both allowed and denied")) return "Keep each command in either allowedCommands or deniedCommands, not both."
  if (message.includes("missing YAML front matter")) return "Start the file with a YAML front matter block delimited by ---."
  if (message.includes("invalid YAML")) return "Check indentation, list markers, and quoted strings in the front matter."
  return undefined
}

function error(filePath: string, message: string): WorkflowDiagnostic {
  return { severity: "error", filePath, message }
}

function warning(filePath: string, message: string): WorkflowDiagnostic {
  return { severity: "warning", filePath, message }
}
