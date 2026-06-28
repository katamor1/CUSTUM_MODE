import type { CodeAnalysisResult, DiffSummary, DocumentExtractionResult, ReviewInput, TraceabilityResult } from "../core/result.js";

export async function buildTraceability(input: {
  reviewInput: ReviewInput;
  documents: DocumentExtractionResult;
  codeAnalysis: CodeAnalysisResult;
  diff: DiffSummary;
}): Promise<TraceabilityResult> {
  const warnings: string[] = [];

  const requirementRefs = input.documents.evidence.filter((e) => e.type === "requirements");
  const testRefs = input.documents.evidence.filter((e) => e.type === "test_spec");
  const codeRefs = input.codeAnalysis.changedSymbols;

  const rows: string[] = [
    "| requirement | design | code | test | link_type | confidence |",
    "|---|---|---|---|---|---|",
  ];

  rows.push(
    `| ${requirementRefs[0]?.ref ?? "unknown"} | unknown | ${codeRefs[0]?.name ?? "unknown"} | ${testRefs[0]?.ref ?? "unknown"} | scaffold-candidate | low |`,
  );

  if (requirementRefs.length === 0) {
    warnings.push("No requirement evidence found for traceability map.");
  }

  return {
    markdown: rows.join("\n"),
    warnings,
  };
}
