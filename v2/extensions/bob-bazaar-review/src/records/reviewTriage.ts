import {
  TRIAGE_SCHEMA_VERSION,
  type ReviewTriage,
  type TriageDecision,
  type TriageItem,
  type TriageSummary
} from "./reviewRecordTypes"

const TRIAGE_DECISIONS: TriageDecision[] = ["accepted", "rejected", "needs_investigation", "deferred"]

interface TriageDraftOptions {
  triagedBy?: string
  triagedAt?: string
}

export function createTriageDraft(reviewResult: any, options: TriageDraftOptions = {}): ReviewTriage {
  const reviewId = requireString(reviewResult?.review_id, "review_result.review_id")
  const findings = Array.isArray(reviewResult?.findings) ? reviewResult.findings : []
  const checklistResults = Array.isArray(reviewResult?.checklist_results) ? reviewResult.checklist_results : []
  const items: TriageItem[] = []

  const findingRuleIds = new Set<string>()
  for (const finding of findings) {
    const findingId = requireString(finding?.id, "finding.id")
    const ruleId = typeof finding?.rule_id === "string" ? finding.rule_id : undefined
    if (ruleId) findingRuleIds.add(ruleId)
    items.push({
      finding_id: findingId,
      rule_id: ruleId,
      decision: "needs_investigation",
      action: "investigate",
      reason: typeof finding?.title === "string" ? finding.title : "Bob finding requires human review."
    })
  }

  for (const checklist of checklistResults) {
    if (checklist?.status !== "fail") continue
    const ruleId = typeof checklist?.rule_id === "string" ? checklist.rule_id : undefined
    if (!ruleId || findingRuleIds.has(ruleId)) continue
    items.push({
      finding_id: `CHECKLIST-${ruleId}`,
      rule_id: ruleId,
      decision: "needs_investigation",
      action: "investigate",
      reason: typeof checklist?.reason === "string" ? checklist.reason : "Failed checklist rule has no finding."
    })
  }

  return {
    schema_version: TRIAGE_SCHEMA_VERSION,
    review_id: reviewId,
    triaged_by: options.triagedBy,
    triaged_at: options.triagedAt,
    items,
    summary: summarizeTriageItems(items)
  }
}

export function validateTriage(triage: any, reviewResult?: any): string[] {
  const issues: string[] = []
  if (triage?.schema_version !== TRIAGE_SCHEMA_VERSION) {
    issues.push(`schema_version must be ${TRIAGE_SCHEMA_VERSION}`)
  }
  if (typeof triage?.review_id !== "string" || !triage.review_id.trim()) {
    issues.push("review_id is required")
  }
  if (reviewResult?.review_id && triage?.review_id !== reviewResult.review_id) {
    issues.push(`review_id must match review-result ${reviewResult.review_id}`)
  }
  if (!Array.isArray(triage?.items)) {
    issues.push("items must be an array")
    return issues
  }

  const knownFindingIds = knownReviewFindingIds(reviewResult)
  const triagedFindingIds = new Set<string>()
  triage.items.forEach((item: any, index: number) => {
    if (typeof item?.finding_id !== "string" || !item.finding_id.trim()) {
      issues.push(`items[${index}].finding_id is required`)
    } else if (knownFindingIds && !knownFindingIds.has(item.finding_id)) {
      issues.push(`items[${index}].finding_id is not present in review-result: ${item.finding_id}`)
    } else if (typeof item?.finding_id === "string" && item.finding_id.trim()) {
      triagedFindingIds.add(item.finding_id)
    }
    if (!TRIAGE_DECISIONS.includes(item?.decision)) {
      issues.push(`items[${index}].decision has invalid decision: ${item?.decision}`)
    }
    if (item?.decision === "accepted" && (typeof item?.action !== "string" || !item.action.trim())) {
      issues.push(`items[${index}].action is required when decision is accepted`)
    }
  })
  if (knownFindingIds) {
    for (const findingId of knownFindingIds) {
      if (!triagedFindingIds.has(findingId)) {
        issues.push(`missing triage item for review-result finding_id: ${findingId}`)
      }
    }
  }

  const expected = summarizeTriageItems(triage.items.filter((item: any) => TRIAGE_DECISIONS.includes(item?.decision)))
  for (const decision of TRIAGE_DECISIONS) {
    const actual = Number(triage?.summary?.[decision] ?? 0)
    if (actual !== expected[decision]) {
      issues.push(`summary.${decision} must be ${expected[decision]}, got ${actual}`)
    }
  }

  return issues
}

export function summarizeTriageItems(items: TriageItem[]): TriageSummary {
  return {
    accepted: items.filter((item) => item.decision === "accepted").length,
    rejected: items.filter((item) => item.decision === "rejected").length,
    needs_investigation: items.filter((item) => item.decision === "needs_investigation").length,
    deferred: items.filter((item) => item.decision === "deferred").length
  }
}

function knownReviewFindingIds(reviewResult: any): Set<string> | undefined {
  if (!reviewResult) return undefined
  const ids = new Set<string>()
  const findingRuleIds = new Set<string>()
  for (const finding of Array.isArray(reviewResult?.findings) ? reviewResult.findings : []) {
    if (typeof finding?.id === "string") ids.add(finding.id)
    if (typeof finding?.rule_id === "string") findingRuleIds.add(finding.rule_id)
  }
  for (const checklist of Array.isArray(reviewResult?.checklist_results) ? reviewResult.checklist_results : []) {
    if (checklist?.status === "fail" && typeof checklist?.rule_id === "string" && !findingRuleIds.has(checklist.rule_id)) {
      ids.add(`CHECKLIST-${checklist.rule_id}`)
    }
  }
  return ids
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required`)
  }
  return value
}
