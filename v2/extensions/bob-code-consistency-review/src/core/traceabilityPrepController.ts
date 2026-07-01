import { validateTraceabilityCatalog, type TraceabilityCatalog, type TraceabilityLinkType, type TraceabilityValidationReport } from "./traceabilityCatalog"

export type TraceabilityPrepAction =
  | { type: "approveDomain"; code: string }
  | { type: "rejectDomain"; code: string }
  | { type: "approveItem"; proposed_id: string }
  | { type: "rejectItem"; proposed_id: string }
  | { type: "deprecateItem"; id: string }
  | { type: "approveLink"; proposed_from: string; proposed_to: string; link_type: TraceabilityLinkType }
  | { type: "rejectLink"; proposed_from: string; proposed_to: string; link_type: TraceabilityLinkType }
  | { type: "approveDecision"; subject: string; gate: string }
  | { type: "rejectDecision"; subject: string; gate: string }

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

export function applyTraceabilityPrepAction(catalog: TraceabilityCatalog, action: TraceabilityPrepAction): TraceabilityPrepActionResult {
  const next = cloneCatalog(catalog)
  const error = applyAction(next, action)
  const model = buildTraceabilityPrepModel(next)
  if (error) return { status: "error", message: error, catalog: next, model }
  return { status: "ok", catalog: next, model }
}

function applyAction(catalog: TraceabilityCatalog, action: TraceabilityPrepAction): string | undefined {
  if (action.type === "approveDomain" || action.type === "rejectDomain") {
    const domain = catalog.domains.find((item) => item.code === action.code)
    if (!domain) return `domain not found: ${action.code}`
    domain.status = action.type === "approveDomain" ? "accepted" : "rejected"
    return undefined
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

  if (action.type === "approveDecision" || action.type === "rejectDecision") {
    const decision = (catalog.decisions ?? []).find((candidate) => candidate.subject === action.subject && candidate.gate === action.gate)
    if (!decision) return `decision not found: ${action.subject}`
    if (action.type === "approveDecision") {
      if (!decision.reason?.trim()) return "n/a decision approval requires reason"
      decision.status = "accepted"
    } else {
      decision.status = "rejected"
    }
    return undefined
  }

  return `unsupported action: ${(action as { type?: string }).type ?? "(unknown)"}`
}

function cloneCatalog(catalog: TraceabilityCatalog): TraceabilityCatalog {
  return JSON.parse(JSON.stringify(catalog)) as TraceabilityCatalog
}
