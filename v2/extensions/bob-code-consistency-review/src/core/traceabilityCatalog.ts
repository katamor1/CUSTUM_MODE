import type { ReviewFocus, ReviewInputArtifactDraft, ReviewInputDraft } from "./reviewInputBuilder"

export type TraceabilityStatus = "proposed" | "accepted" | "rejected" | "deprecated"
export type TraceabilityItemType = "requirement" | "basic_design" | "detailed_design" | "test_spec"
export type TraceabilityLinkType = "satisfies" | "elaborates" | "verified_by" | "references"
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

export type BuildReviewInputDraftFromTraceabilityResult =
  | { status: "ok"; draft: ReviewInputDraft; warnings: TraceabilityIssue[] }
  | { status: "error"; errors: TraceabilityIssue[]; warnings: TraceabilityIssue[] }

const TYPE_PREFIX: Record<TraceabilityItemType, string> = {
  requirement: "REQ",
  basic_design: "BD",
  detailed_design: "DD",
  test_spec: "TC"
}

const ARTIFACT_KIND: Record<TraceabilityItemType, ReviewInputArtifactDraft["kind"]> = {
  requirement: "requirements",
  basic_design: "basic_design",
  detailed_design: "detailed_design",
  test_spec: "test_spec"
}

export function validateTraceabilityCatalog(catalog: TraceabilityCatalog): TraceabilityValidationReport {
  const errors: TraceabilityIssue[] = []
  const warnings: TraceabilityIssue[] = []
  const documents = new Map<string, TraceabilityDocument>()
  const domains = new Map<string, TraceabilityDomain>()
  const acceptedItems = new Map<string, TraceabilityItem>()
  const itemIds = new Set<string>()

  if (catalog.schema_version !== 1) {
    errors.push(issue("error", "invalid_schema_version", "traceability catalog schema_version must be 1"))
  }

  for (const document of catalog.documents ?? []) {
    if (documents.has(document.document_id)) {
      errors.push(issue("error", "duplicate_document", `duplicate document_id '${document.document_id}'`, document.document_id))
    }
    documents.set(document.document_id, document)
    if (document.id_source === "sidecar-generated") {
      warnings.push(issue("warning", "generated_document_id", `document '${document.document_id}' uses a sidecar-generated id`, document.document_id))
    }
  }

  for (const domain of catalog.domains ?? []) {
    if (domains.has(domain.code)) {
      errors.push(issue("error", "duplicate_domain", `duplicate domain code '${domain.code}'`, domain.code))
    }
    domains.set(domain.code, domain)
    if (domain.status === "proposed") {
      warnings.push(issue("warning", "proposed_domain", `domain '${domain.code}' is still proposed`, domain.code))
    }
  }

  for (const item of catalog.items ?? []) {
    const document = documents.get(item.source_document_id)
    const domain = domains.get(item.domain)
    const expectedId = formatTraceabilityItemId(item)
    const currentId = item.id ?? undefined

    if (!document) {
      errors.push(issue("error", "unknown_source_document", `item '${item.proposed_id ?? currentId ?? expectedId}' references unknown source document '${item.source_document_id}'`, item.proposed_id ?? currentId))
    }
    if (!domain) {
      errors.push(issue("error", "unknown_domain", `item '${item.proposed_id ?? currentId ?? expectedId}' references unknown domain '${item.domain}'`, item.proposed_id ?? currentId))
    }
    if (item.anchor?.source_hash && item.anchor.current_hash && item.anchor.source_hash !== item.anchor.current_hash) {
      warnings.push(issue("warning", "stale_anchor", `item '${item.proposed_id ?? currentId ?? expectedId}' source anchor hash changed`, item.proposed_id ?? currentId))
    }

    if (item.status === "accepted") {
      if (!currentId) {
        errors.push(issue("error", "missing_accepted_id", `accepted ${item.type} item must have id '${expectedId}'`, item.proposed_id))
      } else {
        if (currentId !== expectedId) {
          errors.push(issue("error", "invalid_id", `item id '${currentId}' must be '${expectedId}'`, currentId))
        }
        if (itemIds.has(currentId)) {
          errors.push(issue("error", "duplicate_id", `duplicate traceability id '${currentId}'`, currentId))
        }
        itemIds.add(currentId)
        acceptedItems.set(currentId, item)
      }
      if (domain && domain.status !== "accepted") {
        errors.push(issue("error", "unapproved_domain", `accepted item '${currentId ?? expectedId}' uses unapproved domain '${item.domain}'`, currentId ?? expectedId))
      }
    } else if (item.status === "proposed") {
      warnings.push(issue("warning", "proposed_item", `item '${item.proposed_id ?? expectedId}' is still proposed`, item.proposed_id ?? expectedId))
    }
  }

  for (const link of catalog.links ?? []) {
    if (link.status === "accepted") validateAcceptedLink(link, acceptedItems, errors)
    else if (link.status === "proposed") {
      warnings.push(issue("warning", "pending_trace_review", `link '${link.proposed_from ?? link.from ?? "(unknown)"}' -> '${link.proposed_to ?? link.to ?? "(unknown)"}' is still proposed`, link.proposed_from ?? link.from))
    }
  }

  for (const decision of catalog.decisions ?? []) {
    if (decision.status !== "accepted") {
      if (decision.status === "proposed") warnings.push(issue("warning", "proposed_decision", `decision for '${decision.subject}' is still proposed`, decision.subject))
      continue
    }
    if (!acceptedItems.has(decision.subject)) {
      errors.push(issue("error", "decision_subject_not_accepted", `accepted decision subject '${decision.subject}' is not an accepted item`, decision.subject))
    }
    if (!decision.reason?.trim()) {
      errors.push(issue("error", "missing_na_reason", `accepted n/a decision for '${decision.subject}' must include a reason`, decision.subject))
    }
  }

  addGateIssues(catalog, acceptedItems, errors)
  return { status: errors.length === 0 ? "ok" : "error", errors, warnings }
}

