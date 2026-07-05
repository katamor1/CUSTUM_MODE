import { analyzeCppChanges } from "./cCppChangeAnalyzer"
import { analyzeGenericCodeEvidence } from "./genericCodeEvidenceAnalyzer"
import { isCLikeLanguage } from "../core/languageClassifier"
import { toPosixPath } from "../core/fileSystem"
import type { CodeAnalysisResult } from "../core/analysisTypes"
import type { DiffSummary } from "../core/diffTypes"
import type { ReviewInput } from "../core/reviewTypes"

type AnalyzeCodeChangesOptions = { workspaceRoot: string; textEncoding?: string }

export async function analyzeCodeChanges(
  diff: DiffSummary,
  reviewInput: ReviewInput,
  options: AnalyzeCodeChangesOptions
): Promise<CodeAnalysisResult> {
  const filteredDiff = filterDiffByRequestedLanguages(diff, reviewInput)
  const cLikeDiff = { ...filteredDiff, files: filteredDiff.files.filter((file) => isCLikeLanguage(file.language)) }
  const cLikeAnalysis = await analyzeCppChanges(cLikeDiff, reviewInput, options)
  const filesWithDetailedEvidence = new Set(cLikeAnalysis.evidence.map((item) => toPosixPath(item.source ?? "")))
  const genericDiff = {
    ...filteredDiff,
    files: filteredDiff.files.filter((file) => !filesWithDetailedEvidence.has(toPosixPath(file.path)))
  }
  const genericAnalysis = analyzeGenericCodeEvidence(genericDiff, reviewInput, {
    startEvidenceIndex: cLikeAnalysis.evidence.length + 1,
    startSymbolIndex: cLikeAnalysis.changedSymbols.length + 1
  })

  return {
    changedSymbols: [...cLikeAnalysis.changedSymbols, ...genericAnalysis.changedSymbols],
    functions: cLikeAnalysis.functions,
    defines: cLikeAnalysis.defines,
    globals: cLikeAnalysis.globals,
    callGraph: cLikeAnalysis.callGraph,
    rtForbiddenCandidates: cLikeAnalysis.rtForbiddenCandidates,
    codeSlices: [...cLikeAnalysis.codeSlices, ...genericAnalysis.codeSlices],
    evidence: [...cLikeAnalysis.evidence, ...genericAnalysis.evidence],
    summaryMarkdown: [cLikeAnalysis.summaryMarkdown, genericAnalysis.summaryMarkdown].filter(Boolean).join("\n\n"),
    warnings: [...cLikeAnalysis.warnings, ...genericAnalysis.warnings]
  }
}

function filterDiffByRequestedLanguages(diff: DiffSummary, reviewInput: ReviewInput): DiffSummary {
  const requested = new Set((reviewInput.analysis_options?.language ?? []).filter(Boolean))
  if (requested.size === 0) return diff
  return {
    ...diff,
    files: diff.files.filter((file) => requested.has(file.language ?? "unknown"))
  }
}
