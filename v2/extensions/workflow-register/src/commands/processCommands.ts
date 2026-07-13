import * as fs from "fs/promises"
import { load } from "js-yaml"
import { validateProcessCatalog } from "../process/processCatalogValidator"
import { collectProcessEvidence } from "../process/processEvidence"
import { validateProcessInput } from "../process/processInputValidator"
import { generateCampaignSummary, writeProcessRecord } from "../process/processRecordStore"
import { validateProcessReviewResult } from "../process/processReviewResultValidator"
import { validateExistingWorkspacePath, validateSafePathSegment, workspacePath } from "../process/processPaths"
import type { ProcessEvidenceIndex, ProcessInput } from "../process/processTypes"

export interface ProcessCommandOptions {
  workspaceRoot: string
}

export interface ProcessCommandInput {
  workspaceRoot?: string
  workflowRoot?: string
  catalogPath?: string
  inputPath?: string
  evidenceIndexPath?: string
  reviewResultPath?: string
  recordPath?: string
  record?: unknown
  campaignId?: string
  runId?: string
}

export type ProcessCommandResult =
  | { status: "ok"; diagnostics: string[]; [key: string]: unknown }
  | { status: "error"; diagnostics: string[]; [key: string]: unknown }

export async function validateCatalogCommand(
  input: ProcessCommandInput = {},
  options: ProcessCommandOptions
): Promise<ProcessCommandResult> {
  return runProcessCommand(async () => {
    const loaded = await readWorkspaceData(options.workspaceRoot, input.catalogPath ?? ".bob/process/process-catalog.yaml")
    const validation = validateProcessCatalog(loaded.data)
    if (!validation.ok) {
      return error(validation.diagnostics)
    }
    return ok({
      catalog: validation.catalog,
      workflowCount: validation.catalog.workflows.length,
      relativePath: loaded.relativePath
    })
  })
}

export async function loadProcessInputCommand(
  input: ProcessCommandInput = {},
  options: ProcessCommandOptions
): Promise<ProcessCommandResult> {
  return runProcessCommand(async () => {
    const loaded = await readWorkspaceData(options.workspaceRoot, requiredPath(input.inputPath, "inputPath"))
    const validation = await validateProcessInput(loaded.data, { workspaceRoot: options.workspaceRoot })
    if (!validation.ok) {
      return error(validation.diagnostics)
    }
    return ok({ input: validation.input, relativePath: loaded.relativePath })
  })
}

export async function collectEvidenceCommand(
  input: ProcessCommandInput = {},
  options: ProcessCommandOptions
): Promise<ProcessCommandResult> {
  return runProcessCommand(async () => {
    const processInput = await loadAndValidateProcessInput(input, options)
    if (processInput.status === "error") return processInput
    const runId = input.runId ?? (processInput.input as ProcessInput).runId
    const runIdDiagnostic = validateSafePathSegment(runId, "runId")
    if (runIdDiagnostic) return error([runIdDiagnostic])
    const evidenceInput = { ...(processInput.input as ProcessInput), runId }
    const evidence = await collectProcessEvidence(options.workspaceRoot, evidenceInput)
    return ok(withProviderArtifact("evidenceIndex", evidence.relativePath, {
      index: evidence.index,
      absolutePath: evidence.absolutePath,
      relativePath: evidence.relativePath
    }))
  })
}

export async function validateReviewResultCommand(
  input: ProcessCommandInput = {},
  options: ProcessCommandOptions
): Promise<ProcessCommandResult> {
  return runProcessCommand(async () => {
    const review = await readWorkspaceData(options.workspaceRoot, requiredPath(input.reviewResultPath, "reviewResultPath"))
    const evidenceIndex = input.evidenceIndexPath
      ? (await readWorkspaceData(options.workspaceRoot, input.evidenceIndexPath)).data as ProcessEvidenceIndex
      : undefined
    const validation = validateProcessReviewResult(review.data, { evidenceIndex })
    if (!validation.ok) {
      return error(validation.diagnostics)
    }
    return ok({ result: validation.result, relativePath: review.relativePath })
  })
}

