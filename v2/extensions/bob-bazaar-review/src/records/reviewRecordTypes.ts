export const REVIEW_RECORDS_ROOT = ".bob-review-records"
export const REVIEW_RECORD_SCHEMA_VERSION = "bazaar-review-record/v1"
export const TRIAGE_SCHEMA_VERSION = "bazaar-review-triage/v1"

export type TriageDecision = "accepted" | "rejected" | "needs_investigation" | "deferred"

export interface ReviewRecord {
  schema_version: "bazaar-review-record/v1"
  campaign_id: string
  record_id: string
  review_id: string
  target_id?: string
  workflow?: Record<string, unknown>
  vcs?: {
    type?: string
    repository?: string
    revision_mode?: string
    revision?: string
    base_revision?: string
    target_revision?: string
  }
  inputs?: {
    review_packet_path?: string
    checklist_path?: string
  }
  outputs?: {
    review_result_json?: string
    review_result_markdown?: string
    triage_yaml?: string
  }
  quality_gate?: {
    schema_valid?: boolean
    checklist_count_matches?: boolean
    evidence_required_satisfied?: boolean
    findings_have_rule_id?: boolean
  }
  metrics?: {
    baseline_review_minutes?: number
    bob_review_minutes?: number
    human_triage_minutes?: number
    findings_total?: number
    findings_accepted?: number
    findings_rejected?: number
    findings_needs_investigation?: number
    findings_deferred?: number
  }
  notes?: string
}

export interface TriageItem {
  finding_id: string
  rule_id?: string
  decision: TriageDecision
  action?: string
  owner?: string
  reason?: string
}

export interface TriageSummary {
  accepted: number
  rejected: number
  needs_investigation: number
  deferred: number
}

export interface ReviewTriage {
  schema_version: "bazaar-review-triage/v1"
  review_id: string
  triaged_by?: string
  triaged_at?: string
  items: TriageItem[]
  summary: TriageSummary
}

export interface CampaignSummary {
  campaign_id: string
  records_total: number
  completed: number
  failed: number
  blocked: number
  schema_valid_records: number
  schema_invalid_records: number
  singleRevision_count: number
  revisionRange_count: number
  workingTree_count: number
  findings_total: number
  findings_accepted: number
  findings_rejected: number
  findings_needs_investigation: number
  findings_deferred: number
  triage_missing: number
  baseline_review_minutes_total: number
  bob_review_minutes_total: number
  human_triage_minutes_total: number
  estimated_minutes_saved: number
  warnings: string[]
}
