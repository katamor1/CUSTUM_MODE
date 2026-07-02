import { formatTraceabilityItemId } from "./traceabilityIds"
import type {
  TraceabilityCatalog,
  TraceabilityDecision,
  TraceabilityDocument,
  TraceabilityDomain,
  TraceabilityGate,
  TraceabilityIssue,
  TraceabilityItem,
  TraceabilityItemType,
  TraceabilityLink,
  TraceabilityLinkType,
  TraceabilityValidationReport
} from "./traceabilityTypes"

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
      warnings.push(
        issue(
          "warning",
          "generated_document_id",
          `document '${document.document_id}' uses a sidecar-generated id`,
          document.document_id
        )
      )
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
    const itemLabel = item.proposed_id ?? currentId ?? expectedId
    const itemIssueId = item.proposed_id ?? currentId

    if (!document) {
      errors.push(
        issue(
          "error",
          "unknown_source_document",
          `item '${itemLabel}' references unknown source document '${item.source_document_id}'`,
          itemIssueId
        )
      )
    }
    if (!domain) {
      errors.push(
        issue(
          "error",
          "unknown_domain",
          `item '${itemLabel}' references unknown domain '${item.domain}'`,
          itemIssueId
        )
      )
    }
    if (
      item.anchor?.source_hash &&
      item.anchor.current_hash &&
      item.anchor.source_hash !== item.anchor.current_hash
    ) {
      warnings.push(
        issue(
          "warning",
          "stale_anchor",
          `item '${itemLabel}' source anchor hash changed`,
          itemIssueId
        )
      )
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
        errors.push(
          issue(
            "error",
            "unapproved_domain",
            `accepted item '${currentId ?? expectedId}' uses unapproved domain '${item.domain}'`,
            currentId ?? expectedId
          )
        )
      }
    } else if (item.status === "proposed") {
      warnings.push(issue("warning", "proposed_item", `item '${item.proposed_id ?? expectedId}' is still proposed`, item.proposed_id ?? expectedId))
    }
  }

  for (const link of catalog.links ?? []) {
    if (link.status === "accepted") validateAcceptedLink(link, acceptedItems, errors)
    else if (link.status === "proposed") {
      const from = link.proposed_from ?? link.from ?? "(unknown)"
      const to = link.proposed_to ?? link.to ?? "(unknown)"
      warnings.push(
        issue(
          "warning",
          "pending_trace_review",
          `link '${from}' -> '${to}' is still proposed`,
          link.proposed_from ?? link.from
        )
      )
    }
  }

  for (const decision of catalog.decisions ?? []) {
    if (decision.status !== "accepted") {
      if (decision.status === "proposed") {
        warnings.push(
          issue(
            "warning",
            "proposed_decision",
            `decision for '${decision.subject}' is still proposed`,
            decision.subject
          )
        )
      }
      continue
    }
    if (!acceptedItems.has(decision.subject)) {
      errors.push(
        issue(
          "error",
          "decision_subject_not_accepted",
          `accepted decision subject '${decision.subject}' is not an accepted item`,
          decision.subject
        )
      )
    }
    if (!decision.reason?.trim()) {
      errors.push(
        issue(
          "error",
          "missing_na_reason",
          `accepted n/a decision for '${decision.subject}' must include a reason`,
          decision.subject
        )
      )
    }
  }

  addGateIssues(catalog, acceptedItems, errors, warnings)
  return { status: errors.length === 0 ? "ok" : "error", errors, warnings }
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

function validateAcceptedLink(
  link: TraceabilityLink,
  acceptedItems: Map<string, TraceabilityItem>,
  errors: TraceabilityIssue[]
): void {
  if (!link.from || !link.to) {
    errors.push(issue("error", "accepted_link_missing_endpoint", "accepted links must use from/to endpoints", link.from ?? link.to))
    return
  }
  const fromItem = acceptedItems.get(link.from)
  const toItem = acceptedItems.get(link.to)
  if (!fromItem) {
    errors.push(issue("error", "link_from_not_accepted", `accepted link from '${link.from}' does not reference an accepted item`, link.from))
  }
  if (!toItem) {
    errors.push(issue("error", "link_to_not_accepted", `accepted link to '${link.to}' does not reference an accepted item`, link.to))
  }
  if (
    fromItem &&
    toItem &&
    !isAllowedLinkDirection(link.link_type, fromItem.type, toItem.type)
  ) {
    errors.push(
      issue(
        "error",
        "invalid_link_direction",
        `accepted ${link.link_type} link '${link.from}' -> '${link.to}' has invalid item types`,
        link.from
      )
    )
  }
}

