import type { CodeAnalysisResult } from "../core/analysisTypes"
import type { DiffSummary } from "../core/diffTypes"
import type { DocumentExtractionResult } from "../core/documentTypes"
import type { ReviewProcessingLimits } from "../core/limits"
import type { ReviewInput } from "../core/reviewTypes"
import {
  createContextBudgetArtifact,
  type ContextBudgetArtifact
} from "./contextBudgetArtifact"
import { parseProjectRules } from "./projectRuleConfig"
import {
  loadProjectRulePack,
  mergeProjectRules
} from "./projectRulePackLoader"
import { loadRepositorySymbolIndex } from "./repositorySymbolIndexLoader"
import { buildReviewEvidenceScope } from "./reviewEvidenceAdapter"

export type ReviewContextBudgetInput = {
  workspaceRoot: string
  reviewInput: ReviewInput
  diff: DiffSummary
  documents: DocumentExtractionResult
  codeAnalysis: CodeAnalysisResult
  limits: ReviewProcessingLimits
  textEncoding?: string
}

export type ReviewContextBudgetResult = {
  artifact: ContextBudgetArtifact
  warnings: string[]
}

const TOKEN_ESTIMATION_POLICY = "ceil(text.length / 4); budget=floor(maxBobInputBytes / 4)"
const INLINE_RULE_CONFIG_SOURCE = "review-input.bob_options.evidence_scope_rules"

export async function buildReviewContextBudget(
  input: ReviewContextBudgetInput
): Promise<ReviewContextBudgetResult> {
  const rawInlineRules = input.reviewInput.bob_options?.evidence_scope_rules
  const parsedInlineRules = parseProjectRules(rawInlineRules)
  const loadedRulePack = await loadProjectRulePack({
    workspaceRoot: input.workspaceRoot,
    rulePackPath: input.reviewInput.bob_options?.evidence_scope_rule_pack_path,
    maxBytes: input.limits.maxDocumentBytes,
    textEncoding: input.textEncoding
  })
  const repositoryIndex = await loadRepositorySymbolIndex({
    workspaceRoot: input.workspaceRoot,
    indexPath: input.reviewInput.analysis_options?.repository_symbol_index_path,
    expectedSourceRevision: input.diff.head,
    maxBytes: input.limits.maxDocumentBytes,
    textEncoding: input.textEncoding
  })
  const mergedRules = mergeProjectRules(loadedRulePack?.rules ?? [], parsedInlineRules.rules)
  const scope = buildReviewEvidenceScope(input.codeAnalysis, input.documents, {
    tokenBudget: Math.max(1, Math.floor(input.limits.maxBobInputBytes / 4)),
    maxDependencyDepth: input.reviewInput.analysis_options?.max_call_depth ?? 1,
    rules: mergedRules.rules,
    documentKeywords: reviewDocumentKeywords(input.reviewInput),
    includeLowPriority: input.reviewInput.bob_options?.evidence_scope_include_low_priority === true,
    repositoryIndex
  })
  const warnings = [
    ...new Set([
      ...parsedInlineRules.warnings,
      ...mergedRules.warnings,
      ...scope.warnings
    ])
  ].sort()
  const artifact = createContextBudgetArtifact(
    { ...scope, warnings },
    {
      base: input.diff.base,
      head: input.diff.head,
      tokenEstimation: TOKEN_ESTIMATION_POLICY,
      ruleSource: loadedRulePack?.sourcePath
        ?? (rawInlineRules === undefined ? "none" : INLINE_RULE_CONFIG_SOURCE),
      ...(loadedRulePack ? { rulePack: loadedRulePack } : {}),
      ...(repositoryIndex ? { symbolIndex: repositoryIndex } : {})
    }
  )

  return { artifact, warnings }
}

function reviewDocumentKeywords(reviewInput: ReviewInput): string[] {
  const values = [
    reviewInput.review.id,
    ...(reviewInput.review.ticket_ids ?? []),
    ...reviewInput.review_focus,
    ...tokenize(reviewInput.review.title),
    ...tokenize(reviewInput.review.purpose)
  ]
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort()
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((term) => term.length >= 2)
}
