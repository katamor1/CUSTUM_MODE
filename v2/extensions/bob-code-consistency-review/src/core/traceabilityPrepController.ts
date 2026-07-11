import { validateTraceabilityCatalog, type TraceabilityCatalog, type TraceabilityGate, type TraceabilityLinkType, type TraceabilityValidationReport } from "./traceabilityCatalog"

type TraceabilityLinkEntity = NonNullable<TraceabilityCatalog["links"]>[number]

export type TraceabilityPrepAction =
  | { type: "approveDomain"; code: string }
  | { type: "rejectDomain"; code: string }
  | { type: "restoreDomain"; code: string }
  | { type: "approveItem"; proposed_id: string }
  | { type: "rejectItem"; proposed_id: string }
  | { type: "deprecateItem"; id: string }
  | { type: "restoreItem"; id: string }
  | { type: "approveLink"; proposed_from: string; proposed_to: string; link_type: TraceabilityLinkType }
  | { type: "rejectLink"; proposed_from: string; proposed_to: string; link_type: TraceabilityLinkType }
  | { type: "restoreLink"; from: string; to: string; link_type: TraceabilityLinkType }
  | { type: "approveDecision"; subject: string; gate: string }
  | { type: "rejectDecision"; subject: string; gate: string }
  | { type: "restoreDecision"; subject: string; gate: string }
  | { type: "deferIssue"; code: string; subject?: string; message?: string }

export type TraceabilityPrepModel = {
  catalog: TraceabilityCatalog
  report: TraceabilityValidationReport
  counts: {
    proposedDomains: number
    proposedItems: number
    proposedLinks: number
    proposedDecisions: number
  }
}

export type TraceabilityPrepActionResult =
  | { status: "ok"; catalog: TraceabilityCatalog; model: TraceabilityPrepModel }
  | { status: "error"; message: string; catalog: TraceabilityCatalog; model: TraceabilityPrepModel }

export function buildTraceabilityPrepModel(catalog: TraceabilityCatalog): TraceabilityPrepModel {
  return {
    catalog,
    report: validateTraceabilityCatalog(catalog),
    counts: {
      proposedDomains: (catalog.domains ?? []).filter((item) => item.status === "proposed").length,
      proposedItems: (catalog.items ?? []).filter((item) => item.status === "proposed").length,
      proposedLinks: (catalog.links ?? []).filter((item) => item.status === "proposed").length,
      proposedDecisions: (catalog.decisions ?? []).filter((item) => item.status === "proposed").length
    }
  }
}

export function applyTraceabilityPrepAction(
  catalog: TraceabilityCatalog,
  action: TraceabilityPrepAction,
  originalCatalog?: TraceabilityCatalog
): TraceabilityPrepActionResult {
  const next = cloneCatalog(catalog)
  const error = applyAction(next, action, originalCatalog ?? catalog)
  const model = buildTraceabilityPrepModel(next)
  if (error) return { status: "error", message: error, catalog: next, model }
  return { status: "ok", catalog: next, model }
}

function applyAction(catalog: TraceabilityCatalog, action: TraceabilityPrepAction, originalCatalog: TraceabilityCatalog): string | undefined {
  if (action.type === "approveDomain" || action.type === "rejectDomain") {
    const domain = catalog.domains.find((item) => item.code === action.code)
    if (!domain) return `domain not found: ${action.code}`
    domain.status = action.type === "approveDomain" ? "accepted" : "rejected"
    return undefined
  }

  if (action.type === "restoreDomain") {
    return restoreDomain(catalog, originalCatalog, action.code)
  }

  if (action.type === "approveItem" || action.type === "rejectItem") {
    const item = catalog.items.find((candidate) => candidate.proposed_id === action.proposed_id)
    if (!item) return `item not found: ${action.proposed_id}`
    if (action.type === "approveItem") {
      if (!item.proposed_id) return "approved item requires proposed_id"
      item.id = item.proposed_id
      item.status = "accepted"
    } else {
      item.status = "rejected"
    }
    return undefined
  }

  if (action.type === "deprecateItem") {
    const item = catalog.items.find((candidate) => candidate.id === action.id)
    if (!item) return `item not found: ${action.id}`
    item.status = "deprecated"
    return undefined
  }

  if (action.type === "restoreItem") {
    return restoreItem(catalog, originalCatalog, action.id)
  }

  if (action.type === "approveLink" || action.type === "rejectLink") {
    const link = (catalog.links ?? []).find((candidate) =>
      candidate.proposed_from === action.proposed_from &&
      candidate.proposed_to === action.proposed_to &&
      candidate.link_type === action.link_type
    )
    if (!link) return `link not found: ${action.proposed_from} -> ${action.proposed_to}`
    if (action.type === "approveLink") {
      link.from = link.proposed_from
      link.to = link.proposed_to
      link.status = "accepted"
    } else {
      link.status = "rejected"
    }
    return undefined
  }

  if (action.type === "restoreLink") {
    return restoreLink(catalog, originalCatalog, action.from, action.to, action.link_type)
  }

  if (action.type === "approveDecision" || action.type === "rejectDecision") {
    const decision = (catalog.decisions ?? []).find((candidate) => candidate.subject === action.subject && candidate.gate === action.gate)
    if (!decision) return `decision not found: ${action.subject}`
    if (action.type === "approveDecision") {
      if (!decision.reason?.trim()) return "decision approval requires reason"
      decision.status = "accepted"
    } else {
      decision.status = "rejected"
    }
    return undefined
  }

  if (action.type === "restoreDecision") {
    return restoreDecision(catalog, originalCatalog, action.subject, action.gate)
  }

  if (action.type === "deferIssue") {
    return deferIssue(catalog, action.code, action.subject, action.message)
  }

  return `unsupported action: ${(action as { type?: string }).type ?? "(unknown)"}`
}

