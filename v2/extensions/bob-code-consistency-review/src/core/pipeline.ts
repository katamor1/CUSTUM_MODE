import { analyzeCppChanges } from "../analyzers/cCppChangeAnalyzer"
import { extractDocuments } from "../analyzers/documentExtractor"
import { buildTraceability } from "../analyzers/traceabilityBuilder"
import { collectGitDiff } from "./gitDiffCollector"
import { buildReviewPackage } from "./reviewPackageBuilder"
import { validateReviewInput } from "./reviewInputValidator"
import type { PreprocessResult } from "./types"

export async function preprocessReview(input: { workspaceRoot: string; inputPath: string; outDir: string; diffFixturePath?: string }): Promise<PreprocessResult> {
  const reviewInput = await validateReviewInput(input.inputPath, input.workspaceRoot)
  const diff = await collectGitDiff(reviewInput, { workspaceRoot: input.workspaceRoot, diffFixturePath: input.diffFixturePath })
  const documents = await extractDocuments(reviewInput, { workspaceRoot: input.workspaceRoot })
  const codeAnalysis = await analyzeCppChanges(diff, reviewInput, { workspaceRoot: input.workspaceRoot })
  const traceability = await buildTraceability({ reviewInput, documents, codeAnalysis, diff })

  await buildReviewPackage({
    workspaceRoot: input.workspaceRoot,
    outDir: input.outDir,
    reviewInput,
    diff,
    documents,
    codeAnalysis,
    traceability
  })

  const warnings = [...diff.warnings, ...documents.warnings, ...codeAnalysis.warnings, ...traceability.warnings]
  return {
    status: "ok",
    reviewId: reviewInput.review.id,
    packageDir: input.outDir,
    changedFiles: diff.files.length,
    documentEvidence: documents.evidence.length,
    codeEvidence: codeAnalysis.evidence.length,
    warnings,
    summary: `Generated review package for ${reviewInput.review.id}: ${diff.files.length} file(s), ${documents.evidence.length} document evidence item(s), ${codeAnalysis.evidence.length} code evidence item(s).`
  }
}
