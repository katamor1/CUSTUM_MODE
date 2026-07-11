import { classifyLanguageFromPath, isCLikeLanguage } from "../core/languageClassifier"
import type { CodeAnalysisResult } from "../core/analysisTypes"
import type { DiffSummary } from "../core/diffTypes"
import type { EvidenceRef } from "../core/documentTypes"
import type { ReviewInput } from "../core/reviewTypes"
import { toPosixPath } from "../core/fileSystem"
import { normalizeReviewProcessingLimits, type ReviewProcessingLimits } from "../core/limits"
import {
  createCodeEvidenceBudget,
  reserveCodeEvidence,
  type CodeEvidenceBudget
} from "./codeEvidenceBudget"
import { diffLinesForFile, parseUnifiedDiff } from "./cCppDiffParser"

type GenericCodeEvidenceOptions = {
  startEvidenceIndex?: number
  startSymbolIndex?: number
  skipFiles?: Set<string>
  limits?: Partial<ReviewProcessingLimits>
  budget?: CodeEvidenceBudget
}

type GenericEvidence = Pick<CodeAnalysisResult, "changedSymbols" | "codeSlices" | "evidence" | "summaryMarkdown" | "warnings">

export function analyzeGenericCodeEvidence(
  diff: DiffSummary,
  _reviewInput: ReviewInput,
  options: GenericCodeEvidenceOptions = {}
): GenericEvidence {
  const changedSymbols: CodeAnalysisResult["changedSymbols"] = []
  const codeSlices: CodeAnalysisResult["codeSlices"] = []
  const evidence: EvidenceRef[] = []
  const warnings: string[] = []
  const diffLines = parseUnifiedDiff(diff)
  const limits = normalizeReviewProcessingLimits(options.limits)
  const budget = options.budget ?? createCodeEvidenceBudget(limits)
  let evidenceIndex = options.startEvidenceIndex ?? 1
  let symbolIndex = options.startSymbolIndex ?? 1
  const skipFiles = new Set(Array.from(options.skipFiles ?? []).map(toPosixPath))

  for (const file of diff.files) {
    if (budget.exhausted) break
    const filePath = toPosixPath(file.path)
    if (skipFiles.has(filePath)) continue

    const fileDiffLines = diffLinesForFile(diffLines, file.path)
    if (fileDiffLines.length === 0) {
      warnings.push(`generic code evidence skipped ${filePath}: no changed diff lines found.`)
      continue
    }

    const evidenceId = `SRC-${String(evidenceIndex).padStart(4, "0")}`
    const symbolId = `CODE-${String(symbolIndex).padStart(4, "0")}`
    const language = file.language ?? "unknown"
    const changedLineNumbers = fileDiffLines.map((line) => line.line)
    const lineRef = lineRange(changedLineNumbers)
    const ref = `${filePath}:${lineRef}`
    const rawText = fileDiffLines.map((line) => `${line.kind === "add" ? "+" : "-"}${line.text}`).join("\n")
    const reservation = reserveCodeEvidence({
      label: filePath,
      text: rawText,
      render: (text) => renderGenericCodeSlice(evidenceId, filePath, language, file.status, lineRef, text)
    }, budget, warnings)
    if (!reservation) break
    evidenceIndex += 1
    symbolIndex += 1

    codeSlices.push({
      evidence_id: evidenceId,
      file: filePath,
      ref,
      markdown: reservation.markdown,
      text: reservation.text
    })
    evidence.push({
      evidence_id: evidenceId,
      type: "code",
      ref,
      source: filePath,
      location: `${language}:${lineRef}`,
      text: reservation.text
    })
    changedSymbols.push({
      id: symbolId,
      name: filePath,
      kind: "unknown",
      file: filePath,
      confidence: isCLikeLanguage(language) ? "low" : "medium",
      change_type: file.status,
      line_after: lineRef,
      evidence_id: evidenceId
    })
  }

  return {
    changedSymbols,
    codeSlices,
    evidence,
    summaryMarkdown: renderGenericSummary(changedSymbols),
    warnings
  }
}

function renderGenericCodeSlice(evidenceId: string, filePath: string, language: string, status: string, lineRef: string, text: string): string {
  return [
    `## ${evidenceId} ${filePath}`,
    "",
    `- language: ${language}`,
    `- change_type: ${status}`,
    `- changed_lines: ${lineRef}`,
    "",
    "### Changed lines",
    "",
    "```diff",
    text,
    "```",
    ""
  ].join("\n")
}

function renderGenericSummary(symbols: CodeAnalysisResult["changedSymbols"]): string {
  const languages = new Map<string, number>()
  for (const symbol of symbols) {
    const language = classifyLanguageFromPath(symbol.file)
    languages.set(language, (languages.get(language) ?? 0) + 1)
  }
  return [
    "## 汎用コード変更根拠",
    "",
    `- generic code evidence: ${symbols.length}`,
    ...Array.from(languages.entries()).map(([language, count]) => `- ${language}: ${count}`),
    "",
    "### 変更ファイル",
    "",
    ...symbols.map((symbol) => `- ${symbol.id}: ${symbol.file}${symbol.line_after ? `:${symbol.line_after}` : ""}`)
  ].join("\n")
}

function lineRange(values: number[]): string {
  if (values.length === 0) return "unknown"
  const sorted = [...new Set(values)].sort((left, right) => left - right)
  if (sorted.length === 1) return String(sorted[0])
  return `${sorted[0]}-${sorted[sorted.length - 1]}`
}
