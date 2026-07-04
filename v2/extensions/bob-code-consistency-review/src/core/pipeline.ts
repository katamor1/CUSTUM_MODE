import { analyzeCppChanges } from "../analyzers/cCppChangeAnalyzer"
import { extractDocuments } from "../analyzers/documentExtractor"
import { buildTraceability } from "../analyzers/traceabilityBuilder"
import { collectGitDiff } from "./gitDiffCollector"
import { resolveWorkspacePathStrict } from "./fileSystem"
import { normalizeReviewProcessingLimits, type ReviewProcessingLimits } from "./limits"
import { buildReviewPackage } from "./reviewPackageBuilder"
import { validateReviewInput } from "./reviewInputValidator"
import type { PreprocessResult } from "./preprocessTypes"

export async function preprocessReview(input: { workspaceRoot: string; inputPath: string; outDir: string; diffFixturePath?: string; bzrPath?: string; textEncoding?: string; limits?: Partial<ReviewProcessingLimits> }): Promise<PreprocessResult> {
  const textEncoding = input.textEncoding ?? "auto"
  const limits = normalizeReviewProcessingLimits(input.limits)
  const inputPath = resolveWorkspacePathStrict(input.workspaceRoot, input.inputPath, "reviewInputPath")
  const outDir = resolveWorkspacePathStrict(input.workspaceRoot, input.outDir, "reviewPackagePath")
  const diffFixturePath = input.diffFixturePath ? resolveWorkspacePathStrict(input.workspaceRoot, input.diffFixturePath, "diffFixturePath") : undefined
  const reviewInput = await validateReviewInput(inputPath, input.workspaceRoot, textEncoding)
  const diff = await collectGitDiff(reviewInput, { workspaceRoot: input.workspaceRoot, diffFixturePath, bzrPath: input.bzrPath, textEncoding, limits })
  const documents = await extractDocuments(reviewInput, { workspaceRoot: input.workspaceRoot, textEncoding, limits })
  const codeAnalysis = await analyzeCppChanges(diff, reviewInput, { workspaceRoot: input.workspaceRoot, textEncoding })
  const traceability = await buildTraceability({ reviewInput, documents, codeAnalysis, diff })

  const packageWarnings = await buildReviewPackage({
    workspaceRoot: input.workspaceRoot,
    outDir,
    reviewInput,
    diff,
    documents,
    codeAnalysis,
    traceability,
    limits
  })

  const warnings = [...diff.warnings, ...documents.warnings, ...codeAnalysis.warnings, ...traceability.warnings, ...packageWarnings]
  return {
    status: "ok",
    reviewId: reviewInput.review.id,
    packageDir: outDir,
    changedFiles: diff.files.length,
    documentEvidence: documents.evidence.length,
    codeEvidence: codeAnalysis.evidence.length,
    warnings,
    summary: `Generated review package for ${reviewInput.review.id}: ${diff.files.length} file(s), ${documents.evidence.length} document evidence item(s), ${codeAnalysis.evidence.length} code evidence item(s). Generated artifacts may contain sensitive design, customer, source, or raw diff context; ensure .bob-review/ and .bob-trace/ai-traceability-draft/ are ignored unless intentionally versioned.`
  }
}
