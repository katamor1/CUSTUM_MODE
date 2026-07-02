export type TraceabilityStatus = "proposed" | "accepted" | "rejected" | "deprecated"

export type TraceabilityItemType =
  | "requirement"
  | "basic_design"
  | "detailed_design"
  | "test_spec"
  | "qa_item"
  | "review_finding"

export type TraceabilityLinkType =
  | "satisfies"
  | "elaborates"
  | "verified_by"
  | "clarifies"
  | "reviewed_by"
  | "references"

export type TraceabilityGate = "basic_design" | "detailed_design" | "test"

export interface TraceabilityCatalog {
  schema_version: 1
  documents: TraceabilityDocument[]
  domains: TraceabilityDomain[]
  items: TraceabilityItem[]
  links?: TraceabilityLink[]
  decisions?: TraceabilityDecision[]
}

export interface TraceabilityDocument {
  document_id: string
  display_id?: string
  source_path: string
  extracted_id?: string | null
  id_source: "extracted" | "sidecar-generated"
}

export interface TraceabilityDomain {
  code: string
  label?: string
  description?: string
  aliases?: string[]
  status: TraceabilityStatus
}

export interface TraceabilityItem {
  id?: string | null
  proposed_id?: string
  type: TraceabilityItemType
  source_document_id: string
  domain: string
  sequence: number
  source_path?: string
  text_summary?: string
  status: TraceabilityStatus
  anchor?: {
    heading?: string
    location?: string
    source_hash?: string
    current_hash?: string
  }
  qa?: {
    question?: string
    answer?: string
    status?: string
  }
  review?: {
    severity?: string
    action_plan?: string
    status?: string
  }
}

export interface TraceabilityLink {
  from?: string
  to?: string
  proposed_from?: string
  proposed_to?: string
  link_type: TraceabilityLinkType
  status: TraceabilityStatus
}

export interface TraceabilityDecision {
  subject: string
  gate: TraceabilityGate
  decision: "n/a"
  reason?: string
  status: TraceabilityStatus
}

export interface TraceabilityIssue {
  severity: "error" | "warning"
  code: string
  message: string
  subject?: string
}

export interface TraceabilityValidationReport {
  status: "ok" | "error"
  errors: TraceabilityIssue[]
  warnings: TraceabilityIssue[]
}
