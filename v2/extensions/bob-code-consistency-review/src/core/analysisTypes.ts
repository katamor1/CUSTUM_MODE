import type { EvidenceRef } from "./documentTypes"

export type CodeAnalysisResult = {
  changedSymbols: Array<{
    id: string
    name: string
    kind: "function" | "type" | "define" | "global" | "unknown"
    file: string
    confidence: "high" | "medium" | "low"
    change_type?: string
    line_after?: string
    evidence_id?: string
  }>
  functions: Array<{
    id: string
    name: string
    file: string
    line_after: string
    evidence_id: string
    callees: string[]
    callers: string[]
  }>
  defines: string[]
  globals: string[]
  callGraph: Array<{ from: string; to: string; confidence: "high" | "medium" | "low"; reason: string }>
  rtForbiddenCandidates: Array<{ symbol: string; file: string; line?: number; reason: string }>
  codeSlices: Array<{ evidence_id: string; file: string; ref: string; functionName?: string; markdown: string; text: string }>
  evidence: EvidenceRef[]
  summaryMarkdown: string
  warnings: string[]
}
