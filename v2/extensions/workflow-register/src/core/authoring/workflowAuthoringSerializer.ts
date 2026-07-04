import { WorkflowAuthoringInput, WorkflowAuthoringModel, WorkflowAuthoringStep } from "./workflowAuthoringModel"
import {
  ResultSinkDefinition,
  ResultSourceDefinition,
  WorkflowApprovalRuleDefinition,
  WorkflowArtifactDefinition,
  WorkflowBranchingDefinition,
  WorkflowCompletionDefinition,
  WorkflowGuardrailsDefinition,
  WorkflowManualApprovalDefinition,
  WorkflowManualFormDefinition,
  WorkflowPreflightDefinition,
  WorkflowRequiresDefinition,
  WorkflowStepTransitionDefinition,
  WorkflowUserActionDefinition
} from "../model"
import { normalizeWorkflowName } from "../workflowScaffold"

const yaml = require("js-yaml") as { dump(value: unknown, options?: Record<string, unknown>): string }

export interface WorkflowAuthoringSerializationResult {
  name: string
  filePath: string
  markdown: string
}

/**
 * Converts the GUI authoring model into a complete WORKFLOW.md file.
 *
 * This serializer owns both YAML front matter generation and Markdown body
 * preservation. Keeping both outputs in one place makes the Builder save path
 * predictable: form fields update structured YAML while hand-written workflow
 * documentation remains in the Markdown body.
 */
export function serializeAuthoringModelToMarkdown(model: WorkflowAuthoringModel): WorkflowAuthoringSerializationResult {
  const name = normalizeWorkflowName(model.metadata.name)
  const title = model.metadata.title?.trim() || titleFromName(name)
  const description = model.metadata.description.trim() || `Run ${title}.`
  const filePath = `.bob/workflows/${name}/WORKFLOW.md`
  const frontMatter = compactObject({
    ...(model.unknownFrontMatter ?? {}),
    schemaVersion: "workflow-register/v1",
    name,
    description,
    title,
    mode: model.metadata.mode || "agent",
    workspaceRequired: model.metadata.workspaceRequired,
    hidden: model.metadata.hidden,
    inputs: inputsToRecord(model.inputs),
    requires: requiresOrUndefined(model.requires),
    preflight: nonEmptyArray(model.preflight.map(serializePreflight)),
    guardrails: guardrailsOrUndefined(model.guardrails),
    branching: branchingOrUndefined(model.branching),
    artifacts: nonEmptyArray(model.artifacts.map(serializeArtifact)),
    completion: completionOrUndefined(model.completion),
    steps: nonEmptyArray(model.steps.map(serializeStep)) ?? []
  })
  const frontMatterText = quoteStableYamlStrings(yaml.dump(frontMatter, { lineWidth: -1, noRefs: true, sortKeys: false }).trimEnd())
  const body = model.body?.trim() || `# ${title}\n\n## Goal\n\n${description}`
  return { name, filePath, markdown: `---\n${frontMatterText}\n---\n${body.trimEnd()}\n` }
}

