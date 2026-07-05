import { validateReviewResultJson } from "../projectRules/validator"
import type { ReviewRecord } from "./reviewRecordTypes"

export function buildReviewRecordQualityGate(reviewResult: unknown, schemaValidOverride?: boolean): NonNullable<ReviewRecord["quality_gate"]> {
  const validation = validateReviewResultJson(reviewResult)
  return {
    schema_valid: schemaValidOverride ?? validation.valid,
    checklist_count_matches: !validation.issues.some((issue) => /summary count .* does not match actual count/.test(issue.message)),
    evidence_required_satisfied: !validation.issues.some((issue) => /requires at least one evidence item/.test(issue.message)),
    findings_have_rule_id: reviewFindingsHaveRuleIds(reviewResult)
  }
}

export function reviewFindingsHaveRuleIds(reviewResult: unknown): boolean {
  const findings = isRecord(reviewResult) && Array.isArray(reviewResult.findings) ? reviewResult.findings : []
  return findings.every((finding) => isRecord(finding) && typeof finding.rule_id === "string" && finding.rule_id.trim().length > 0)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
