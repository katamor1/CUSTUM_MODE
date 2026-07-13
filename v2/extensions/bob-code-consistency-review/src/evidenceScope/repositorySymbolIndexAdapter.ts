import type { DependencyEdge, ScopeSymbol } from "./evidenceScopeTypes"
import type { LoadedRepositorySymbolIndex } from "./repositorySymbolIndexLoader"

export type RepositoryScopeData = {
  symbols: ScopeSymbol[]
  dependencyEdges: DependencyEdge[]
  symbolIdMap: Map<string, string>
  warnings: string[]
}

export function mergeRepositoryScopeData(
  analysisSymbols: ScopeSymbol[],
  analysisEdges: DependencyEdge[],
  repositoryIndex: LoadedRepositorySymbolIndex | undefined
): RepositoryScopeData {
  const symbolIdMap = new Map<string, string>()
  const warnings: string[] = []

  if (!repositoryIndex) {
    for (const symbol of analysisSymbols) symbolIdMap.set(symbol.id, symbol.id)
    return {
      symbols: [...analysisSymbols].sort(compareSymbols),
      dependencyEdges: [...analysisEdges].sort(compareEdges),
      symbolIdMap,
      warnings
    }
  }

  const repositorySymbols = [...repositoryIndex.symbols].sort(compareSymbols)
  const repositoryById = new Map(repositorySymbols.map((symbol) => [symbol.id, symbol]))
  const repositoryByIdentity = new Map<string, ScopeSymbol[]>()
  for (const symbol of repositorySymbols) {
    const key = symbolIdentity(symbol)
    const values = repositoryByIdentity.get(key) ?? []
    values.push(symbol)
    repositoryByIdentity.set(key, values)
  }

  const symbolsById = new Map<string, ScopeSymbol>(repositoryById)
  for (const analysisSymbol of [...analysisSymbols].sort(compareSymbols)) {
    const exact = repositoryById.get(analysisSymbol.id)
    const identityMatches = repositoryByIdentity.get(symbolIdentity(analysisSymbol)) ?? []
    const identityMatch = identityMatches.length === 1 ? identityMatches[0] : undefined
    const canonical = exact ?? identityMatch

    if (!exact && identityMatches.length > 1) {
      warnings.push(
        `repository symbol match is ambiguous for ${analysisSymbol.id} (${analysisSymbol.path}#${analysisSymbol.name}:${analysisSymbol.kind}); analysis id retained.`
      )
    }

    const canonicalId = canonical?.id ?? analysisSymbol.id
    symbolIdMap.set(analysisSymbol.id, canonicalId)
    symbolsById.set(canonicalId, mergeSymbols(canonical, analysisSymbol, canonicalId))
  }

  const remappedAnalysisEdges = analysisEdges.map((edge) => remapEdge(edge, symbolIdMap))
  const edgesByIdentity = new Map<string, DependencyEdge>()
  for (const edge of [...repositoryIndex.dependencyEdges].sort(compareEdges)) {
    edgesByIdentity.set(edgeIdentity(edge), edge)
  }
  for (const edge of remappedAnalysisEdges.sort(compareEdges)) {
    edgesByIdentity.set(edgeIdentity(edge), edge)
  }

  return {
    symbols: [...symbolsById.values()].sort(compareSymbols),
    dependencyEdges: [...edgesByIdentity.values()].sort(compareEdges),
    symbolIdMap,
    warnings: [...new Set(warnings)].sort()
  }
}

function mergeSymbols(
  repositorySymbol: ScopeSymbol | undefined,
  analysisSymbol: ScopeSymbol,
  canonicalId: string
): ScopeSymbol {
  return {
    ...repositorySymbol,
    ...analysisSymbol,
    id: canonicalId,
    riskTags: [...new Set([
      ...(repositorySymbol?.riskTags ?? []),
      ...(analysisSymbol.riskTags ?? [])
    ])].sort()
  }
}

function remapEdge(edge: DependencyEdge, symbolIdMap: Map<string, string>): DependencyEdge {
  return {
    ...edge,
    from: symbolIdMap.get(edge.from) ?? edge.from,
    ...(edge.to ? { to: symbolIdMap.get(edge.to) ?? edge.to } : {})
  }
}

function symbolIdentity(symbol: ScopeSymbol): string {
  return `${symbol.path.replace(/\\/g, "/")}\u0000${symbol.name}\u0000${symbol.kind}`
}

function compareSymbols(left: ScopeSymbol, right: ScopeSymbol): number {
  return left.id.localeCompare(right.id)
}

function edgeIdentity(edge: DependencyEdge): string {
  return `${edge.from}\u0000${edge.to ?? ""}\u0000${edge.kind}\u0000${edge.resolution}`
}

function compareEdges(left: DependencyEdge, right: DependencyEdge): number {
  return edgeIdentity(left).localeCompare(edgeIdentity(right))
    || left.reason.localeCompare(right.reason)
    || (left.targetHint ?? "").localeCompare(right.targetHint ?? "")
}
