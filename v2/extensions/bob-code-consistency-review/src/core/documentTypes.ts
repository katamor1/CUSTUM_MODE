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
