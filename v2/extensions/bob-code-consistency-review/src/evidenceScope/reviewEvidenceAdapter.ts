import type { CodeAnalysisResult } from "../core/analysisTypes"
import type { DocumentExtractionResult, EvidenceRef } from "../core/documentTypes"
import { buildEvidenceScope } from "./changeScopeEngine"
import { InMemoryDocumentEvidenceAdapter } from "./documentEvidenceAdapter"
import { mergeRepositoryScopeData } from "./repositorySymbolIndexAdapter"
import type { LoadedRepositorySymbolIndex } from "./repositorySymbolIndexLoader"
import type {
  DependencyEdge,
  DocumentEvidenceUnit,
  EvidenceScopeResult,
  ProjectRule,
  ScopeSymbol
} from "./evidenceScopeTypes"

export type ReviewEvidenceScopeOptions = {
  changedSymbolIds?: string[]
  tokenBudget: number
  maxDependencyDepth: number
  rules: ProjectRule[]
  documentKeywords?: string[]
  includeLowPriority?: boolean
  repositoryIndex?: LoadedRepositorySymbolIndex
}

export function buildReviewEvidenceScope(
  analysis: CodeAnalysisResult,
  documents: DocumentExtractionResult | undefined,
  options: ReviewEvidenceScopeOptions
): EvidenceScopeResult {
  const analysisSymbols = adaptSymbols(analysis)
  const initialMerge = mergeRepositoryScopeData(analysisSymbols, [], options.repositoryIndex)
  const symbolIdByAlias = buildSymbolAliasIndex(initialMerge.symbols)
  for (const [analysisId, canonicalId] of initialMerge.symbolIdMap) {
    symbolIdByAlias.set(analysisId, canonicalId)
  }

  const analysisEdges = adaptDependencyEdges(analysis, symbolIdByAlias)
  const repositoryScope = mergeRepositoryScopeData(
    analysisSymbols,
    analysisEdges,
    options.repositoryIndex
  )
  const documentUnits = adaptDocumentEvidence(documents?.evidence ?? [])
  const requestedChangedSymbolIds = options.changedSymbolIds?.length
    ? options.changedSymbolIds
    : analysis.changedSymbols.map((symbol) => symbol.id)
  const changedSymbolIds = requestedChangedSymbolIds.map((id) =>
    repositoryScope.symbolIdMap.get(id) ?? symbolIdByAlias.get(id) ?? id
  )

  const scope = buildEvidenceScope({
    changedSymbolIds,
    symbols: repositoryScope.symbols,
    dependencyEdges: repositoryScope.dependencyEdges,
    maxDependencyDepth: options.maxDependencyDepth,
    rules: options.rules,
    documentEvidence: new InMemoryDocumentEvidenceAdapter(documentUnits),
    documentKeywords: options.documentKeywords,
    tokenBudget: options.tokenBudget,
    includeLowPriority: options.includeLowPriority
  })

  return {
    ...scope,
    warnings: [...new Set([
      ...initialMerge.warnings,
      ...repositoryScope.warnings,
      ...scope.warnings
    ])].sort()
  }
}

function adaptSymbols(analysis: CodeAnalysisResult): ScopeSymbol[] {
  const sliceByFunction = new Map<string, CodeAnalysisResult["codeSlices"][number]>()
  for (const slice of analysis.codeSlices) {
    if (slice.functionName && !sliceByFunction.has(slice.functionName)) sliceByFunction.set(slice.functionName, slice)
  }

  const byId = new Map<string, ScopeSymbol>()
  for (const changed of analysis.changedSymbols) {
    const slice = analysis.codeSlices.find((item) => item.evidence_id === changed.evidence_id)
      ?? sliceByFunction.get(changed.name)
    byId.set(changed.id, {
      id: changed.id,
      name: changed.name,
      path: changed.file,
      kind: changed.kind,
      language: languageFromPath(changed.file),
      estimatedTokens: estimateTokens(slice?.text ?? changed.name),
      interfaceChange: isInterfaceChange(changed.change_type),
      riskTags: riskTagsForChangedSymbol(changed.change_type)
    })
  }

  for (const fn of analysis.functions) {
    const existing = byId.get(fn.id)
    if (existing) continue
    const slice = analysis.codeSlices.find((item) => item.evidence_id === fn.evidence_id)
      ?? sliceByFunction.get(fn.name)
    byId.set(fn.id, {
      id: fn.id,
      name: fn.name,
      path: fn.file,
      kind: "function",
      language: languageFromPath(fn.file),
      estimatedTokens: estimateTokens(slice?.text ?? fn.name),
      interfaceChange: false,
      riskTags: []
    })
  }

  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id))
}

function buildSymbolAliasIndex(symbols: ScopeSymbol[]): Map<string, string> {
  const aliases = new Map<string, string>()
  const idsByName = new Map<string, string[]>()
  for (const symbol of symbols) {
    aliases.set(symbol.id, symbol.id)
    const ids = idsByName.get(symbol.name) ?? []
    ids.push(symbol.id)
    idsByName.set(symbol.name, ids)
  }
  for (const [name, ids] of idsByName) {
    if (ids.length === 1) aliases.set(name, ids[0])
  }
  return aliases
}

function adaptDependencyEdges(analysis: CodeAnalysisResult, aliases: Map<string, string>): DependencyEdge[] {
  return analysis.callGraph.map((edge) => {
    const from = aliases.get(edge.from) ?? edge.from
    const to = aliases.get(edge.to)
    return {
      from,
      ...(to ? { to } : { targetHint: edge.to }),
      kind: "calls",
      resolution: to ? "resolved" : "unknown",
      reason: edge.reason
    }
  })
}

function adaptDocumentEvidence(evidence: EvidenceRef[]): DocumentEvidenceUnit[] {
  return evidence.map((item) => ({
    id: item.evidence_id,
    sourcePath: item.source ?? item.ref,
    locator: item.location ?? item.ref,
    contentHash: stableFingerprint(item.text ?? item.ref),
    estimatedTokens: estimateTokens(item.text ?? item.ref),
    tags: [item.type],
    keywords: tokenize(item.text ?? item.ref)
  }))
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4))
}

function isInterfaceChange(changeType: string | undefined): boolean {
  const normalized = (changeType ?? "").toLowerCase()
  return normalized.includes("signature") || normalized.includes("interface") || normalized.includes("public")
}

function riskTagsForChangedSymbol(changeType: string | undefined): string[] {
  return isInterfaceChange(changeType) ? ["compatibility"] : []
}

function languageFromPath(path: string): string {
  const extension = path.toLowerCase().split(".").pop() ?? ""
  if (["c", "h"].includes(extension)) return "c"
  if (["cc", "cpp", "cxx", "hpp", "hh", "hxx"].includes(extension)) return "cpp"
  if (extension === "ts" || extension === "tsx") return "typescript"
  if (extension === "js" || extension === "jsx") return "javascript"
  if (extension === "py") return "python"
  if (extension === "java") return "java"
  if (extension === "sql") return "sql"
  return extension || "unknown"
}

function tokenize(value: string): string[] {
  return [...new Set(value.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((term) => term.length >= 2))].sort()
}

function stableFingerprint(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}
