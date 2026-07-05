/**
 * 工程 workflow の永続 artifact に書き込む schemaVersion 値。
 *
 * process catalog、input、record、review result は別 workflow や後続集計から参照されるため、
 * 文字列値は実装詳細ではなく互換性契約として扱う。
 */
export const PROCESS_CATALOG_SCHEMA_VERSION = "bob-process-catalog/v1" as const
export const PROCESS_INPUT_SCHEMA_VERSION = "bob-process-input/v1" as const
export const PROCESS_RECORD_SCHEMA_VERSION = "bob-process-record/v1" as const
export const PROCESS_REVIEW_RESULT_SCHEMA_VERSION = "process-review-result/v1" as const
export const PROCESS_EVIDENCE_INDEX_SCHEMA_VERSION = "bob-process-evidence-index/v1" as const
export const PROCESS_CAMPAIGN_SUMMARY_SCHEMA_VERSION = "bob-process-campaign-summary/v1" as const

export const PROCESS_WORKFLOW_NAMES = [
  "process-code-doc-investigation",
  "process-qa-intake-analysis",
  "process-external-spec-design",
  "process-external-spec-review",
  "process-internal-spec-design",
  "process-internal-spec-review",
  "process-coding-plan",
  "process-code-precheck",
  "process-unit-test-design",
  "process-unit-test-execution-review",
  "process-functional-test-design",
  "process-functional-test-execution-review",
  "process-integration-test-design",
  "process-common-review"
] as const

export const PROCESS_PHASES = [
  "investigation",
  "qa",
  "external_spec",
  "internal_spec",
  "coding",
  "unit_test",
  "functional_test",
  "integration_test",
  "common"
] as const

export const PROCESS_TARGET_LANGUAGES = [
  "c_cpp",
  "csharp",
  "java",
  "javascript_typescript",
  "python",
  "sql",
  "docs",
  "other"
] as const

export const PROCESS_VCS_TYPES = [
  "git",
  "bazaar",
  "bzr",
  "none"
] as const

export const PROCESS_REVIEW_STATUSES = [
  "approved",
  "needs_rework",
  "blocked",
  "informational"
] as const

export const PROCESS_CHECK_STATUSES = [
  "pass",
  "fail",
  "warning",
  "not_applicable"
] as const

export const PROCESS_RECORD_STATUSES = [
  "draft",
  "completed",
  "needs_rework",
  "blocked",
  "failed"
] as const

export const PROCESS_HUMAN_GATE_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "not_required"
] as const

export const PROCESS_FINDING_SEVERITIES = [
  "critical",
  "major",
  "minor",
  "info"
] as const

export type ProcessWorkflowName = typeof PROCESS_WORKFLOW_NAMES[number]
export type ProcessPhase = typeof PROCESS_PHASES[number]
export type ProcessTargetLanguage = typeof PROCESS_TARGET_LANGUAGES[number]
export type ProcessVcsType = typeof PROCESS_VCS_TYPES[number]
export type ProcessReviewStatus = typeof PROCESS_REVIEW_STATUSES[number]
export type ProcessCheckStatus = typeof PROCESS_CHECK_STATUSES[number]
export type ProcessRecordStatus = typeof PROCESS_RECORD_STATUSES[number]
export type ProcessHumanGateStatus = typeof PROCESS_HUMAN_GATE_STATUSES[number]
export type ProcessFindingSeverity = typeof PROCESS_FINDING_SEVERITIES[number]

export interface ProcessCatalogWorkflow {
  name: ProcessWorkflowName | string
  title: string
  phase: ProcessPhase | string
  workflowPath: string
  inputSchema: string
  recordSchema: string
  reviewResultSchema: string
  requiredInputs: string[]
  artifactOutputs: string[]
  humanGates: string[]
}

export interface ProcessCatalog {
  schemaVersion: typeof PROCESS_CATALOG_SCHEMA_VERSION
  catalogId: string
  displayName?: string
  version?: number | string
  workflowRoot: string
  runRoot: string
  recordRoot: string
  workflows: ProcessCatalogWorkflow[]
}

