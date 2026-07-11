import {
  CoreWorkflowDefinition,
  EngineStep,
  ResultSinkDefinition,
  ResultSourceDefinition,
  WorkflowTransitionConditionDefinition
} from "./model"
import { validateApprovalExpression } from "./approvalGuardrails"
import { parseWorkflowMarkdown } from "./parser"
import { isReservedWorkflowStateKey } from "./stateKeys"

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

interface ResultKeyProducer {
  stepId: string
  source: string
  index: number
}

interface SkipResumeWorkflowMetadata {
  skipResume?: {
    fileBound?: boolean
  }
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
  const stepIndexes = new Map<string, number>()
  const resultKeyProducers = new Map<string, ResultKeyProducer[]>()

  if (workflow.todoRequired && (workflow.todos ?? []).length === 0) {
    diagnostics.push(error(filePath, "todoRequired is true but no todo items were found."))
  }
  if (workflow.stepMessage === "step") {
    for (const step of workflow.engineSteps) {
      if (step.type !== "result" && !step.prompt?.trim()) {
        diagnostics.push(warning(filePath, `stepMessage is 'step' but step '${step.id}' has no prompt.`))
      }
    }
  }

  for (const [index, step] of workflow.engineSteps.entries()) {
    if (stepIds.has(step.id)) diagnostics.push(error(filePath, `Duplicate step id '${step.id}'.`))
    stepIds.add(step.id)
    stepIndexes.set(step.id, index)
    if ("resultKey" in step && step.resultKey) addResultKeyProducer(resultKeyProducers, step.resultKey, step.id, "resultKey", index, diagnostics, filePath)
    if (step.type === "manual") {
      if (step.form?.resultKey) addResultKeyProducer(resultKeyProducers, step.form.resultKey, step.id, "form resultKey", index, diagnostics, filePath)
      if (step.approval?.resultKey) addResultKeyProducer(resultKeyProducers, step.approval.resultKey, step.id, "approval resultKey", index, diagnostics, filePath)
    }
    if (step.maxResultBytes !== undefined && step.maxResultBytes <= 0) {
      diagnostics.push(error(filePath, `Step '${step.id}' maxResultBytes must be greater than zero.`))
    }
    if (step.type === "command") validateCommandStep(step, options, diagnostics, filePath)
  }
  validateResultKeyConflicts(resultKeyProducers, diagnostics, filePath)
  const resultKeys = new Set(resultKeyProducers.keys())

  validateTodoStepMapping(workflow, stepIds, diagnostics, filePath)
  validateStateReferences(workflow.engineSteps, resultKeys, diagnostics, filePath)
  validateBranching(workflow, stepIndexes, resultKeyProducers, diagnostics, filePath)
  validateArtifacts(workflow, stepIds, diagnostics, filePath)
  validateSkipResumeFileBound(workflow, resultKeyProducers, diagnostics, filePath)
  validateInputs(workflow, diagnostics, filePath)
  validatePreflight(workflow, options, diagnostics, filePath)
  validateGuardrails(workflow, diagnostics, filePath)
  validateTemplatePlaceholders(workflow, diagnostics, filePath)
  return diagnostics
}

function addResultKeyProducer(
  producers: Map<string, ResultKeyProducer[]>,
  key: string,
  stepId: string,
  source: string,
  index: number,
  diagnostics: WorkflowDiagnostic[],
  filePath: string
): void {
  if (isReservedWorkflowStateKey(key)) {
    diagnostics.push(error(filePath, `Step '${stepId}' ${source} '${key}' uses the reserved workflow state namespace.`))
  }
  const items = producers.get(key) ?? []
  items.push({ stepId, source, index })
  producers.set(key, items)
}

