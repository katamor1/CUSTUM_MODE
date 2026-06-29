export type ValidationReport = {
  errors: string[]
  warnings: string[]
}

export type ReviewInput = {
  schema_version: 1
  review: {
    id: string
    title: string
    change_type: string
    purpose: string
    base: string
    head: string
    vcs?: "git" | "bazaar" | "bzr"
    vcs_root?: string
    ticket_ids?: string[]
    author_note?: string
    out_of_scope?: string[]
  }
  artifacts: Record<string, unknown>
  review_focus: string[]
  analysis_options?: {
    include_callers?: boolean
    include_callees?: boolean
    include_global_access?: boolean
    include_struct_impact?: boolean
    include_ledgers?: boolean
    max_call_depth?: number
    max_code_context_lines?: number
    language?: string[]
  }
  bob_options?: Record<string, unknown>
}

export type DiffSummary = {
  vcs?: "git" | "bazaar"
  vcsRoot?: string
  base: string
  head: string
  files: Array<{
    path: string
    status: "added" | "modified" | "deleted" | "renamed" | "unknown"
    additions?: number
    deletions?: number
    language?: string
    is_test?: boolean
    is_interface_candidate?: boolean
  }>
  unifiedDiff?: string
  warnings: string[]
}

export type EvidenceRef = {
  evidence_id: string
  type: "requirement" | "basic_design" | "detailed_design" | "test_spec" | "ledger" | "ticket" | "code" | "check_result" | string
  ref: string
  document_id?: string
  source?: string
  version?: string
  location?: string
  text?: string
}

export type DocumentExtractionResult = {
  documents: Array<{
    document_id: string
    path: string
    type: string
    version?: string
    updated_at?: string
    sections: Array<{
      id: string
      title?: string
      evidence_id: string
      location?: string
    }>
  }>
  excerptsMarkdown: string
  evidence: EvidenceRef[]
  warnings: string[]
}

export type CodeAnalysisResult = {
  changedSymbols: Array<{
    id: string
    name: string
    kind: "function" | "type" | "define" | "global" | "unknown"
    file: string
    confidence: "high" | "medium" | "low"
    change_type?: string
    line_after?: string
    evidence_id?: string
  }>
  functions: Array<{
    id: string
    name: string
    file: string
    line_after: string
    evidence_id: string
    callees: string[]
    callers: string[]
  }>
  defines: string[]
  globals: string[]
  callGraph: Array<{ from: string; to: string; confidence: "high" | "medium" | "low"; reason: string }>
  rtForbiddenCandidates: Array<{ symbol: string; file: string; line?: number; reason: string }>
  codeSlices: Array<{ evidence_id: string; file: string; ref: string; functionName?: string; markdown: string; text: string }>
  evidence: EvidenceRef[]
  summaryMarkdown: string
  warnings: string[]
}

export type TraceabilityResult = {
  markdown: string
  rows: Array<Record<string, string>>
  warnings: string[]
}

export type PreprocessResult = {
  status: "ok"
  reviewId: string
  packageDir: string
  changedFiles: number
  documentEvidence: number
  codeEvidence: number
  warnings: string[]
  summary: string
}
