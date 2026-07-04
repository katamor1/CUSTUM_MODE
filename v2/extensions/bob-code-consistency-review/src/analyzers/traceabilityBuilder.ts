import type { CodeAnalysisResult } from "../core/analysisTypes"
import type { DiffSummary } from "../core/diffTypes"
import type { DocumentExtractionResult } from "../core/documentTypes"
import type { ReviewInput } from "../core/reviewTypes"
import type { TraceabilityResult } from "../core/traceabilityResultTypes"

export async function buildTraceability(input: {
  reviewInput: ReviewInput
  documents: DocumentExtractionResult
  codeAnalysis: CodeAnalysisResult
  diff: DiffSummary
}): Promise<TraceabilityResult> {
  const rows: Array<Record<string, string>> = []
  const warnings: string[] = []
  const documentEvidence = input.documents.evidence
  const codeEvidence = input.codeAnalysis.evidence

  for (const code of codeEvidence) {
    const codeTokens = tokenSet(`${code.ref} ${code.text ?? ""}`)
    const matches = documentEvidence
      .map((document) => ({ document, score: overlapScore(codeTokens, tokenSet(`${document.ref} ${document.text ?? ""}`)) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 8)

    for (const match of matches) {
      const row: Record<string, string> = {
        requirement: match.document.type === "requirement" ? match.document.ref : "",
        basic_design: match.document.type === "basic_design" ? match.document.ref : "",
        detailed_design: match.document.type === "detailed_design" ? match.document.ref : "",
        test: match.document.type === "test_spec" ? match.document.ref : "",
        ledger: match.document.type === "ledger" ? match.document.ref : "",
        code: code.evidence_id,
        link_type: match.score >= 2 ? "keyword" : "candidate",
        confidence: match.score >= 2 ? "medium" : "low",
        reason: `${match.document.evidence_id} shares ${match.score} token(s) with ${code.evidence_id}`
      }
      rows.push(row)
    }
  }

  if (rows.length === 0 && documentEvidence.length > 0 && codeEvidence.length > 0) {
    warnings.push("No traceability candidate could be inferred from IDs or keywords.")
    rows.push({
      requirement: documentEvidence.find((item) => item.type === "requirement")?.ref ?? "",
      basic_design: documentEvidence.find((item) => item.type === "basic_design")?.ref ?? "",
      detailed_design: documentEvidence.find((item) => item.type === "detailed_design")?.ref ?? "",
      test: documentEvidence.find((item) => item.type === "test_spec")?.ref ?? "",
      ledger: documentEvidence.find((item) => item.type === "ledger")?.ref ?? "",
      code: codeEvidence[0].evidence_id,
      link_type: "candidate",
      confidence: "low",
      reason: "fallback candidate because both document and code evidence exist"
    })
  }

  return { rows, warnings, markdown: renderTraceability(rows) }
}

function renderTraceability(rows: Array<Record<string, string>>): string {
  const headers = ["requirement", "basic_design", "detailed_design", "test", "ledger", "code", "link_type", "confidence", "reason"]
  return [
    "| " + headers.join(" | ") + " |",
    "| " + headers.map(() => "---").join(" | ") + " |",
    ...rows.map((row) => "| " + headers.map((header) => (row[header] ?? "").replace(/\|/g, "\\|")).join(" | ") + " |"),
    ""
  ].join("\n")
}

function tokenSet(text: string): Set<string> {
  const result = new Set<string>()
  for (const match of text.matchAll(/\b(?:ERR_[A-Z0-9_]+|REQ-\w+|BD-\w+|DD-\w+|TC-\w+|[A-Za-z][A-Za-z0-9]{3,})\b/g)) {
    result.add(match[0].toLowerCase())
  }
  return result
}

function overlapScore(left: Set<string>, right: Set<string>): number {
  let score = 0
  for (const value of left) if (right.has(value)) score += 1
  return score
}
