import { planContextBudget } from "./contextBudgetPlanner"
import { selectApplicableRules } from "./rulePackEngine"
import type {
  DependencyEdge,
  DocumentEvidenceUnit,
  EvidenceScopeRequest,
  EvidenceScopeResult,
  ProjectRule,
  ScopeBudgetItem,
  ScopePriority,
  ScopeSymbol,
  UnknownImpact
} from "./evidenceScopeTypes"

const PRIORITY_BY_DEPTH: Record<number, ScopePriority> = {
  0: "required",
  1: "high"
}

export function buildEvidenceScope(request: EvidenceScopeRequest): EvidenceScopeResult {
  const warnings: string[] = []
  const symbolById = new Map(request.symbols.map((symbol) => [symbol.id, normalizeSymbol(symbol)]))
  const changedIds = [...new Set(request.changedSymbolIds)].sort()
  const candidates = expandCodeScope(changedIds, symbolById, request.dependencyEdges, request.maxDependencyDepth, warnings)
  const impactedSymbols = [...candidates.values()].map((candidate) => candidate.symbol)
  const applicableRules = selectApplicableRules(request.rules, impactedSymbols)
  const documentUnits = request.documentEvidence?.findCandidates({
    symbolIds: impactedSymbols.map((symbol) => symbol.id).sort(),
    riskTags: [...new Set(impactedSymbols.flatMap((symbol) => symbol.riskTags ?? []))].sort(),
    ruleIds: applicableRules.map((rule) => rule.id),
    keywords: [...new Set(request.documentKeywords ?? [])].sort()
  }) ?? []

  const budgetItems = [
    ...codeBudgetItems(candidates),
    ...ruleBudgetItems(applicableRules),
    ...documentBudgetItems(documentUnits, changedIds)
  ]
  const budgetReport = planContextBudget(budgetItems, {
    tokenBudget: request.tokenBudget,
    includeLowPriority: request.includeLowPriority
  })
  if (budgetReport.overBudget) {
    warnings.push(`required evidence exceeds token budget (${budgetReport.requiredTokens} > ${budgetReport.budgetTokens})`)
  }

  const selectedCode = budgetReport.selected.filter((item) => item.kind === "code")
  const selectedDocuments = budgetReport.selected.filter((item) => item.kind === "document")
  const selectedIds = budgetReport.selected.map((item) => `${item.kind}:${item.id}`)
  const unknownImpact = collectUnknownImpact(request.dependencyEdges, new Set(candidates.keys()))

  return {
    scopeFingerprint: createScopeFingerprint([
      ...selectedIds,
      ...unknownImpact.map((item) => `unknown:${item.sourceId}:${item.edgeKind}:${item.reason}:${item.targetHint ?? ""}`)
    ]),
    selectedCode,
    applicableRules,
    selectedDocuments,
    unknownImpact,
    budgetReport,
    warnings: [...new Set(warnings)].sort()
  }
}

type CodeCandidate = {
  symbol: ScopeSymbol
  priority: ScopePriority
  depth: number
  reasons: string[]
}

function expandCodeScope(
  changedIds: string[],
  symbolById: Map<string, ScopeSymbol>,
  edges: DependencyEdge[],
  maxDepth: number,
  warnings: string[]
): Map<string, CodeCandidate> {
  const candidates = new Map<string, CodeCandidate>()
  const queue: Array<{ id: string; depth: number }> = []
  const normalizedMaxDepth = Number.isFinite(maxDepth)
    ? Math.max(0, Math.floor(maxDepth))
    : 0

  for (const id of changedIds) {
    const symbol = symbolById.get(id)
    if (!symbol) {
      warnings.push(`changed symbol not found: ${id}`)
      continue
    }
    candidates.set(id, {
      symbol,
      priority: "required",
      depth: 0,
      reasons: changedReasons(symbol)
    })
    queue.push({ id, depth: 0 })
  }

  const resolvedEdges = edges
    .filter((edge) => edge.resolution === "resolved" && edge.to)
    .slice()
    .sort(compareEdges)

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || current.depth >= normalizedMaxDepth) continue

    for (const edge of resolvedEdges) {
      const neighbor = connectedNeighbor(edge, current.id)
      if (!neighbor) continue
      const symbol = symbolById.get(neighbor)
      if (!symbol) {
        warnings.push(`dependency symbol not found: ${neighbor}`)
        continue
      }

      const nextDepth = current.depth + 1
      const priority = PRIORITY_BY_DEPTH[nextDepth] ?? "medium"
      const reason = nextDepth === 1
        ? `direct ${edge.kind} dependency of ${current.id}: ${edge.reason}`
        : `${nextDepth}-hop ${edge.kind} dependency via ${current.id}: ${edge.reason}`
      const existing = candidates.get(neighbor)
      if (!existing || nextDepth < existing.depth) {
        candidates.set(neighbor, { symbol, priority, depth: nextDepth, reasons: [reason] })
        queue.push({ id: neighbor, depth: nextDepth })
      } else if (nextDepth === existing.depth && !existing.reasons.includes(reason)) {
        existing.reasons.push(reason)
        existing.reasons.sort()
      }
    }
  }

  return candidates
}