export function buildReviewInputDraftFromTraceability(
  catalog: TraceabilityCatalog,
  options: {
    review: ReviewInputDraft["review"]
    review_focus?: ReviewFocus[]
    focus_preset?: ReviewInputDraft["focus_preset"]
    analysis_options?: ReviewInputDraft["analysis_options"]
    bob_options?: ReviewInputDraft["bob_options"]
  }
): BuildReviewInputDraftFromTraceabilityResult {
  const report = validateTraceabilityCatalog(catalog)
  if (report.errors.length > 0) return { status: "error", errors: report.errors, warnings: report.warnings }

  const documents = new Map(catalog.documents.map((document) => [document.document_id, document]))
  const artifactMap = new Map<string, ReviewInputArtifactDraft>()
  for (const item of catalog.items.filter((candidate) => candidate.status === "accepted" && candidate.id)) {
    const document = documents.get(item.source_document_id)
    const artifactPath = item.source_path ?? document?.source_path
    if (!artifactPath || !item.id) continue
    const kind = ARTIFACT_KIND[item.type]
    const key = `${kind}\n${artifactPath}`
    const artifact = artifactMap.get(key) ?? { kind, path: artifactPath }
    if (item.type === "test_spec") uniquePush(artifact.cases ??= [], item.id)
    else uniquePush(artifact.sections ??= [], item.id)
    artifactMap.set(key, artifact)
  }

  return {
    status: "ok",
    draft: {
      review: options.review,
      artifact_candidates: Array.from(artifactMap.values()),
      focus_preset: options.focus_preset,
      review_focus: options.review_focus,
      analysis_options: options.analysis_options,
      bob_options: options.bob_options
    },
    warnings: report.warnings
  }
}

export function renderTraceabilityGateReport(report: TraceabilityValidationReport): string {
  return [
    "# Traceability Gate Report",
    "",
    "## Summary",
    "",
    `- status: ${report.status}`,
    `- errors: ${report.errors.length}`,
    `- warnings: ${report.warnings.length}`,
    "",
    "## Errors",
    "",
    ...renderIssues(report.errors, "- none"),
    "",
    "## Warnings",
    "",
    ...renderIssues(report.warnings, "- none"),
    ""
  ].join("\n")
}

