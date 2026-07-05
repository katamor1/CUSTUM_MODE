import {
  PROCESS_CHECK_STATUSES,
  PROCESS_FINDING_SEVERITIES,
  PROCESS_REVIEW_RESULT_SCHEMA_VERSION,
  PROCESS_REVIEW_STATUSES,
  PROCESS_WORKFLOW_NAMES,
  type ProcessCheckStatus,
  type ProcessEvidenceIndex,
  type ProcessFindingSeverity,
  type ProcessReviewResult,
  type ProcessReviewStatus
} from "./processTypes"
import { validateSafePathSegment } from "./processPaths"

export interface ProcessReviewResultValidationOptions {
  evidenceIndex?: Pick<ProcessEvidenceIndex, "entries">
}

export type ProcessReviewResultValidationResult =
  | { ok: true; diagnostics: string[]; result: ProcessReviewResult }
  | { ok: false; diagnostics: string[]; result?: ProcessReviewResult }

export function validateProcessReviewResult(
  candidate: unknown,
  options: ProcessReviewResultValidationOptions = {}
): ProcessReviewResultValidationResult {
  const diagnostics: string[] = []
  if (!isRecord(candidate)) {
    return { ok: false, diagnostics: ["process review result must be an object"] }
  }
  expectExactString(diagnostics, candidate, "schemaVersion", PROCESS_REVIEW_RESULT_SCHEMA_VERSION)
  expectSafeSegment(diagnostics, candidate.campaignId, "campaignId")
  expectSafeSegment(diagnostics, candidate.runId, "runId")
  const workflowName = expectNonEmptyString(diagnostics, candidate, "workflowName")
  if (workflowName && !PROCESS_WORKFLOW_NAMES.includes(workflowName as typeof PROCESS_WORKFLOW_NAMES[number])) {
    diagnostics.push(`workflowName is not a registered Phase 3 workflow: ${workflowName}`)
  }
  const status = expectNonEmptyString(diagnostics, candidate, "status")
  if (status && !PROCESS_REVIEW_STATUSES.includes(status as ProcessReviewStatus)) {
    diagnostics.push(`status is not supported: ${status}`)
  }
  const evidenceIds = new Set((options.evidenceIndex?.entries ?? [])
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0))
  const checklistCounts = validateChecklist(diagnostics, candidate.checklist, evidenceIds)
  validateFindings(diagnostics, candidate.findings, evidenceIds)
  validateSummary(diagnostics, candidate.summary, checklistCounts)
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics }
  }
  return { ok: true, diagnostics, result: candidate as unknown as ProcessReviewResult }
}

function validateChecklist(
  diagnostics: string[],
  value: unknown,
  evidenceIds: Set<string>
): Record<ProcessCheckStatus, number> {
  const counts: Record<ProcessCheckStatus, number> = {
    pass: 0,
    fail: 0,
    warning: 0,
    not_applicable: 0
  }
  if (!Array.isArray(value) || value.length === 0) {
    diagnostics.push("checklist must be a non-empty array")
    return counts
  }
  for (let index = 0; index < value.length; index += 1) {
    const label = `checklist[${index}]`
    const item = value[index]
    if (!isRecord(item)) {
      diagnostics.push(`${label} must be an object`)
      continue
    }
    expectNonEmptyString(diagnostics, item, "id", label)
    expectNonEmptyString(diagnostics, item, "title", label)
    const status = expectNonEmptyString(diagnostics, item, "status", label)
    if (!status || !PROCESS_CHECK_STATUSES.includes(status as ProcessCheckStatus)) {
      diagnostics.push(`${label}.status is not supported: ${status ?? "<missing>"}`)
    } else {
      counts[status as ProcessCheckStatus] += 1
      if (status === "fail" && !hasNonEmptyString(item.finding) && !hasNonEmptyString(item.findingId)) {
        diagnostics.push(`${label}: failing checklist item must include finding or findingId`)
      }
    }
    validateEvidenceRefs(diagnostics, item.evidenceRefs, evidenceIds, `${label}.evidenceRefs`)
  }
  return counts
}

function validateFindings(diagnostics: string[], value: unknown, evidenceIds: Set<string>): void {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    diagnostics.push("findings must be an array when present")
    return
  }
  for (let index = 0; index < value.length; index += 1) {
    const label = `findings[${index}]`
    const finding = value[index]
    if (!isRecord(finding)) {
      diagnostics.push(`${label} must be an object`)
      continue
    }
    expectNonEmptyString(diagnostics, finding, "id", label)
    expectNonEmptyString(diagnostics, finding, "summary", label)
    const severity = expectNonEmptyString(diagnostics, finding, "severity", label)
    if (severity && !PROCESS_FINDING_SEVERITIES.includes(severity as ProcessFindingSeverity)) {
      diagnostics.push(`${label}.severity is not supported: ${severity}`)
    }
    validateEvidenceRefs(diagnostics, finding.evidenceRefs, evidenceIds, `${label}.evidenceRefs`)
  }
}

function validateEvidenceRefs(diagnostics: string[], value: unknown, evidenceIds: Set<string>, label: string): void {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    diagnostics.push(`${label} must be an array when present`)
    return
  }
  for (let index = 0; index < value.length; index += 1) {
    const ref = value[index]
    if (typeof ref !== "string" || ref.length === 0) {
      diagnostics.push(`${label}[${index}] must be a non-empty string`)
      continue
    }
    if (evidenceIds.size > 0 && !evidenceIds.has(ref)) {
      diagnostics.push(`${label}[${index}] unknown evidence ref: ${ref}`)
    }
  }
}

function validateSummary(
  diagnostics: string[],
  value: unknown,
  checklistCounts: Record<ProcessCheckStatus, number>
): void {
  if (!isRecord(value)) {
    diagnostics.push("summary must be an object")
    return
  }
  let mismatch = false
  for (const status of PROCESS_CHECK_STATUSES) {
    const summaryValue = value[status]
    if (!Number.isInteger(summaryValue) || (summaryValue as number) < 0) {
      diagnostics.push(`summary.${status} must be a non-negative integer`)
      continue
    }
    if (summaryValue !== checklistCounts[status]) {
      mismatch = true
    }
  }
  if (mismatch) {
    diagnostics.push("summary counts must match checklist statuses")
  }
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

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
