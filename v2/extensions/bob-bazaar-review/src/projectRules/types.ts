export type ReviewStatus = "pass" | "fail" | "unknown" | "not_applicable" | "blocked"
export type ReviewSeverity = "error" | "warning" | "info"
export type ReviewConfidence = "high" | "medium" | "low"

export interface ProjectRule {
  id: string
  category: string
  title: string
  description: string
  severity_on_fail: ReviewSeverity
  applies_when?: string[]
  evidence_required?: boolean
  review_hint?: string
}

export interface ProjectChecklist {
  version: string
  project: string
  rules: ProjectRule[]
}

export interface ReviewEvidence {
  file?: string
  start_line?: number
  end_line?: number
  summary: string
}

export interface ChecklistResult {
  rule_id: string
  title: string
  status: ReviewStatus
  severity: ReviewSeverity
  confidence: ReviewConfidence
  evidence: ReviewEvidence[]
  reason: string
  suggested_action?: string
}

export interface ReviewFinding {
  id: string
  rule_id: string
  severity: ReviewSeverity
  file?: string
  start_line?: number
  end_line?: number
  title: string
  description: string
  suggested_fix?: string
}

export interface ReviewResult {
  review_id: string
  vcs: {
    type: "bazaar" | string
    repository?: string
    revision_mode?: string
    revision?: string
    base_revision?: string
    target_revision?: string
  }
  checklist_results: ChecklistResult[]
  findings: ReviewFinding[]
  summary: Record<ReviewStatus, number>
}

export interface ValidationIssue {
  path: string
  message: string
}

export interface ValidationResult {
  valid: boolean
  issues: ValidationIssue[]
}
