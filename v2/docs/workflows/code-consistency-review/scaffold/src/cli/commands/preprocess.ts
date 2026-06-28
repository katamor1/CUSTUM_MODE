import { readOption, requireOption } from "../args.js";
import { validateReviewInput } from "../../core/review-input-validator.js";
import { collectGitDiff } from "../../core/git-diff-collector.js";
import { extractDocuments } from "../../analyzers/document-extractor.js";
import { analyzeCppChanges } from "../../analyzers/c-cpp-change-analyzer.js";
import { buildTraceability } from "../../analyzers/traceability-builder.js";
import { buildReviewPackage } from "../../core/review-package-builder.js";

export async function runPreprocess(args: string[]): Promise<void> {
  const inputPath = requireOption(args, "--input");
  const outDir = requireOption(args, "--out");
  const diffFixturePath = readOption(args, "--diff-fixture");

  const reviewInput = await validateReviewInput(inputPath);
  const diff = await collectGitDiff(reviewInput, { diffFixturePath });
  const documents = await extractDocuments(reviewInput);
  const codeAnalysis = await analyzeCppChanges(diff, reviewInput);
  const traceability = await buildTraceability({ reviewInput, documents, codeAnalysis, diff });

  await buildReviewPackage({
    outDir,
    reviewInput,
    diff,
    documents,
    codeAnalysis,
    traceability,
  });

  console.log(`[bob-review] review-package generated: ${outDir}`);
}