function validateResultKeyConflicts(
  producers: Map<string, ResultKeyProducer[]>,
  diagnostics: WorkflowDiagnostic[],
  filePath: string
): void {
  for (const [key, items] of producers) {
    if (items.length < 2) continue
    const first = items[0]
    for (const item of items.slice(1)) {
      diagnostics.push(error(
        filePath,
        `Step '${item.stepId}' ${item.source} '${key}' conflicts with step '${first.stepId}' ${first.source}.`
      ))
    }
  }
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

function validateBranching(
  workflow: CoreWorkflowDefinition,
  stepIndexes: Map<string, number>,
  resultKeyProducers: Map<string, ResultKeyProducer[]>,
  diagnostics: WorkflowDiagnostic[],
  filePath: string
): void {
  const branching = workflow.branching
  const loopIds = new Set<string>()
  const loopEntrySteps = new Map<string, string>()
  if (branching) {
    for (const loop of branching.loops) {
      if (loopIds.has(loop.id)) diagnostics.push(error(filePath, `Duplicate branch loop id '${loop.id}'.`))
      loopIds.add(loop.id)
      loopEntrySteps.set(loop.id, loop.entryStep)
      if (!stepIndexes.has(loop.entryStep)) {
        diagnostics.push(error(filePath, `Branch loop '${loop.id}' entryStep references unknown step '${loop.entryStep}'.`))
      }
      if (loop.maxIterations <= 0) {
        diagnostics.push(error(filePath, `Branch loop '${loop.id}' maxIterations must be greater than zero.`))
      }
      if (loop.extensionSize <= 0) {
        diagnostics.push(error(filePath, `Branch loop '${loop.id}' extensionSize must be greater than zero.`))
      }
    }
  }

  for (const step of workflow.engineSteps) {
    if (!step.transition) continue
    if (branching?.enabled !== true) {
      diagnostics.push(error(filePath, `Step '${step.id}' defines transition but branching.enabled is not true.`))
    }
    validateTransition(step, stepIndexes, loopIds, loopEntrySteps, resultKeyProducers, diagnostics, filePath)
  }
}

function validateTransition(
  step: EngineStep,
  stepIndexes: Map<string, number>,
  loopIds: Set<string>,
  loopEntrySteps: Map<string, string>,
  resultKeyProducers: Map<string, ResultKeyProducer[]>,
  diagnostics: WorkflowDiagnostic[],
  filePath: string
): void {
  const transition = step.transition
  if (!transition) return
  const decisionIds = new Set<string>()
  for (const decision of transition.decisions) {
    if (decisionIds.has(decision.id)) {
      diagnostics.push(error(filePath, `Step '${step.id}' has Duplicate transition decision id '${decision.id}'.`))
    }
    decisionIds.add(decision.id)
    validateTransitionCondition(step.id, decision.id, decision.when, stepIndexes, resultKeyProducers, diagnostics, filePath)
    validateGoto(step, decision.goto, decision.loop, stepIndexes, loopIds, loopEntrySteps, diagnostics, filePath)
  }
  const defaultAction = transition.default ?? "next"
  if (defaultAction !== "next" && defaultAction !== "end" && defaultAction !== "fail") {
    validateGoto(step, defaultAction, undefined, stepIndexes, loopIds, loopEntrySteps, diagnostics, filePath, "transition default")
  }
}

function validateGoto(
  step: EngineStep,
  goto: string,
  loopId: string | undefined,
  stepIndexes: Map<string, number>,
  loopIds: Set<string>,
  loopEntrySteps: Map<string, string>,
  diagnostics: WorkflowDiagnostic[],
  filePath: string,
  label = "goto"
): void {
  if (loopId && !loopIds.has(loopId)) {
    diagnostics.push(error(filePath, `Step '${step.id}' ${label} loop references unknown loop '${loopId}'.`))
  }
  if (!stepIndexes.has(goto)) {
    diagnostics.push(error(filePath, `Step '${step.id}' ${label} references unknown step '${goto}'.`))
    return
  }
  const loopEntryStep = loopId ? loopEntrySteps.get(loopId) : undefined
  if (loopEntryStep && goto !== loopEntryStep) {
    diagnostics.push(error(filePath, `Step '${step.id}' ${label} loop '${loopId}' must target entryStep '${loopEntryStep}', not '${goto}'.`))
  }
  const currentIndex = stepIndexes.get(step.id) ?? 0
  const targetIndex = stepIndexes.get(goto) ?? currentIndex
  if (targetIndex < currentIndex && !loopId) {
    diagnostics.push(error(filePath, `Step '${step.id}' backward goto to '${goto}' must specify loop.`))
  }
}

function validateTransitionCondition(
  stepId: string,
  decisionId: string,
  condition: WorkflowTransitionConditionDefinition,
  stepIndexes: Map<string, number>,
  resultKeyProducers: Map<string, ResultKeyProducer[]>,
  diagnostics: WorkflowDiagnostic[],
  filePath: string
): void {
  const operators = [
    condition.equals !== undefined ? "equals" : undefined,
    condition.notEquals !== undefined ? "notEquals" : undefined,
    condition.in !== undefined ? "in" : undefined,
    condition.exists !== undefined ? "exists" : undefined,
    condition.truthy !== undefined ? "truthy" : undefined
  ].filter(Boolean)
  if (operators.length !== 1) {
    diagnostics.push(error(filePath, `Step '${stepId}' decision '${decisionId}' condition must specify exactly one operator.`))
  }
  const rootKey = condition.stateKey.split(".")[0]
  const producers = rootKey ? resultKeyProducers.get(rootKey) : undefined
  if (rootKey && !producers) {
    diagnostics.push(warning(filePath, `Step '${stepId}' decision '${decisionId}' condition stateKey '${condition.stateKey}' is not produced by a workflow resultKey.`))
    return
  }
  const currentIndex = stepIndexes.get(stepId)
  if (currentIndex === undefined || !producers) return
  const hasPriorProducer = producers.some((producer) => producer.index <= currentIndex)
  if (!hasPriorProducer) {
    const firstLaterProducer = [...producers].sort((left, right) => left.index - right.index)[0]
    diagnostics.push(error(
      filePath,
      `Step '${stepId}' decision '${decisionId}' condition stateKey '${condition.stateKey}' is produced by later step '${firstLaterProducer.stepId}'.`
    ))
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

function validateSkipResumeFileBound(
  workflow: CoreWorkflowDefinition,
  resultKeyProducers: Map<string, ResultKeyProducer[]>,
  diagnostics: WorkflowDiagnostic[],
  filePath: string
): void {
  const skipResume = (workflow as CoreWorkflowDefinition & SkipResumeWorkflowMetadata).skipResume
  if (skipResume?.fileBound !== true) return

  const artifactsByProducerAndId = new Set(
    workflow.artifacts
      .filter((artifact) => artifact.producedBy)
      .map((artifact) => artifactKey(artifact.producedBy as string, artifact.id))
  )
  const producerKeys = new Set<string>()
  for (const [resultKey, producers] of resultKeyProducers) {
    for (const producer of producers) {
      producerKeys.add(artifactKey(producer.stepId, resultKey))
      if (!artifactsByProducerAndId.has(artifactKey(producer.stepId, resultKey))) {
        diagnostics.push(warning(
          filePath,
          `File-bound skip resume is enabled but step '${producer.stepId}' ${producer.source} '${resultKey}' has no matching artifact id produced by the same step.`
        ))
      }
    }
  }

  for (const step of workflow.engineSteps) {
    if (step.type === "agent" && !step.resultKey) {
      diagnostics.push(warning(filePath, `File-bound skip resume is enabled but agent step '${step.id}' has no resultKey to persist as an artifact.`))
    }
    if (step.type === "result" && !step.result.sinks.some((sink) => sink.type === "file")) {
      diagnostics.push(warning(filePath, `File-bound skip resume is enabled but result step '${step.id}' has no file sink.`))
    }
  }

  for (const artifact of workflow.artifacts) {
    if (!artifact.producedBy) {
      diagnostics.push(warning(filePath, `File-bound skip resume artifact '${artifact.id}' should declare producedBy.`))
      continue
    }
    if (!producerKeys.has(artifactKey(artifact.producedBy, artifact.id))) {
      diagnostics.push(warning(filePath, `File-bound skip resume artifact '${artifact.id}' does not match a resultKey produced by step '${artifact.producedBy}'.`))
    }
    if (!isRunScopedArtifactPath(artifact.path)) {
      diagnostics.push(warning(filePath, `File-bound skip resume artifact '${artifact.id}' path should include '{{run.id}}' or '{{runId}}'.`))
    }
  }
}

function artifactKey(stepId: string, artifactId: string): string {
  return `${stepId}\u0000${artifactId}`
}

function isRunScopedArtifactPath(path: string): boolean {
  return /\{\{\s*(?:run\.id|runId)\s*\}\}/.test(path)
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
  if (message.includes("File-bound skip resume")) return "For skip-resumable workflows, give each reusable resultKey a same-id artifact with producedBy set to the producing step and a run-scoped path."
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
