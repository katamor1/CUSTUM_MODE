import type { ReviewResult, ValidationIssue } from "./types"

export interface CaptureReviewResultResult {
  status: "ok" | "error"
  source: string
  reviewId?: string
  jsonPath?: string
  markdownPath?: string
  jsonText?: string
  valid: boolean
  issueCount: number
  issues?: ValidationIssue[]
  summary?: ReviewResult["summary"]
}

export interface SavedReviewResultArtifacts {
  jsonPath: string
  markdownPath: string
  backupPaths: string[]
}

export interface CandidateText {
  source: string
  text: string
}

export interface CaptureReviewResultOptions {
  expectedChecklistItems?: number
  expectedRuleIds?: string[]
  reviewResultSchema?: unknown
  checklistVersion?: string
  project?: string
  workspaceRoot?: string
  workflowState?: Record<string, string>
}
