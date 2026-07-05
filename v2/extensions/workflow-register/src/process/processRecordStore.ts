import * as fs from "fs/promises"
import * as path from "path"
import { dump, load } from "js-yaml"
import {
  PROCESS_CAMPAIGN_SUMMARY_SCHEMA_VERSION,
  PROCESS_HUMAN_GATE_STATUSES,
  PROCESS_PHASES,
  PROCESS_RECORD_SCHEMA_VERSION,
  PROCESS_RECORD_STATUSES,
  PROCESS_WORKFLOW_NAMES,
  type ProcessCampaignSummary,
  type ProcessHumanGateStatus,
  type ProcessPhase,
  type ProcessRecord,
  type ProcessRecordStatus
} from "./processTypes"
import {
  describeUnsafeWorkspacePath,
  toWorkspaceRelativePath,
  validateSafePathSegment,
  workspacePath
} from "./processPaths"

export interface WriteProcessRecordResult {
  absolutePath: string
  relativePath: string
  backupAbsolutePath?: string
  backupRelativePath?: string
}

export interface GenerateCampaignSummaryResult {
  absolutePath: string
  relativePath: string
  summary: ProcessCampaignSummary
}

export function validateProcessRecord(candidate: unknown): { ok: true; diagnostics: string[]; record: ProcessRecord } | { ok: false; diagnostics: string[] } {
  const diagnostics: string[] = []
  if (!isRecord(candidate)) {
    return { ok: false, diagnostics: ["process record must be an object"] }
  }
  expectExactString(diagnostics, candidate, "schemaVersion", PROCESS_RECORD_SCHEMA_VERSION)
  expectSafeSegment(diagnostics, candidate.campaignId, "campaignId")
  expectSafeSegment(diagnostics, candidate.runId, "runId")
  const workflowName = expectNonEmptyString(diagnostics, candidate, "workflowName")
  if (workflowName && !PROCESS_WORKFLOW_NAMES.includes(workflowName as typeof PROCESS_WORKFLOW_NAMES[number])) {
    diagnostics.push(`workflowName is not a registered Phase 3 workflow: ${workflowName}`)
  }
  const phase = expectNonEmptyString(diagnostics, candidate, "phase")
  if (phase && !PROCESS_PHASES.includes(phase as ProcessPhase)) {
    diagnostics.push(`phase is not supported: ${phase}`)
  }
  const status = expectNonEmptyString(diagnostics, candidate, "status")
  if (status && !PROCESS_RECORD_STATUSES.includes(status as ProcessRecordStatus)) {
    diagnostics.push(`status is not supported: ${status}`)
  }
  for (const key of ["inputPath", "artifactRoot", "evidenceIndexPath", "reviewResultPath"] as const) {
    if (candidate[key] !== undefined) {
      const diagnostic = describeUnsafeWorkspacePath(key, candidate[key])
      if (diagnostic) diagnostics.push(diagnostic)
    }
  }
  validateHumanGate(diagnostics, candidate.humanGate)
  validateMetrics(diagnostics, candidate.metrics)
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics }
  }
  return { ok: true, diagnostics, record: candidate as unknown as ProcessRecord }
}

export async function writeProcessRecord(
  workspaceRoot: string,
  record: unknown,
  options: { backupExisting?: boolean } = {}
): Promise<WriteProcessRecordResult> {
  const validation = validateProcessRecord(record)
  if (!validation.ok) {
    throw new Error(`invalid process record:\n${validation.diagnostics.join("\n")}`)
  }
  const relativePath = processRecordRelativePath(validation.record.campaignId, validation.record.runId)
  const absolutePath = workspacePath(workspaceRoot, relativePath)
  await fs.mkdir(path.dirname(absolutePath), { recursive: true })

  let backupAbsolutePath: string | undefined
  let backupRelativePath: string | undefined
  if (options.backupExisting !== false && await exists(absolutePath)) {
    const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "")
    backupRelativePath = relativePath.replace(/record\.yaml$/, `record.bak.${timestamp}.yaml`)
    backupAbsolutePath = workspacePath(workspaceRoot, backupRelativePath)
    await fs.copyFile(absolutePath, backupAbsolutePath)
  }

  await fs.writeFile(absolutePath, `${dump(validation.record, { lineWidth: 120, noRefs: true })}`, "utf8")
  return { absolutePath, relativePath, backupAbsolutePath, backupRelativePath }
}