function addGateIssues(
  catalog: TraceabilityCatalog,
  acceptedItems: Map<string, TraceabilityItem>,
  errors: TraceabilityIssue[],
  warnings: TraceabilityIssue[]
): void {
  const links = (catalog.links ?? []).filter(
    (link) => link.status === "accepted" && link.from && link.to
  ) as Array<TraceabilityLink & { from: string; to: string }>
  const decisions = (catalog.decisions ?? []).filter(
    (decision) => decision.status === "accepted" && decision.decision === "n/a"
  )

  for (const [id, item] of acceptedItems) {
    if (item.type === "requirement") {
      if (
        !hasAcceptedLinkToType(id, "satisfies", "basic_design", links, acceptedItems) &&
        !hasAcceptedDecision(id, "basic_design", decisions)
      ) {
        errors.push(issue("error", "missing_basic_design", `requirement '${id}' has no accepted basic-design link or n/a decision`, id))
      }
      if (
        !hasAcceptedLinkToType(id, "verified_by", "test_spec", links, acceptedItems) &&
        !hasAcceptedDecision(id, "test", decisions)
      ) {
        errors.push(issue("error", "missing_test", `requirement '${id}' has no accepted test link or n/a decision`, id))
      }
    }
    if (
      item.type === "basic_design" &&
      !hasAcceptedLinkToType(id, "elaborates", "detailed_design", links, acceptedItems) &&
      !hasAcceptedDecision(id, "detailed_design", decisions)
    ) {
      errors.push(issue("error", "missing_detailed_design", `basic design '${id}' has no accepted detailed-design link or n/a decision`, id))
    }
    if (
      item.type === "detailed_design" &&
      !hasAcceptedLinkToType(id, "verified_by", "test_spec", links, acceptedItems) &&
      !hasAcceptedDecision(id, "test", decisions)
    ) {
      errors.push(issue("error", "missing_test", `detailed design '${id}' has no accepted test link or n/a decision`, id))
    }
    if (item.type === "qa_item") {
      if (
        !hasAcceptedLinkFromType(
          id,
          "clarifies",
          ["requirement", "basic_design", "detailed_design", "test_spec", "review_finding"],
          links,
          acceptedItems
        )
      ) {
        errors.push(issue("error", "missing_qa_clarifies", `QA item '${id}' has no accepted clarifies link`, id))
      }
      if (item.qa?.status === "answered") {
        warnings.push(issue("warning", "qa_answered_not_closed", `QA item '${id}' is answered but not closed`, id))
      }
    }
    if (item.type === "review_finding") {
      if (
        !hasAcceptedLinkToItemType(
          id,
          "reviewed_by",
          ["requirement", "basic_design", "detailed_design", "test_spec", "qa_item"],
          links,
          acceptedItems
        )
      ) {
        errors.push(issue("error", "missing_reviewed_by", `review finding '${id}' has no accepted reviewed_by link`, id))
      }
      if (!isResolvedReviewFinding(item)) {
        errors.push(issue("error", "unresolved_review_finding", `review finding '${id}' is not closed`, id))
      }
    }
  }
}

function isAllowedLinkDirection(
  linkType: TraceabilityLinkType,
  fromType: TraceabilityItemType,
  toType: TraceabilityItemType
): boolean {
  if (linkType === "references") return true
  if (linkType === "satisfies") return fromType === "requirement" && toType === "basic_design"
  if (linkType === "elaborates") return fromType === "basic_design" && toType === "detailed_design"
  if (linkType === "verified_by") {
    return (fromType === "requirement" || fromType === "detailed_design") && toType === "test_spec"
  }
  if (linkType === "clarifies") {
    return fromType === "qa_item" &&
      ["requirement", "basic_design", "detailed_design", "test_spec", "review_finding"].includes(toType)
  }
  if (linkType === "reviewed_by") {
    return ["requirement", "basic_design", "detailed_design", "test_spec", "qa_item"].includes(fromType) &&
      toType === "review_finding"
  }
  return false
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

function hasAcceptedLinkFromType(
  from: string,
  linkType: TraceabilityLinkType,
  targetTypes: TraceabilityItemType[],
  links: Array<TraceabilityLink & { from: string; to: string }>,
  items: Map<string, TraceabilityItem>
): boolean {
  return links.some((link) => link.from === from && link.link_type === linkType && targetTypes.includes(items.get(link.to)?.type as TraceabilityItemType))
}

function hasAcceptedLinkToItemType(
  to: string,
  linkType: TraceabilityLinkType,
  sourceTypes: TraceabilityItemType[],
  links: Array<TraceabilityLink & { from: string; to: string }>,
  items: Map<string, TraceabilityItem>
): boolean {
  return links.some((link) => link.to === to && link.link_type === linkType && sourceTypes.includes(items.get(link.from)?.type as TraceabilityItemType))
}

function isResolvedReviewFinding(item: TraceabilityItem): boolean {
  const status = item.review?.status?.trim().toLowerCase()
  return status === "closed" || status === "resolved" || status === "fixed" || status === "done"
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
