import * as vscode from "vscode"
import { buildCaptureWorkflowOptions } from "./workflowOptions"

const WORKFLOW_REGISTER_EXTENSION_ID = "local.workflow-register"

interface WorkflowActionExecutionInput {
  args: unknown
  inputs: Record<string, unknown>
  state?: Record<string, string>
  workflowId?: string
  logicalWorkflowId?: string
  workflowRoot?: string
  workflowFile?: string
  workflowFolderName?: string
  bobRoot?: string
  workspaceRoot?: string
  runId?: string
  stepId?: string
}

interface WorkflowActionProvider {
  id: string
  execute: (input: WorkflowActionExecutionInput) => Promise<unknown> | unknown
}

interface WorkflowRegisterApi {
  registerActionProvider: (provider: WorkflowActionProvider) => void
}

type WorkflowCommandHandler = (options?: unknown) => Promise<unknown> | unknown

export interface CodeConsistencyWorkflowHandlers {
  initializeWorkspace: WorkflowCommandHandler
  createReviewInput: WorkflowCommandHandler
  prepareAiReviewInputDraft: WorkflowCommandHandler
  applyAiReviewInputDraft: WorkflowCommandHandler
  prepareAiTraceabilityDraft: WorkflowCommandHandler
  applyAiTraceabilityDraft: WorkflowCommandHandler
  openTraceabilityPrep: WorkflowCommandHandler
  validateTraceabilityCatalog: WorkflowCommandHandler
  createReviewInputFromTraceability: WorkflowCommandHandler
  repairReviewInput: WorkflowCommandHandler
  explainReviewInputDiagnostics: WorkflowCommandHandler
  preprocess: WorkflowCommandHandler
  captureBobOutput: WorkflowCommandHandler
  validateOutput: WorkflowCommandHandler
  triage: WorkflowCommandHandler
}

export async function registerWorkflowProviders(handlers: CodeConsistencyWorkflowHandlers): Promise<void> {
  const api = await getWorkflowRegisterApi()
  if (!api) return

  api.registerActionProvider({
    id: "bobCodeConsistency.initializeWorkspace",
    execute: (input) => handlers.initializeWorkspace(mergeWorkflowOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.createReviewInput",
    execute: (input) => handlers.createReviewInput(mergeWorkflowOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.prepareAiReviewInputDraft",
    execute: (input) => handlers.prepareAiReviewInputDraft(mergeWorkflowOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.applyAiReviewInputDraft",
    execute: (input) => handlers.applyAiReviewInputDraft(mergeWorkflowOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.prepareAiTraceabilityDraft",
    execute: (input) => handlers.prepareAiTraceabilityDraft(mergeWorkflowOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.applyAiTraceabilityDraft",
    execute: (input) => handlers.applyAiTraceabilityDraft(mergeWorkflowOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.openTraceabilityPrep",
    execute: (input) => handlers.openTraceabilityPrep(mergeWorkflowOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.validateTraceabilityCatalog",
    execute: (input) => handlers.validateTraceabilityCatalog(mergeWorkflowOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.createReviewInputFromTraceability",
    execute: (input) => handlers.createReviewInputFromTraceability(mergeWorkflowOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.repairReviewInput",
    execute: (input) => handlers.repairReviewInput(mergeWorkflowOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.explainReviewInputDiagnostics",
    execute: (input) => handlers.explainReviewInputDiagnostics(mergeWorkflowOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.preprocess",
    execute: (input) => handlers.preprocess(mergeWorkflowOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.captureBobOutput",
    execute: (input) => handlers.captureBobOutput(buildCaptureBobOutputOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.validateOutput",
    execute: (input) => handlers.validateOutput(mergeWorkflowOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.triage",
    execute: (input) => handlers.triage(mergeWorkflowOptions(input))
  })
}

async function getWorkflowRegisterApi(): Promise<WorkflowRegisterApi | undefined> {
  const extension = vscode.extensions.getExtension<WorkflowRegisterApi>(WORKFLOW_REGISTER_EXTENSION_ID)
  if (!extension) {
    console.warn(`workflow-register 拡張機能が見つかりません: ${WORKFLOW_REGISTER_EXTENSION_ID}`)
    return undefined
  }

  const api = extension.isActive ? extension.exports : await extension.activate()
  if (!api?.registerActionProvider) {
    console.warn(
      `workflow-register 拡張機能が registerActionProvider を公開していません: ${WORKFLOW_REGISTER_EXTENSION_ID}`
    )
    return undefined
  }

  return api
}

function buildCaptureBobOutputOptions(input: WorkflowActionExecutionInput): Record<string, unknown> {
  const { args, inputs, state } = input
  return {
    ...optionRecord(buildCaptureWorkflowOptions({ args, inputs, state })),
    ...workflowContextOptions(input)
  }
}

function mergeWorkflowOptions(input: WorkflowActionExecutionInput): Record<string, unknown> {
  return {
    ...mergeOptions(input.inputs, input.args),
    ...workflowContextOptions(input)
  }
}

function workflowContextOptions(input: WorkflowActionExecutionInput): Record<string, unknown> {
  return {
    workflowRoot: input.workflowRoot,
    workflowFile: input.workflowFile,
    workflowFolderName: input.workflowFolderName,
    bobRoot: input.bobRoot,
    workspaceRoot: input.workspaceRoot
  }
}

function mergeOptions(inputs: Record<string, unknown>, args: unknown): Record<string, unknown> {
  return {
    ...inputs,
    ...optionRecord(args)
  }
}

export function optionRecord(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return optionRecord(value[0])
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
}