export async function generateCampaignSummary(
  workspaceRoot: string,
  campaignId: string
): Promise<GenerateCampaignSummaryResult> {
  const segmentDiagnostic = validateSafePathSegment(campaignId, "campaignId")
  if (segmentDiagnostic) {
    throw new Error(segmentDiagnostic)
  }
  const recordsRelativeRoot = `.bob-process-records/campaigns/${campaignId}/records`
  const recordsRoot = workspacePath(workspaceRoot, recordsRelativeRoot)
  const records: ProcessRecord[] = []
  let invalidRecordCount = 0
  for (const entry of await readDirectories(recordsRoot)) {
    const recordPath = path.join(recordsRoot, entry, "record.yaml")
    try {
      const parsed = load(await fs.readFile(recordPath, "utf8"))
      const validation = validateProcessRecord(parsed)
      if (validation.ok) {
        records.push(validation.record)
      } else {
        invalidRecordCount += 1
      }
    } catch {
      invalidRecordCount += 1
    }
  }
  const summary: ProcessCampaignSummary = {
    schemaVersion: PROCESS_CAMPAIGN_SUMMARY_SCHEMA_VERSION,
    campaignId,
    generatedAt: new Date().toISOString(),
    recordCount: records.length,
    invalidRecordCount,
    statusCounts: countBy(records, (record) => record.status),
    workflowCounts: countBy(records, (record) => record.workflowName),
    humanGateCounts: countBy(records, (record) => record.humanGate.status),
    totalFindingCount: records.reduce((sum, record) => sum + (record.metrics?.findingCount ?? 0), 0),
    totalFailedChecks: records.reduce((sum, record) => sum + (record.metrics?.failedChecks ?? 0), 0)
  }
  const relativePath = `.bob-process-records/campaigns/${campaignId}/summary.yaml`
  const absolutePath = workspacePath(workspaceRoot, relativePath)
  await fs.mkdir(path.dirname(absolutePath), { recursive: true })
  await fs.writeFile(absolutePath, `${dump(summary, { lineWidth: 120, noRefs: true })}`, "utf8")
  return { absolutePath, relativePath, summary }
}

function processRecordRelativePath(campaignId: string, runId: string): string {
  const campaignSegment = toWorkspaceRelativePath(`.bob-process-records/campaigns/${campaignId}`)
  const runSegment = toWorkspaceRelativePath(`records/${runId}/record.yaml`)
  return `${campaignSegment}/${runSegment}`
}

function validateHumanGate(diagnostics: string[], value: unknown): void {
  if (!isRecord(value)) {
    diagnostics.push("humanGate must be an object")
    return
  }
  if (typeof value.required !== "boolean") {
    diagnostics.push("humanGate.required must be a boolean")
  }
  const status = expectNonEmptyString(diagnostics, value, "status", "humanGate")
  if (status && !PROCESS_HUMAN_GATE_STATUSES.includes(status as ProcessHumanGateStatus)) {
    diagnostics.push(`humanGate.status is not supported: ${status}`)
  }
  if (value.reviewer !== undefined && typeof value.reviewer !== "string") {
    diagnostics.push("humanGate.reviewer must be a string when present")
  }
  if (value.reviewedAt !== undefined && typeof value.reviewedAt !== "string") {
    diagnostics.push("humanGate.reviewedAt must be a string when present")
  }
}

function validateMetrics(diagnostics: string[], value: unknown): void {
  if (value === undefined) return
  if (!isRecord(value)) {
    diagnostics.push("metrics must be an object when present")
    return
  }
  for (const key of ["evidenceCount", "findingCount", "passedChecks", "failedChecks"]) {
    const metric = value[key]
    if (metric !== undefined && (!Number.isInteger(metric) || (metric as number) < 0)) {
      diagnostics.push(`metrics.${key} must be a non-negative integer`)
    }
  }
}

async function readDirectories(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  } catch {
    return []
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) {
    const value = key(item)
    counts[value] = (counts[value] ?? 0) + 1
  }
  return counts
}

function expectSafeSegment(diagnostics: string[], value: unknown, label: string): void {
  const diagnostic = validateSafePathSegment(value, label)
  if (diagnostic) diagnostics.push(diagnostic)
}

function expectExactString(
  diagnostics: string[],
  candidate: Record<string, unknown>,
  key: string,
  expected: string
): string | undefined {
  const value = candidate[key]
  if (value !== expected) {
    diagnostics.push(`${key} must be ${expected}`)
    return undefined
  }
  return value
}

function expectNonEmptyString(
  diagnostics: string[],
  candidate: Record<string, unknown>,
  key: string,
  prefix?: string
): string | undefined {
  const label = prefix ? `${prefix}.${key}` : key
  const value = candidate[key]
  if (typeof value !== "string" || value.trim().length === 0) {
    diagnostics.push(`${label} must be a non-empty string`)
    return undefined
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
