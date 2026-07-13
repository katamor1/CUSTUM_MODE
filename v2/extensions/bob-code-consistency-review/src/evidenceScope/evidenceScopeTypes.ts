export type ScopePriority = "required" | "high" | "medium" | "low"
export type ScopeItemKind = "code" | "rule" | "document"

export type ScopeSymbol = {
  id: string
  name: string
  path: string
  kind: string
  language?: string
  estimatedTokens: number
  visibility?: "public" | "protected" | "private" | "internal" | "unknown"
  interfaceChange?: boolean
  riskTags?: string[]
}

export type DependencyEdge = {
  from: string
  to?: string
  kind: string
  resolution: "resolved" | "unknown"
  reason: string
  targetHint?: string
}

export type RuleApplicability = {
  paths?: string[]
  languages?: string[]
  symbolKinds?: string[]
  riskTags?: string[]
  interfaceChange?: boolean
}

export type ProjectRule = {
  id: string
  title: string
  evaluation: "local" | "ai"
  estimatedTokens?: number
  priority?: ScopePriority
  appliesWhen?: RuleApplicability
}

export type DocumentEvidenceUnit = {
  id: string
  sourcePath: string
  locator: string
  contentHash: string
  estimatedTokens: number
  linkedSymbols?: string[]
  tags?: string[]
  keywords?: string[]
}

export type DocumentEvidenceQuery = {
  symbolIds: string[]
  riskTags: string[]
  ruleIds: string[]
  keywords: string[]
}

export interface DocumentEvidenceAdapter {
  findCandidates(query: DocumentEvidenceQuery): DocumentEvidenceUnit[]
}

export type ScopeBudgetItem = {
  id: string
  kind: ScopeItemKind
  priority: ScopePriority
  estimatedTokens: number
  reasons: string[]
}

export type SelectedScopeItem = ScopeBudgetItem

export type ExcludedScopeItem = ScopeBudgetItem & {
  exclusionReason: "token-budget" | "low-priority-policy"
}

export type ContextBudgetReport = {
  budgetTokens: number
  selectedTokens: number
  requiredTokens: number
  overBudget: boolean
  selected: SelectedScopeItem[]
  excluded: ExcludedScopeItem[]
}

export type UnknownImpact = {
  sourceId: string
  edgeKind: string
  reason: string
  targetHint?: string
}

export type EvidenceScopeRequest = {
  changedSymbolIds: string[]
  symbols: ScopeSymbol[]
  dependencyEdges: DependencyEdge[]
  maxDependencyDepth: number
  rules: ProjectRule[]
  documentEvidence?: DocumentEvidenceAdapter
  documentKeywords?: string[]
  tokenBudget: number
  includeLowPriority?: boolean
}

export type EvidenceScopeResult = {
  scopeFingerprint: string
  selectedCode: SelectedScopeItem[]
  applicableRules: ProjectRule[]
  selectedDocuments: SelectedScopeItem[]
  unknownImpact: UnknownImpact[]
  budgetReport: ContextBudgetReport
  warnings: string[]
}