export interface ProcessInputFile {
  path: string
  title?: string
  encoding?: string
  required?: boolean
}

export interface ProcessInputVcs {
  type: ProcessVcsType | string
  root: string
  revision?: string
  branch?: string
  noAliases?: boolean
}

export interface ProcessInputOptions {
  destructiveVcsOperations?: boolean
  requireHumanGate?: boolean
  textEncoding?: string
}

/**
 * 工程 workflow の開始時に host が検証する入力 contract。
 *
 * VCS root、workspace path、破壊的操作の opt-in は信頼境界なので、workflow 本文や
 * AI 生成テキストではなく、この構造を読んだ command 側で再検証する。
 */
export interface ProcessInput {
  schemaVersion: typeof PROCESS_INPUT_SCHEMA_VERSION
  campaignId: string
  runId?: string
  workflowName: ProcessWorkflowName | string
  phase: ProcessPhase | string
  targetLanguage: ProcessTargetLanguage | string
  targetSummary: string
  vcs: ProcessInputVcs
  inputs: Record<string, ProcessInputFile[]>
  options?: ProcessInputOptions
}

export interface ProcessEvidenceIndexEntry {
  id: string
  path: string
  kind?: string
  title?: string
  sizeBytes?: number
  sha256?: string
  encoding?: string
  truncated?: boolean
}

export interface ProcessEvidenceIndex {
  schemaVersion?: typeof PROCESS_EVIDENCE_INDEX_SCHEMA_VERSION
  entries: ProcessEvidenceIndexEntry[]
}

export interface ProcessChecklistItem {
  id: string
  title: string
  status: ProcessCheckStatus | string
  evidenceRefs?: string[]
  finding?: string
  findingId?: string
}

export interface ProcessFinding {
  id: string
  severity: ProcessFindingSeverity | string
  summary: string
  evidenceRefs?: string[]
  owner?: string
  nextAction?: string
}

export interface ProcessReviewResultSummary {
  pass: number
  fail: number
  warning: number
  not_applicable: number
}

export interface ProcessReviewResult {
  schemaVersion: typeof PROCESS_REVIEW_RESULT_SCHEMA_VERSION
  campaignId: string
  runId: string
  workflowName: ProcessWorkflowName | string
  status: ProcessReviewStatus | string
  summary: ProcessReviewResultSummary
  checklist: ProcessChecklistItem[]
  findings?: ProcessFinding[]
  handoff?: Record<string, unknown>
}

export interface ProcessHumanGate {
  required: boolean
  status: ProcessHumanGateStatus | string
  reviewer?: string
  reviewedAt?: string
}

export interface ProcessRecordMetrics {
  evidenceCount?: number
  findingCount?: number
  passedChecks?: number
  failedChecks?: number
}

/**
 * 工程実行後に保存する監査用 record。
 *
 * inputPath、artifactRoot、reviewResultPath は生成物の追跡点であり、humanGate は
 * AI や自動検査ではなく人間確認が必要だったかを後段集計へ伝える契約である。
 */
export interface ProcessRecord {
  schemaVersion: typeof PROCESS_RECORD_SCHEMA_VERSION
  campaignId: string
  runId: string
  workflowName: ProcessWorkflowName | string
  phase: ProcessPhase | string
  status: ProcessRecordStatus | string
  inputPath: string
  artifactRoot: string
  evidenceIndexPath?: string
  reviewResultPath?: string
  humanGate: ProcessHumanGate
  metrics?: ProcessRecordMetrics
  phase2Handoff?: Record<string, unknown>
}

export interface ProcessCampaignSummary {
  schemaVersion: typeof PROCESS_CAMPAIGN_SUMMARY_SCHEMA_VERSION
  campaignId: string
  generatedAt: string
  recordCount: number
  invalidRecordCount: number
  statusCounts: Record<string, number>
  workflowCounts: Record<string, number>
  humanGateCounts: Record<string, number>
  totalFindingCount: number
  totalFailedChecks: number
}

export type ProcessValidationResult<T> =
  | { ok: true; diagnostics: string[]; value: T }
  | { ok: false; diagnostics: string[]; value?: T }
