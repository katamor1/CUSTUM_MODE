import type { CodeAnalysisResult, DiffSummary, ReviewInput } from "../core/result.js";

export async function analyzeCppChanges(diff: DiffSummary, _reviewInput: ReviewInput): Promise<CodeAnalysisResult> {
  const warnings: string[] = [];
  const changedSymbols: CodeAnalysisResult["changedSymbols"] = [];

  let index = 1;
  for (const file of diff.files) {
    if (file.language !== "c" && file.language !== "cpp") {
      continue;
    }

    changedSymbols.push({
      id: `FUNC-${String(index++).padStart(4, "0")}`,
      name: "TODO_detect_changed_function",
      kind: "function",
      file: file.path,
      confidence: "low",
    });
  }

  if (changedSymbols.length === 0) {
    warnings.push("No C/C++ changed symbols detected. MVP scaffold only detects candidate files.");
  }

  const summaryMarkdown = [
    "## C/C++ 変更解析サマリ",
    "",
    `- changed C/C++ candidate files: ${changedSymbols.length}`,
    "- function detection: TODO",
    "- define / enum / struct detection: TODO",
    "- RT forbidden API detection: TODO",
    "",
  ].join("\n");

  return { changedSymbols, summaryMarkdown, warnings };
}
