import { join } from "node:path";
import { writeJsonFile, writeTextFile } from "./file-system.js";
import type { CodeAnalysisResult, DiffSummary, DocumentExtractionResult, ReviewInput, TraceabilityResult } from "./result.js";
import { applyTemplate, loadPromptTemplates } from "../templates/template-loader.js";

export async function buildReviewPackage(input: {
  outDir: string;
  reviewInput: ReviewInput;
  diff: DiffSummary;
  documents: DocumentExtractionResult;
  codeAnalysis: CodeAnalysisResult;
  traceability: TraceabilityResult;
}): Promise<void> {
  const { outDir, reviewInput, diff, documents, codeAnalysis, traceability } = input;

  await writeJsonFile(join(outDir, "input-normalized.json"), reviewInput);
  await writeJsonFile(join(outDir, "changed-files.json"), { files: diff.files, warnings: diff.warnings });
  await writeJsonFile(join(outDir, "changed-symbols.json"), { symbols: codeAnalysis.changedSymbols, warnings: codeAnalysis.warnings });
  await writeJsonFile(join(outDir, "document-index.json"), { documents: documents.documents, warnings: documents.warnings });
  await writeJsonFile(join(outDir, "evidence-index.json"), { evidence: documents.evidence });

  await writeTextFile(join(outDir, "manifest.yaml"), buildManifest(reviewInput, diff));
  await writeTextFile(join(outDir, "change-summary.md"), buildChangeSummary(reviewInput, diff));
  await writeTextFile(join(outDir, "diff-context.md"), diff.unifiedDiff ?? "");
  await writeTextFile(join(outDir, "document-excerpts.md"), documents.excerptsMarkdown);
  await writeTextFile(join(outDir, "traceability-map.md"), traceability.markdown);
  await writeTextFile(join(outDir, "deterministic-checks.md"), "# 決定論的チェック結果\n\nMVP scaffold: not executed yet.\n");

  const templates = await loadPromptTemplates();
  const bobInput = applyTemplate(templates.bobInputTemplate, {
    "prompt.system": templates.system,
    "prompt.task": templates.task,
    "prompt.output_format": templates.outputFormat,
    "review.summary": `- review_id: ${reviewInput.review.id}\n- title: ${reviewInput.review.title}`,
    change_summary: buildChangeSummary(reviewInput, diff),
    deterministic_checks: "MVP scaffold: not executed yet.",
    document_excerpts: documents.excerptsMarkdown,
    diff_context: diff.unifiedDiff ?? "",
    changed_symbols_summary: codeAnalysis.summaryMarkdown,
    traceability_map: traceability.markdown,
    evidence_index_summary: documents.evidence.map((e) => `- ${e.evidence_id}: ${e.type} ${e.ref}`).join("\n"),
  });

  await writeTextFile(join(outDir, "bob-input.md"), bobInput);
}

function buildManifest(reviewInput: ReviewInput, diff: DiffSummary): string {
  return [
    "package_version: 1",
    `created_by: bob-review-scaffold`,
    "repository:",
    `  base: ${diff.base}`,
    `  head: ${diff.head}`,
    "review:",
    `  id: ${reviewInput.review.id}`,
    `  title: ${JSON.stringify(reviewInput.review.title)}`,
    `  change_type: ${reviewInput.review.change_type}`,
    "prompts:",
    "  template_id: consistency-review-v1",
    "",
  ].join("\n");
}

function buildChangeSummary(reviewInput: ReviewInput, diff: DiffSummary): string {
  return [
    "# 変更サマリ",
    "",
    `- review_id: ${reviewInput.review.id}`,
    `- title: ${reviewInput.review.title}`,
    `- purpose: ${reviewInput.review.purpose}`,
    `- target: ${reviewInput.review.base}..${reviewInput.review.head}`,
    `- changed_files: ${diff.files.length}`,
    "",
    "## 変更ファイル",
    "",
    ...diff.files.map((file) => `- ${file.status}: ${file.path} (+${file.additions ?? 0}/-${file.deletions ?? 0})`),
    "",
  ].join("\n");
}
