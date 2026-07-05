import * as vscode from "vscode"
import { buildCaptureWorkflowOptions } from "./workflowOptions"
import { buildSafeWorkflowOptions, optionRecord } from "./workflowUserOptions"

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

const REVIEW_METADATA_WORKFLOW_KEYS = [
  "base",
  "changeType",
  "change_type",
  "head",
  "id",
  "outOfScope",
  "out_of_scope",
  "purpose",
  "reviewId",
  "reviewPurpose",
  "reviewTitle",
  "ticketIds",
  "ticket_ids",
  "title",
  "vcs",
  "vcsRoot",
  "vcs_root"
] as const

const WORKFLOW_COMMAND_ALLOWED_OPTIONS: Record<string, readonly string[]> = {
  "bobCodeConsistency.initializeWorkspace": ["reviewInputPath"],
  "bobCodeConsistency.createReviewInput": ["reviewInputPath", "textEncoding"],
  "bobCodeConsistency.prepareAiReviewInputDraft": [
    "aiDraftPromptPath",
    "base",
    "head",
    "reviewInputPath",
    "textEncoding",
    "vcs",
    "vcsRoot",
    "vcs_root"
  ],
  "bobCodeConsistency.applyAiReviewInputDraft": ["reviewInputPath", "strictPaths", "text"],
  "bobCodeConsistency.prepareAiTraceabilityDraft": [
    "aiTraceabilityDraftPromptPath",
    "base",
    "docsRoot",
    "head",
    "textEncoding",
    "traceabilityCatalogPath",
    "vcs",
    "vcsRoot",
    "vcs_root"
  ],
  "bobCodeConsistency.applyAiTraceabilityDraft": [
    "aiTraceabilityDraftPromptPath",
    "text",
    "textEncoding",
    "traceabilityCatalogPath",
    "traceabilityDraftJsonPath",
    "traceabilityGateReportPath"
  ],
  "bobCodeConsistency.openTraceabilityPrep": ["textEncoding", "traceabilityCatalogPath", "traceabilityGateReportPath"],
  "bobCodeConsistency.validateTraceabilityCatalog": ["textEncoding", "traceabilityCatalogPath", "traceabilityGateReportPath"],
  "bobCodeConsistency.createReviewInputFromTraceability": [
    ...REVIEW_METADATA_WORKFLOW_KEYS,
    "reviewFocus",
    "review_focus",
    "reviewInputPath",
    "strictPaths",
    "textEncoding",
    "traceabilityCatalogPath",
    "traceabilityGateReportPath"
  ],
  "bobCodeConsistency.repairReviewInput": ["reviewInputPath", "textEncoding"],
  "bobCodeConsistency.explainReviewInputDiagnostics": ["reviewInputPath", "textEncoding"],
  "bobCodeConsistency.preprocess": [
    "maxBobInputBytes",
    "maxDocumentBytes",
    "maxExcerptBytesPerDocument",
    "maxRawDiffBytes",
    "maxRowsPerSheet",
    "maxWorkbookSheets",
    "outDir",
    "reviewInputPath",
    "reviewPackagePath",
    "textEncoding"
  ],
  "bobCodeConsistency.validateOutput": ["bobOutputPath", "packageDir", "reviewPackagePath"],
  "bobCodeConsistency.triage": ["bobOutputPath", "outDir", "packageDir", "reviewPackagePath", "triagePath"]
}

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
    execute: (input) => handlers.initializeWorkspace(mergeWorkflowOptions("bobCodeConsistency.initializeWorkspace", input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.createReviewInput",
    execute: (input) => handlers.createReviewInput(mergeWorkflowOptions("bobCodeConsistency.createReviewInput", input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.prepareAiReviewInputDraft",
    execute: (input) => handlers.prepareAiReviewInputDraft(mergeWorkflowOptions("bobCodeConsistency.prepareAiReviewInputDraft", input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.applyAiReviewInputDraft",
    execute: (input) => handlers.applyAiReviewInputDraft(mergeWorkflowOptions("bobCodeConsistency.applyAiReviewInputDraft", input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.prepareAiTraceabilityDraft",
    execute: (input) => handlers.prepareAiTraceabilityDraft(mergeWorkflowOptions("bobCodeConsistency.prepareAiTraceabilityDraft", input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.applyAiTraceabilityDraft",
    execute: (input) => handlers.applyAiTraceabilityDraft(buildApplyTraceabilityDraftOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.openTraceabilityPrep",
    execute: (input) => handlers.openTraceabilityPrep(mergeWorkflowOptions("bobCodeConsistency.openTraceabilityPrep", input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.validateTraceabilityCatalog",
    execute: (input) => handlers.validateTraceabilityCatalog(mergeWorkflowOptions("bobCodeConsistency.validateTraceabilityCatalog", input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.createReviewInputFromTraceability",
    execute: (input) => handlers.createReviewInputFromTraceability(mergeWorkflowOptions("bobCodeConsistency.createReviewInputFromTraceability", input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.repairReviewInput",
    execute: (input) => handlers.repairReviewInput(mergeWorkflowOptions("bobCodeConsistency.repairReviewInput", input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.explainReviewInputDiagnostics",
    execute: (input) => handlers.explainReviewInputDiagnostics(mergeWorkflowOptions("bobCodeConsistency.explainReviewInputDiagnostics", input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.preprocess",
    execute: (input) => handlers.preprocess(mergeWorkflowOptions("bobCodeConsistency.preprocess", input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.captureBobOutput",
    execute: (input) => handlers.captureBobOutput(buildCaptureBobOutputOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.validateOutput",
    execute: (input) => handlers.validateOutput(mergeWorkflowOptions("bobCodeConsistency.validateOutput", input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.triage",
    execute: (input) => handlers.triage(mergeWorkflowOptions("bobCodeConsistency.triage", input))
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

export function buildApplyTraceabilityDraftOptions(input: WorkflowActionExecutionInput): Record<string, unknown> {
  const options = mergeWorkflowOptions("bobCodeConsistency.applyAiTraceabilityDraft", input)
  if (typeof options.text === "string" && options.text.trim().length > 0) return options
  const draftText = input.state?.traceabilityDraftJson
  if (typeof draftText === "string" && draftText.trim().length > 0) {
    return { ...options, text: draftText }
  }
  return options
}

function mergeWorkflowOptions(commandId: string, input: WorkflowActionExecutionInput): Record<string, unknown> {
  return {
    ...buildSafeWorkflowOptions({
      commandId,
      inputs: input.inputs,
      args: input.args,
      allowedKeys: WORKFLOW_COMMAND_ALLOWED_OPTIONS[commandId] ?? []
    }),
    ...workflowContextOptions(input)
  }
}

function workflowContextOptions(input: WorkflowActionExecutionInput): Record<string, unknown> {
  return {
    workflowRoot: input.workflowRoot,
    workflowFile: input.workflowFile,
    workflowFolderName: input.workflowFolderName,
    bobRoot: input.bobRoot,
    workspaceRoot: input.workspaceRoot,
    workflowRunId: input.runId
  }
}

export { optionRecord }