function deferIssue(catalog: TraceabilityCatalog, code: string, subject: string | undefined, message: string | undefined): string | undefined {
  const gate = gateForIssue(code)
  if (!gate) return `issue cannot be deferred: ${code}`
  if (!subject?.trim()) return `issue has no subject: ${code}`
  const item = catalog.items.find((candidate) => candidate.id === subject && candidate.status === "accepted")
  if (!item) return `accepted item not found: ${subject}`
  const decisions = catalog.decisions ??= []
  const reason = message?.trim() ? `TBD: ${message.trim()}` : `TBD: ${code}`
  const existing = decisions.find((decision) => decision.subject === subject && decision.gate === gate)
  if (existing) {
    existing.decision = "tbd"
    existing.reason = existing.reason?.trim() || reason
    existing.status = "accepted"
  } else {
    decisions.push({ subject, gate, decision: "tbd", reason, status: "accepted" })
  }
  return undefined
}

function gateForIssue(code: string): TraceabilityGate | undefined {
  if (code === "missing_basic_design") return "basic_design"
  if (code === "missing_detailed_design") return "detailed_design"
  if (code === "missing_test") return "test"
  if (code === "missing_qa_clarifies") return "clarifies"
  if (code === "missing_reviewed_by") return "reviewed_by"
  if (code === "unresolved_review_finding") return "resolution"
  return undefined
}

function restoreDomain(catalog: TraceabilityCatalog, originalCatalog: TraceabilityCatalog, code: string): string | undefined {
  const original = originalCatalog.domains.find((item) => item.code === code)
  if (!original) return `original domain not found: ${code}`
  const index = catalog.domains.findIndex((item) => item.code === code)
  if (index < 0) return `domain not found: ${code}`
  catalog.domains[index] = cloneValue(original)
  return undefined
}

function restoreItem(catalog: TraceabilityCatalog, originalCatalog: TraceabilityCatalog, id: string): string | undefined {
  const original = originalCatalog.items.find((item) => traceabilityItemKey(item) === id)
  if (!original) return `original item not found: ${id}`
  const index = catalog.items.findIndex((item) => traceabilityItemKey(item) === id)
  if (index < 0) return `item not found: ${id}`
  catalog.items[index] = cloneValue(original)
  return undefined
}

function restoreLink(
  catalog: TraceabilityCatalog,
  originalCatalog: TraceabilityCatalog,
  from: string,
  to: string,
  linkType: TraceabilityLinkType
): string | undefined {
  const original = (originalCatalog.links ?? []).find((link) => traceabilityLinkMatches(link, from, to, linkType))
  if (!original) return `original link not found: ${from} -> ${to}`
  const index = (catalog.links ?? []).findIndex((link) => traceabilityLinkMatches(link, from, to, linkType))
  if (index < 0 || !catalog.links) return `link not found: ${from} -> ${to}`
  catalog.links[index] = cloneValue(original)
  return undefined
}

function restoreDecision(
  catalog: TraceabilityCatalog,
  originalCatalog: TraceabilityCatalog,
  subject: string,
  gate: string
): string | undefined {
  const original = (originalCatalog.decisions ?? []).find((decision) => decision.subject === subject && decision.gate === gate)
  if (!original) return `original decision not found: ${subject}`
  const index = (catalog.decisions ?? []).findIndex((decision) => decision.subject === subject && decision.gate === gate)
  if (index < 0 || !catalog.decisions) return `decision not found: ${subject}`
  catalog.decisions[index] = cloneValue(original)
  return undefined
}

function traceabilityItemKey(item: TraceabilityCatalog["items"][number]): string {
  return item.id || item.proposed_id || ""
}

function traceabilityLinkMatches(
  link: TraceabilityLinkEntity,
  from: string,
  to: string,
  linkType: TraceabilityLinkType
): boolean {
  return traceabilityLinkFrom(link) === from && traceabilityLinkTo(link) === to && link.link_type === linkType
}

function traceabilityLinkFrom(link: TraceabilityLinkEntity): string {
  return link.from || link.proposed_from || ""
}

function traceabilityLinkTo(link: TraceabilityLinkEntity): string {
  return link.to || link.proposed_to || ""
}

function cloneCatalog(catalog: TraceabilityCatalog): TraceabilityCatalog {
  return cloneValue(catalog)
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