export async function writeProcessRecordCommand(
  input: ProcessCommandInput = {},
  options: ProcessCommandOptions
): Promise<ProcessCommandResult> {
  return runProcessCommand(async () => {
    const record = normalizeRecordForWrite(input.record ?? (await readWorkspaceData(options.workspaceRoot, requiredPath(input.recordPath, "recordPath"))).data)
    const gateDiagnostic = completedRequiredGateDiagnostic(record)
    if (gateDiagnostic) return error([gateDiagnostic])
    if (isRecord(record) && record.status === "completed" && record.reviewResultPath !== undefined) {
      const reviewDiagnostics = await validateExistingWorkspacePath(options.workspaceRoot, record.reviewResultPath, "reviewResultPath")
      if (reviewDiagnostics.length > 0) return error(reviewDiagnostics)
    }
    const written = await writeProcessRecord(options.workspaceRoot, record)
    return ok(withProviderArtifact("processRecord", written.relativePath, {
      absolutePath: written.absolutePath,
      relativePath: written.relativePath,
      backupAbsolutePath: written.backupAbsolutePath,
      backupRelativePath: written.backupRelativePath
    }))
  })
}

export async function generateCampaignSummaryCommand(
  input: ProcessCommandInput = {},
  options: ProcessCommandOptions
): Promise<ProcessCommandResult> {
  return runProcessCommand(async () => {
    const campaignId = requiredPath(input.campaignId, "campaignId")
    const summary = await generateCampaignSummary(options.workspaceRoot, campaignId)
    return ok(withProviderArtifact("campaignSummary", summary.relativePath, {
      summary: summary.summary,
      absolutePath: summary.absolutePath,
      relativePath: summary.relativePath
    }))
  })
}

async function loadAndValidateProcessInput(
  input: ProcessCommandInput,
  options: ProcessCommandOptions
): Promise<ProcessCommandResult> {
  const loaded = await readWorkspaceData(options.workspaceRoot, requiredPath(input.inputPath, "inputPath"))
  const validation = await validateProcessInput(loaded.data, { workspaceRoot: options.workspaceRoot })
  if (!validation.ok) {
    return error(validation.diagnostics)
  }
  return ok({ input: validation.input, relativePath: loaded.relativePath })
}

async function readWorkspaceData(workspaceRoot: string, relativePath: string): Promise<{ relativePath: string; data: unknown }> {
  const absolutePath = workspacePath(workspaceRoot, relativePath)
  const text = await fs.readFile(absolutePath, "utf8")
  return { relativePath: relativePath.replace(/\\/g, "/"), data: load(text) }
}

async function runProcessCommand(action: () => Promise<ProcessCommandResult>): Promise<ProcessCommandResult> {
  try {
    return await action()
  } catch (caught) {
    return error([caught instanceof Error ? caught.message : String(caught)])
  }
}

function requiredPath(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`${label} is required`)
  }
  return value
}

function ok(extra: Record<string, unknown>): ProcessCommandResult {
  return { status: "ok", diagnostics: [], ...extra }
}

function error(diagnostics: string[]): ProcessCommandResult {
  return { status: "error", diagnostics, message: diagnostics.join("; ") }
}

function withProviderArtifact(id: string, artifactPath: string, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    ...payload,
    $workflow: {
      artifacts: [{ id, ownership: "provider", path: artifactPath }]
    }
  }
}

function normalizeRecordForWrite(record: unknown): unknown {
  if (!isRecord(record) || !isRecord(record.humanGate)) return record
  const status = record.humanGate.status
  if (status !== "approved") return record
  return {
    ...record,
    humanGate: {
      ...record.humanGate,
      status: "accepted"
    }
  }
}

function completedRequiredGateDiagnostic(record: unknown): string | undefined {
  if (!isRecord(record) || record.status !== "completed" || !isRecord(record.humanGate)) return undefined
  if (record.humanGate.required !== true || record.humanGate.status === "accepted") return undefined
  return "completed process record requires humanGate.status 'accepted' when humanGate.required is true"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