function inputsToRecord(inputs: WorkflowAuthoringInput[]): Record<string, unknown> | undefined {
  if (inputs.length === 0) return undefined
  const out: Record<string, unknown> = {}
  for (const input of inputs) {
    const id = input.id.trim()
    if (!id) continue
    out[id] = compactObject({
      type: input.type || "string",
      title: input.title,
      required: input.required,
      requiredWhen: input.requiredWhen,
      prompt: input.prompt,
      default: input.default,
      options: input.options && input.options.length > 0 ? input.options : undefined
    })
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function serializeStep(step: WorkflowAuthoringStep): Record<string, unknown> {
  const base = compactObject({
    id: step.id,
    title: step.title,
    type: step.type,
    required: step.required,
    prompt: step.prompt,
    sendResult: step.sendResult,
    completeOnSuccess: step.completeOnSuccess,
    includeState: step.includeState && step.includeState.length > 0 ? step.includeState : undefined,
    maxResultBytes: step.maxResultBytes,
    stateRequired: step.stateRequired,
    resultKey: step.resultKey,
    transition: transitionOrUndefined(step.transition),
    userAction: userActionOrUndefined(step.userAction)
  })
  if (step.type === "command") return compactObject({ ...base, action: compactObject({ provider: step.action.provider, args: step.action.args && step.action.args.length > 0 ? step.action.args : undefined }) })
  if (step.type === "result") return compactObject({ ...base, result: serializeResult(step.result) })
  if (step.type === "agent" && step.result) return compactObject({ ...base, result: serializeResult(step.result) })
  if (step.type === "manual") return compactObject({
    ...base,
    form: manualFormOrUndefined(step.form),
    approval: manualApprovalOrUndefined(step.approval)
  })
  return base
}

function branchingOrUndefined(branching: WorkflowBranchingDefinition | undefined): Record<string, unknown> | undefined {
  if (!branching) return undefined
  const loops = branching.loops.map((loop) => compactObject({
    id: loop.id,
    title: loop.title,
    entryStep: loop.entryStep,
    maxIterations: loop.maxIterations,
    extensionSize: loop.extensionSize,
    checkpoint: loop.checkpoint ? compactObject({
      title: loop.checkpoint.title,
      message: loop.checkpoint.message
    }) : undefined
  }))
  return compactObject({
    enabled: branching.enabled,
    loops: nonEmptyArray(loops)
  })
}

function transitionOrUndefined(transition: WorkflowStepTransitionDefinition | undefined): Record<string, unknown> | undefined {
  if (!transition) return undefined
  const decisions = transition.decisions.map((decision) => compactObject({
    id: decision.id,
    when: compactObject({
      stateKey: decision.when.stateKey,
      equals: decision.when.equals,
      notEquals: decision.when.notEquals,
      in: decision.when.in,
      exists: decision.when.exists,
      truthy: decision.when.truthy
    }),
    goto: decision.goto,
    loop: decision.loop
  }))
  return compactObject({
    decisions: nonEmptyArray(decisions),
    default: transition.default
  })
}

function userActionOrUndefined(userAction: WorkflowUserActionDefinition | undefined): Record<string, unknown> | undefined {
  if (!userAction) return undefined
  const next = compactObject({
    message: userAction.message,
    completeLabel: userAction.completeLabel,
    confirmOnComplete: userAction.confirmOnComplete,
    confirmMessage: userAction.confirmMessage
  })
  return Object.keys(next).length > 0 ? next : undefined
}

function manualFormOrUndefined(form: WorkflowManualFormDefinition | undefined): Record<string, unknown> | undefined {
  if (!form) return undefined
  return compactObject({
    resultKey: form.resultKey,
    fields: nonEmptyArray(form.fields.map((field) => compactObject({
      id: field.id,
      title: field.title,
      type: field.type,
      required: field.required,
      multiline: field.multiline,
      options: field.options && field.options.length > 0 ? field.options : undefined
    })))
  })
}

function manualApprovalOrUndefined(approval: WorkflowManualApprovalDefinition | undefined): Record<string, unknown> | undefined {
  if (!approval) return undefined
  return compactObject({
    resultKey: approval.resultKey,
    approveLabel: approval.approveLabel,
    rejectLabel: approval.rejectLabel,
    message: approval.message
  })
}

function serializeResult(result: ResultSourceDefinition): Record<string, unknown> {
  if (result.source === "state") return compactObject({ source: "state", stateKey: result.stateKey, sinks: result.sinks.map(serializeSink) })
  if (result.source === "literal") return compactObject({ source: "literal", text: result.text, sinks: result.sinks.map(serializeSink) })
  return compactObject({ source: "agent", sinks: result.sinks.map(serializeSink) })
}

function serializeSink(sink: ResultSinkDefinition): Record<string, unknown> {
  if (sink.type === "command") return compactObject({ type: "command", command: sink.command, args: sink.args && sink.args.length > 0 ? sink.args : undefined })
  return compactObject({ type: "file", path: sink.path, encoding: sink.encoding })
}

function requiresOrUndefined(requires: WorkflowRequiresDefinition | undefined): WorkflowRequiresDefinition | undefined {
  if (!requires) return undefined
  const next = compactObject({
    workspace: requires.workspace,
    bob: requires.bob?.minVersion ? { minVersion: requires.bob.minVersion } : undefined,
    files: requires.files && requires.files.length > 0 ? requires.files : undefined
  }) as WorkflowRequiresDefinition
  return Object.keys(next).length > 0 ? next : undefined
}

function serializePreflight(preflight: WorkflowPreflightDefinition): Record<string, unknown> {
  return compactObject({
    id: preflight.id,
    title: preflight.title,
    required: preflight.required,
    checks: preflight.checks && preflight.checks.length > 0 ? preflight.checks : undefined,
    files: preflight.files && preflight.files.length > 0 ? preflight.files : undefined,
    failurePolicy: preflight.failurePolicy
  })
}

function guardrailsOrUndefined(guardrails: WorkflowGuardrailsDefinition | undefined): WorkflowGuardrailsDefinition | undefined {
  if (!guardrails) return undefined
  const approvals = guardrails.requireApproval?.map(serializeApproval).filter((item) => Object.keys(item).length > 0)
  const next = compactObject({
    allowedCommands: guardrails.allowedCommands && guardrails.allowedCommands.length > 0 ? guardrails.allowedCommands : undefined,
    deniedCommands: guardrails.deniedCommands && guardrails.deniedCommands.length > 0 ? guardrails.deniedCommands : undefined,
    allowedCommandIds: guardrails.allowedCommandIds && guardrails.allowedCommandIds.length > 0 ? guardrails.allowedCommandIds : undefined,
    deniedCommandIds: guardrails.deniedCommandIds && guardrails.deniedCommandIds.length > 0 ? guardrails.deniedCommandIds : undefined,
    requireApproval: approvals && approvals.length > 0 ? approvals : undefined
  }) as WorkflowGuardrailsDefinition
  return Object.keys(next).length > 0 ? next : undefined
}

function serializeApproval(approval: WorkflowApprovalRuleDefinition): Record<string, unknown> {
  return compactObject({ id: approval.id, when: approval.when, message: approval.message })
}

function serializeArtifact(artifact: WorkflowArtifactDefinition): Record<string, unknown> {
  return compactObject({ id: artifact.id, producedBy: artifact.producedBy, path: artifact.path, schema: artifact.schema })
}

function completionOrUndefined(completion: WorkflowCompletionDefinition | undefined): WorkflowCompletionDefinition | undefined {
  if (!completion) return undefined
  const visualization = completion.visualization ? compactObject({ type: completion.visualization.type, enabled: completion.visualization.enabled }) : undefined
  const next = compactObject({
    summary: completion.summary,
    includeArtifacts: completion.includeArtifacts,
    validateResult: completion.validateResult,
    visualization: visualization && Object.keys(visualization).length > 0 ? visualization : undefined
  }) as WorkflowCompletionDefinition
  return Object.keys(next).length > 0 ? next : undefined
}

/**
 * Keeps selected string fields quoted in generated YAML to reduce diffs against
 * hand-authored workflow files.
 *
 * YAML parses quoted and unquoted values as the same string for these schema
 * fields, but preserving quotes for version numbers and approval condition
 * expressions makes reviews easier to read and avoids noisy rewrites.
 */
function quoteStableYamlStrings(text: string): string {
  return text
    .split("\n")
    .map((line) => quoteYamlLineValue(line, "minVersion"))
    .map((line) => quoteYamlLineValue(line, "when"))
    .join("\n")
}

function quoteYamlLineValue(line: string, key: string): string {
  const match = line.match(new RegExp(`^(\\s*${key}:\\s+)(.+)$`))
  if (!match) return line
  const value = match[2].trim()
  if (!value || value.startsWith("\"") || value.startsWith("'") || value === "|" || value === ">") return line
  return `${match[1]}${JSON.stringify(value)}`
}

function nonEmptyArray<T>(value: T[]): T[] | undefined {
  return value.length > 0 ? value : undefined
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue
    if (typeof entry === "string" && entry.length === 0) continue
    out[key] = entry
  }
  return out as T
}

function titleFromName(name: string): string {
  return name.split(/[._-]+/).filter(Boolean).map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ") || "New Workflow"
}