export function formatTraceabilityItemId(item: Pick<TraceabilityItem, "type" | "source_document_id" | "domain" | "sequence">): string {
  return `${TYPE_PREFIX[item.type]}-${item.source_document_id}-${item.domain}-${String(item.sequence).padStart(4, "0")}`
}

function validateAcceptedLink(link: TraceabilityLink, acceptedItems: Map<string, TraceabilityItem>, errors: TraceabilityIssue[]): void {
  if (!link.from || !link.to) {
    errors.push(issue("error", "accepted_link_missing_endpoint", "accepted links must use from/to endpoints", link.from ?? link.to))
    return
  }
  if (!acceptedItems.has(link.from)) {
    errors.push(issue("error", "link_from_not_accepted", `accepted link from '${link.from}' does not reference an accepted item`, link.from))
  }
  if (!acceptedItems.has(link.to)) {
    errors.push(issue("error", "link_to_not_accepted", `accepted link to '${link.to}' does not reference an accepted item`, link.to))
  }
}

function addGateIssues(catalog: TraceabilityCatalog, acceptedItems: Map<string, TraceabilityItem>, errors: TraceabilityIssue[]): void {
  const links = (catalog.links ?? []).filter((link) => link.status === "accepted" && link.from && link.to) as Array<TraceabilityLink & { from: string; to: string }>
  const decisions = (catalog.decisions ?? []).filter((decision) => decision.status === "accepted" && decision.decision === "n/a")

  for (const [id, item] of acceptedItems) {
    if (item.type === "requirement") {
      if (!hasAcceptedLinkToType(id, "satisfies", "basic_design", links, acceptedItems) && !hasAcceptedDecision(id, "basic_design", decisions)) {
        errors.push(issue("error", "missing_basic_design", `requirement '${id}' has no accepted basic-design link or n/a decision`, id))
      }
      if (!hasAcceptedLinkToType(id, "verified_by", "test_spec", links, acceptedItems) && !hasAcceptedDecision(id, "test", decisions)) {
        errors.push(issue("error", "missing_test", `requirement '${id}' has no accepted test link or n/a decision`, id))
      }
    }
    if (item.type === "basic_design" && !hasAcceptedLinkToType(id, "elaborates", "detailed_design", links, acceptedItems) && !hasAcceptedDecision(id, "detailed_design", decisions)) {
      errors.push(issue("error", "missing_detailed_design", `basic design '${id}' has no accepted detailed-design link or n/a decision`, id))
    }
    if (item.type === "detailed_design" && !hasAcceptedLinkToType(id, "verified_by", "test_spec", links, acceptedItems) && !hasAcceptedDecision(id, "test", decisions)) {
      errors.push(issue("error", "missing_test", `detailed design '${id}' has no accepted test link or n/a decision`, id))
    }
  }
}

function hasAcceptedLinkToType(
  from: string,
  linkType: TraceabilityLinkType,
  targetType: TraceabilityItemType,
  links: Array<TraceabilityLink & { from: string; to: string }>,
  items: Map<string, TraceabilityItem>
): boolean {
  return links.some((link) => link.from === from && link.link_type === linkType && items.get(link.to)?.type === targetType)
}

function hasAcceptedDecision(subject: string, gate: TraceabilityGate, decisions: TraceabilityDecision[]): boolean {
  return decisions.some((decision) => decision.subject === subject && decision.gate === gate && Boolean(decision.reason?.trim()))
}

function renderIssues(issues: TraceabilityIssue[], fallback: string): string[] {
  if (issues.length === 0) return [fallback]
  return issues.map((item) => `- ${item.code}: ${item.message}${item.subject ? ` (${item.subject})` : ""}`)
}

function issue(severity: "error" | "warning", code: string, message: string, subject?: string): TraceabilityIssue {
  return { severity, code, message, subject }
}

function uniquePush(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value)
}
