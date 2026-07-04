import { toPosixPath } from "../core/fileSystem"
import type { CodeAnalysisResult } from "../core/analysisTypes"
import type { ReviewInput } from "../core/reviewTypes"
import type { DiffLine } from "./cCppDiffParser"
import type { FunctionRange } from "./cCppSymbolDetector"

export function renderCodeSlice(evidenceId: string, filePath: string, range: FunctionRange, diffLines: DiffLine[]): string {
  const changed = diffLines.filter((line) => line.line >= range.start && line.line <= range.end)
  return [
    `## ${evidenceId} ${toPosixPath(filePath)}`,
    "",
    `- function: ${range.name}`,
    `- lines: ${range.start}-${range.end}`,
    "",
    "### Function body",
    "",
    "```c",
    ...range.body,
    "```",
    "",
    "### Changed lines",
    "",
    "```diff",
    ...changed.map((line) => `${line.kind === "add" ? "+" : "-"}${line.text}`),
    "```",
    ""
  ].join("\n")
}

export function renderSummary(
  symbols: CodeAnalysisResult["changedSymbols"],
  defines: Set<string>,
  globals: Set<string>,
  callGraph: CodeAnalysisResult["callGraph"],
  rtForbiddenCandidates: CodeAnalysisResult["rtForbiddenCandidates"],
  reviewInput: ReviewInput
): string {
  return [
    "## C/C++ 変更解析サマリ",
    "",
    `- review_focus: ${reviewInput.review_focus.join(", ")}`,
    `- changed functions: ${symbols.filter((symbol) => symbol.kind === "function").length}`,
    `- define candidates: ${defines.size}`,
    `- global candidates: ${globals.size}`,
    `- direct call candidates: ${callGraph.length}`,
    `- RT forbidden candidates: ${rtForbiddenCandidates.length}`,
    "",
    "### 変更シンボル",
    "",
    ...symbols.map((symbol) => `- ${symbol.id}: ${symbol.name} (${symbol.kind}) ${symbol.file}${symbol.line_after ? `:${symbol.line_after}` : ""}`),
    "",
    "### 注意が必要な候補",
    "",
    ...rtForbiddenCandidates.map((candidate) => `- ${candidate.symbol}: ${candidate.file}${candidate.line ? `:${candidate.line}` : ""} ${candidate.reason}`)
  ].join("\n")
}