function changedReasons(symbol: ScopeSymbol): string[] {
  const reasons = ["changed symbol"]
  if (symbol.interfaceChange) reasons.push("public or interface contract changed")
  for (const riskTag of symbol.riskTags ?? []) reasons.push(`risk:${riskTag}`)
  return reasons.sort()
}

function connectedNeighbor(edge: DependencyEdge, symbolId: string): string | undefined {
  if (edge.from === symbolId) return edge.to
  if (edge.to === symbolId) return edge.from
  return undefined
}

function compareEdges(left: DependencyEdge, right: DependencyEdge): number {
  return left.from.localeCompare(right.from)
    || (left.to ?? "").localeCompare(right.to ?? "")
    || left.kind.localeCompare(right.kind)
    || left.reason.localeCompare(right.reason)
}

function codeBudgetItems(candidates: Map<string, CodeCandidate>): ScopeBudgetItem[] {
  return [...candidates.values()].map((candidate) => ({
    id: candidate.symbol.id,
    kind: "code",
    priority: candidate.priority,
    estimatedTokens: candidate.symbol.estimatedTokens,
    reasons: candidate.reasons
  }))
}

function ruleBudgetItems(rules: ProjectRule[]): ScopeBudgetItem[] {
  return rules.map((rule) => ({
    id: rule.id,
    kind: "rule",
    priority: rule.priority ?? "required",
    estimatedTokens: rule.evaluation === "local" ? 0 : rule.estimatedTokens ?? 0,
    reasons: [`applicable ${rule.evaluation} rule: ${rule.title}`]
  }))
}

function documentBudgetItems(units: DocumentEvidenceUnit[], changedIds: string[]): ScopeBudgetItem[] {
  const changed = new Set(changedIds)
  return units.map((unit) => {
    const directlyLinked = (unit.linkedSymbols ?? []).some((id) => changed.has(id))
    return {
      id: unit.id,
      kind: "document",
      priority: directlyLinked ? "high" : "medium",
      estimatedTokens: unit.estimatedTokens,
      reasons: [directlyLinked ? "document linked to changed symbol" : "document matched scope query"]
    }
  })
}

function collectUnknownImpact(edges: DependencyEdge[], includedSymbols: Set<string>): UnknownImpact[] {
  const unknown = edges
    .filter((edge) => edge.resolution === "unknown" && (includedSymbols.has(edge.from) || Boolean(edge.to && includedSymbols.has(edge.to))))
    .map((edge) => ({
      sourceId: includedSymbols.has(edge.from) ? edge.from : edge.to ?? edge.from,
      edgeKind: edge.kind,
      reason: edge.reason,
      ...(edge.targetHint ? { targetHint: edge.targetHint } : {})
    }))

  const byKey = new Map<string, UnknownImpact>()
  for (const item of unknown) {
    const key = `${item.sourceId}\u0000${item.edgeKind}\u0000${item.reason}\u0000${item.targetHint ?? ""}`
    byKey.set(key, item)
  }
  return [...byKey.values()].sort((left, right) => left.sourceId.localeCompare(right.sourceId)
    || left.edgeKind.localeCompare(right.edgeKind)
    || left.reason.localeCompare(right.reason)
    || (left.targetHint ?? "").localeCompare(right.targetHint ?? ""))
}

function normalizeSymbol(symbol: ScopeSymbol): ScopeSymbol {
  return {
    ...symbol,
    estimatedTokens: normalizeTokenCount(symbol.estimatedTokens),
    riskTags: [...new Set(symbol.riskTags ?? [])].sort()
  }
}

function normalizeTokenCount(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.ceil(value))
}

function createScopeFingerprint(parts: string[]): string {
  const canonical = [...new Set(parts)].sort().join("\n")
  let hash = 0x811c9dc5
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `scope-${hash.toString(16).padStart(8, "0")}`
}
