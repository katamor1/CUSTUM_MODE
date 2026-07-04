import { parseWorkflowMarkdown } from "../parser"
import {
  CoreWorkflowDefinition,
  EngineStep,
  WorkflowActionDefinition,
  WorkflowInputDefinition,
  WorkflowSchemaVersion
} from "../model"
import { WorkflowAuthoringInput, WorkflowAuthoringModel, WorkflowAuthoringStep } from "./workflowAuthoringModel"

const yaml = require("js-yaml") as { load(text: string): unknown }

export interface LoadAuthoringModelOptions {
  sourceId: string
  filePath: string
  text: string
}

export interface LoadAuthoringModelResult {
  model: WorkflowAuthoringModel
  diagnostics: string[]
  originalText: string
}

/**
 * GUI が所有し、form state から書き戻してよい front matter field。
 *
 * ここにない field は unknownFrontMatter として保持し、手書き workflow metadata を GUI 編集で落とさない。
 */
const guiManagedFrontMatterFields = new Set([
  "schemaVersion",
  "name",
  "description",
  "title",
  "mode",
  "workspaceRequired",
  "hidden",
  "inputs",
  "requires",
  "preflight",
  "guardrails",
  "branching",
  "artifacts",
  "completion",
  "steps"
])

/**
 * 既存の workflow-register/v1 WORKFLOW.md を GUI model として読み込む。
 *
 * semantic validation と normalize は parser に委ね、execution model が不要な authoring-only 情報
 * である unknown front matter と YAML block 後の Markdown body を保持する。
 */
export function loadAuthoringModelFromMarkdown(options: LoadAuthoringModelOptions): LoadAuthoringModelResult {
  const split = splitMarkdownFrontMatter(options.text)
  if (!split) throw new Error("WORKFLOW.md has no YAML front matter.")

  const frontMatter = asRecord(yaml.load(split.frontMatter))
  const parsed = parseWorkflowMarkdown({ sourceId: options.sourceId, filePath: options.filePath, text: options.text })
  if (!parsed.ok) throw new Error(parsed.diagnostics.join("\n"))
  if (parsed.workflow.schemaVersion !== "workflow-register/v1") throw new Error(`GUI editing supports schemaVersion=workflow-register/v1 only. Current schemaVersion is '${parsed.workflow.schemaVersion}'.`)

  return {
    model: workflowToAuthoringModel(parsed.workflow, frontMatter, split.body),
    diagnostics: parsed.diagnostics,
    originalText: options.text
  }
}

export function workflowToAuthoringModel(workflow: CoreWorkflowDefinition, frontMatter: Record<string, unknown> = {}, body = ""): WorkflowAuthoringModel {
  return {
    metadata: {
      schemaVersion: "workflow-register/v1",
      name: workflow.name,
      title: optionalString(frontMatter, "title") ?? workflow.label,
      description: workflow.description,
      mode: workflow.mode || "agent",
      workspaceRequired: workflow.workspaceRequired,
      hidden: workflow.hidden
    },
    inputs: inputsToAuthoringInputs(workflow.inputs),
    requires: workflow.requires,
    preflight: workflow.preflight,
    guardrails: workflow.guardrails,
    branching: workflow.branching,
    steps: workflow.engineSteps.map(engineStepToAuthoringStep),
    artifacts: workflow.artifacts,
    completion: workflow.completion,
    body: body.trim(),
    unknownFrontMatter: preservedFrontMatter(frontMatter)
  }
}

function inputsToAuthoringInputs(inputs: Record<string, WorkflowInputDefinition>): WorkflowAuthoringInput[] {
  return Object.entries(inputs).map(([id, input]) => ({ id, ...input }))
}

function engineStepToAuthoringStep(step: EngineStep): WorkflowAuthoringStep {
  const base = {
    id: step.id,
    title: step.title,
    type: step.type,
    required: step.required,
    prompt: step.prompt,
    sendResult: step.sendResult,
    completeOnSuccess: step.completeOnSuccess,
    includeState: step.includeState,
    maxResultBytes: step.maxResultBytes,
    stateRequired: step.stateRequired,
    resultKey: "resultKey" in step ? step.resultKey : undefined,
    transition: step.transition,
    userAction: step.userAction
  }
  if (step.type === "command") return { ...base, type: "command", action: normalizeAction(step.action) }
  if (step.type === "agent") return { ...base, type: "agent", result: step.result }
  if (step.type === "result") return { ...base, type: "result", result: step.result }
  return { ...base, type: "manual", form: step.form, approval: step.approval }
}

function normalizeAction(action: WorkflowActionDefinition): { provider: string; args?: unknown[] } {
  return { provider: action.provider, args: Array.isArray(action.args) ? action.args : action.args === undefined ? undefined : [action.args] }
}

/** user または将来の workflow-register version が所有する front matter を保持する。 */
function preservedFrontMatter(frontMatter: Record<string, unknown>): Record<string, unknown> | undefined {
  const preserved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(frontMatter)) {
    if (!guiManagedFrontMatterFields.has(key)) preserved[key] = value
  }
  return Object.keys(preserved).length > 0 ? preserved : undefined
}

function splitMarkdownFrontMatter(text: string): { frontMatter: string; body: string } | undefined {
  const normalized = text.replace(/^\uFEFF/, "")
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return undefined
  return { frontMatter: match[1], body: match[2] ?? "" }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" && value.trim() ? value : undefined
}

export function isWorkflowRegisterV1(schemaVersion: WorkflowSchemaVersion): schemaVersion is "workflow-register/v1" {
  return schemaVersion === "workflow-register/v1"
}
