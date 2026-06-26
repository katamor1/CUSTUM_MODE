import { ChecklistResult, ReviewFinding, ReviewResult, ReviewStatus, ValidationIssue, ValidationResult } from "./types"

const STATUSES: ReviewStatus[] = ["pass", "fail", "unknown", "not_applicable", "blocked"]
const SEVERITIES = ["error", "warning", "info"]
const CONFIDENCES = ["high", "medium", "low"]

export function validateReviewResultJson(input: string | unknown): ValidationResult {
  const issues: ValidationIssue[] = []
  let value: unknown = input

  if (typeof input === "string") {
    try {
      value = JSON.parse(input)
    } catch (error: any) {
      return { valid: false, issues: [{ path: "$", message: `Invalid JSON: ${error?.message ?? String(error)}` }] }
    }
  }

  if (!isRecord(value)) {
    return { valid: false, issues: [{ path: "$", message: "Review result must be an object" }] }
  }

  requireString(value, "review_id", "$.review_id", issues)
  if (!isRecord(value.vcs)) {
    issues.push({ path: "$.vcs", message: "vcs must be an object" })
  } else {
    requireString(value.vcs, "type", "$.vcs.type", issues)
  }

  if (!Array.isArray(value.checklist_results)) {
    issues.push({ path: "$.checklist_results", message: "checklist_results must be an array" })
  } else {
    value.checklist_results.forEach((item: unknown, index: number) => validateChecklistResult(item, `$.checklist_results[${index}]`, issues))
  }

  if (!Array.isArray(value.findings)) {
    issues.push({ path: "$.findings", message: "findings must be an array" })
  } else {
    value.findings.forEach((item: unknown, index: number) => validateFinding(item, `$.findings[${index}]`, issues))
  }

  if (!isRecord(value.summary)) {
    issues.push({ path: "$.summary", message: "summary must be an object" })
  } else {
    for (const status of STATUSES) {
      const summaryValue = value.summary[status]
      if (typeof summaryValue !== "number" || !Number.isInteger(summaryValue) || summaryValue < 0) {
        issues.push({ path: `$.summary.${status}`, message: "summary count must be a non-negative integer" })
      }
    }
  }

  validateSemanticRules(value as unknown as ReviewResult, issues)

  return { valid: issues.length === 0, issues }
}

function validateChecklistResult(item: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(item)) {
    issues.push({ path, message: "checklist result must be an object" })
    return
  }

  requireString(item, "rule_id", `${path}.rule_id`, issues)
  requireString(item, "title", `${path}.title`, issues)
  requireEnum(item.status, STATUSES, `${path}.status`, issues)
  requireEnum(item.severity, SEVERITIES, `${path}.severity`, issues)
  requireEnum(item.confidence, CONFIDENCES, `${path}.confidence`, issues)
  requireString(item, "reason", `${path}.reason`, issues)

  if (!Array.isArray(item.evidence)) {
    issues.push({ path: `${path}.evidence`, message: "evidence must be an array" })
  } else {
    item.evidence.forEach((evidence: unknown, index: number) => validateEvidence(evidence, `${path}.evidence[${index}]`, issues))
  }
}

function validateEvidence(item: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(item)) {
    issues.push({ path, message: "evidence must be an object" })
    return
  }
  requireString(item, "summary", `${path}.summary`, issues)
  optionalInteger(item, "start_line", `${path}.start_line`, issues)
  optionalInteger(item, "end_line", `${path}.end_line`, issues)
}

function validateFinding(item: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(item)) {
    issues.push({ path, message: "finding must be an object" })
    return
  }
  requireString(item, "id", `${path}.id`, issues)
  requireString(item, "rule_id", `${path}.rule_id`, issues)
  requireEnum(item.severity, SEVERITIES, `${path}.severity`, issues)
  requireString(item, "title", `${path}.title`, issues)
  requireString(item, "description", `${path}.description`, issues)
  optionalInteger(item, "start_line", `${path}.start_line`, issues)
  optionalInteger(item, "end_line", `${path}.end_line`, issues)
}

function validateSemanticRules(result: ReviewResult, issues: ValidationIssue[]): void {
  if (!Array.isArray(result?.checklist_results) || !Array.isArray(result?.findings)) return

  const failedRuleIds = new Set<string>()
  for (const [index, item] of result.checklist_results.entries()) {
    if (item.status === "pass" && (!Array.isArray(item.evidence) || item.evidence.length === 0)) {
      issues.push({ path: `$.checklist_results[${index}]`, message: "pass requires at least one evidence item" })
    }
    if (item.status === "fail") {
      failedRuleIds.add(item.rule_id)
      if (!Array.isArray(item.evidence) || item.evidence.length === 0) {
        issues.push({ path: `$.checklist_results[${index}]`, message: "fail requires at least one evidence item" })
      }
    }
  }

  for (const ruleId of failedRuleIds) {
    if (!result.findings.some((finding) => finding.rule_id === ruleId)) {
      issues.push({ path: "$.findings", message: `failed rule ${ruleId} must have at least one finding` })
    }
  }

  if (result.summary && Array.isArray(result.checklist_results)) {
    for (const status of STATUSES) {
      const actual = result.checklist_results.filter((item) => item.status === status).length
      const summaryValue = (result.summary as any)[status]
      if (Number.isInteger(summaryValue) && summaryValue !== actual) {
        issues.push({ path: `$.summary.${status}`, message: `summary count ${summaryValue} does not match actual count ${actual}` })
      }
    }
  }
}

function requireString(obj: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): void {
  if (typeof obj[key] !== "string" || !(obj[key] as string).trim()) {
    issues.push({ path, message: "must be a non-empty string" })
  }
}

function optionalInteger(obj: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): void {
  if (obj[key] !== undefined && (!Number.isInteger(obj[key]) || (obj[key] as number) < 1)) {
    issues.push({ path, message: "must be a positive integer when present" })
  }
}

function requireEnum(value: unknown, allowed: readonly string[], path: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    issues.push({ path, message: `must be one of: ${allowed.join(", ")}` })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
