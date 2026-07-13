import type { EvidenceScopeResult } from "./evidenceScopeTypes"
import type { ProjectRulePackProvenance } from "./projectRulePackLoader"
import type { RepositorySymbolIndexProvenance } from "./repositorySymbolIndexLoader"

export type ContextBudgetArtifactMetadata = {
  base: string
  head: string
  tokenEstimation: string
  ruleSource: string
  rulePack?: ProjectRulePackProvenance
  symbolIndex?: RepositorySymbolIndexProvenance
}

export type ContextBudgetRulePack = {
  schema_version: 1
  id: string
  version: string
  source_path: string
  content_hash: string
}

export type ContextBudgetSymbolIndex = {
  schema_version: 1
  id: string
  source_revision: string
  source_path: string
  content_hash: string
  symbol_count: number
  edge_count: number
}

export type ContextBudgetArtifact = {
  schema_version: 1
  selection_policy: "bob-evidence-scope-v1"
  scope_fingerprint: string
  source_revision: string
  token_estimation: string
  rule_source: string
  rule_pack?: ContextBudgetRulePack
  symbol_index?: ContextBudgetSymbolIndex
  selected_code: EvidenceScopeResult["selectedCode"]
  applicable_rules: EvidenceScopeResult["applicableRules"]
  selected_documents: EvidenceScopeResult["selectedDocuments"]
  unknown_impact: EvidenceScopeResult["unknownImpact"]
  budget: EvidenceScopeResult["budgetReport"]
  warnings: string[]
}

export function createContextBudgetArtifact(
  scope: EvidenceScopeResult,
  metadata: ContextBudgetArtifactMetadata
): ContextBudgetArtifact {
  return {
    schema_version: 1,
    selection_policy: "bob-evidence-scope-v1",
    scope_fingerprint: scope.scopeFingerprint,
    source_revision: sourceRevision(metadata.base, metadata.head),
    token_estimation: metadata.tokenEstimation,
    rule_source: metadata.ruleSource,
    ...(metadata.rulePack
      ? {
rule_pack: {
  schema_version: 1,
  id: metadata.rulePack.id,
  version: metadata.rulePack.version,
  source_path: metadata.rulePack.sourcePath,
  content_hash: metadata.rulePack.contentHash
}
        }
      : {}),
    ...(metadata.symbolIndex
      ? {
symbol_index: {
  schema_version: 1,
  id: metadata.symbolIndex.id,
  source_revision: metadata.symbolIndex.sourceRevision,
  source_path: metadata.symbolIndex.sourcePath,
  content_hash: metadata.symbolIndex.contentHash,
  symbol_count: metadata.symbolIndex.symbolCount,
  edge_count: metadata.symbolIndex.edgeCount
}
        }
      : {}),
    selected_code: scope.selectedCode,
    applicable_rules: scope.applicableRules,
    selected_documents: scope.selectedDocuments,
    unknown_impact: scope.unknownImpact,
    budget: scope.budgetReport,
    warnings: scope.warnings
  }
}

function sourceRevision(base: string, head: string): string {
  if (base && head) return `${base}..${head}`
  return head || base || ""
}
