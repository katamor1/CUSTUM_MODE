import type { DiffSummary } from "./diffTypes"
import type { TraceabilityCatalog } from "./traceabilityTypes"

export const MAX_TRACEABILITY_CANDIDATE_COUNT = 160

const MAX_DIFF_CHARS = 14000

type TraceabilityPromptCandidate = {
  kind: string
  path: string
  sections?: string[]
  cases?: string[]
  rows?: string[]
  sheets?: string[]
  description?: string
}

type TraceabilityPromptReviewRange = {
  vcs: "git" | "bazaar" | "bzr"
  base: string
  head: string
  vcsRoot?: string
}

export function renderTraceabilityPrompt(input: {
  input: TraceabilityPromptReviewRange
  catalog?: TraceabilityCatalog
  diff?: DiffSummary
  candidates: TraceabilityPromptCandidate[]
  warnings: string[]
}): string {
  const candidatePayload = input.candidates
    .slice(0, MAX_TRACEABILITY_CANDIDATE_COUNT)
    .map((candidate) => ({
      kind: candidate.kind,
      path: candidate.path,
      sections: candidate.sections,
      cases: candidate.cases,
      rows: candidate.rows,
      sheets: candidate.sheets,
      description: candidate.description
    }))

  return [
    "# AI Draft Request: traceability sidecar catalog",
    "",
    "あなたは `.bob-trace/traceability-catalog.json` のAI draft候補だけを作成します。元文書は変更しません。",
    "acceptedは禁止です。`id`、`from`、`to` は書かず、`proposed_id`、`proposed_from`、`proposed_to` だけを使ってください。",
    "",
    "## 絶対ルール",
    "",
    "- 出力は JSON object だけ。Markdown、YAML、説明文、コメントは禁止。",
    "- prefixは REQ / BD / DD / TC / QA / RV のみ。",
    "- ID形式は `<prefix>-<元文書ID>-<領域>-0001`。例: `REQ-RS001-PAY-0001`。",
    "- sequence は proposed_id 末尾4桁と必ず一致させてください。例: `REQ-RS001-PAY-0001` の sequence は 1。文書全体の出現順ではありません。",
    "- item.type は requirement / basic_design / detailed_design / test_spec / qa_item / review_finding のみ。",
    "- prefixとitem.typeの対応: REQ=requirement, BD=basic_design, DD=detailed_design, TC=test_spec, QA=qa_item, RV=review_finding。",
    "- test_spec文書のcasesやTC prefixのitemでも type は必ず `test_spec`。`test_case`、`test`、`testcase` は使わない。",
    "- statusは必ず `proposed`。人間承認前に `accepted`、`rejected`、`deprecated` を作らない。",
    "- itemは `id` を持ってはいけない。linkは `from` / `to` を持ってはいけない。",
    "- link_typeは `satisfies`, `elaborates`, `verified_by`, `clarifies`, `reviewed_by`, `references` のみ。",
    "- link direction は gate validator に合わせる: `satisfies` は REQ -> BD、`elaborates` は BD -> DD、`verified_by` は REQ/DD -> TC。逆向きは禁止。",
    "- テスト仕様が要求と詳細設計の両方を確認する場合は、REQ -> TC と DD -> TC の `verified_by` link を両方出してください。",
    "- `clarifies` は `QA -> REQ/BD/DD/TC/RV`、`reviewed_by` は `REQ/BD/DD/TC/QA -> RV`。",
    "- 不確かな対応は無理にaccepted相当へ補完せず、proposed候補として残す。",
    "",
    "## Required JSON shape",
    "",
    "```json",
    JSON.stringify({
      schema_version: 1,
      documents: [
        { document_id: "RS001", source_path: "docs/requirements.md", id_source: "extracted" }
      ],
      domains: [
        { code: "PAY", label: "決済", status: "proposed" }
      ],
      items: [
        {
          proposed_id: "REQ-RS001-PAY-0001",
          type: "requirement",
          source_document_id: "RS001",
          domain: "PAY",
          sequence: 1,
          source_path: "docs/requirements.md",
          status: "proposed",
          text_summary: "要求の要約"
        },
        {
          proposed_id: "BD-BD001-PAY-0001",
          type: "basic_design",
          source_document_id: "BD001",
          domain: "PAY",
          sequence: 1,
          source_path: "docs/basic-design.md",
          status: "proposed",
          text_summary: "基本設計の要約"
        },
        {
          proposed_id: "DD-DD001-PAY-0001",
          type: "detailed_design",
          source_document_id: "DD001",
          domain: "PAY",
          sequence: 1,
          source_path: "docs/detailed-design.md",
          status: "proposed",
          text_summary: "詳細設計の要約"
        },
        {
          proposed_id: "TC-TC001-PAY-0001",
          type: "test_spec",
          source_document_id: "TC001",
          domain: "PAY",
          sequence: 1,
          source_path: "docs/test-spec.md",
          status: "proposed",
          text_summary: "テスト仕様の要約"
        },
        {
          proposed_id: "QA-QA001-PAY-0001",
          type: "qa_item",
          source_document_id: "QA001",
          domain: "PAY",
          sequence: 1,
          source_path: "docs/qa-table.xlsx",
          status: "proposed",
          qa: { question: "質問", answer: "回答", status: "answered" }
        },
        {
          proposed_id: "RV-RV001-PAY-0001",
          type: "review_finding",
          source_document_id: "RV001",
          domain: "PAY",
          sequence: 1,
          source_path: "docs/review-findings.xlsx",
          status: "proposed",
          review: { severity: "major", action_plan: "対応方針", status: "open" }
        }
      ],
      links: [
        {
          proposed_from: "REQ-RS001-PAY-0001",
          proposed_to: "BD-BD001-PAY-0001",
          link_type: "satisfies",
          status: "proposed"
        },
        {
          proposed_from: "BD-BD001-PAY-0001",
          proposed_to: "DD-DD001-PAY-0001",
          link_type: "elaborates",
          status: "proposed"
        },
        {
          proposed_from: "REQ-RS001-PAY-0001",
          proposed_to: "TC-TC001-PAY-0001",
          link_type: "verified_by",
          status: "proposed"
        },
        {
          proposed_from: "DD-DD001-PAY-0001",
          proposed_to: "TC-TC001-PAY-0001",
          link_type: "verified_by",
          status: "proposed"
        },
        {
          proposed_from: "QA-QA001-PAY-0001",
          proposed_to: "REQ-RS001-PAY-0001",
          link_type: "clarifies",
          status: "proposed"
        },
        {
          proposed_from: "REQ-RS001-PAY-0001",
          proposed_to: "RV-RV001-PAY-0001",
          link_type: "reviewed_by",
          status: "proposed"
        }
      ],
      decisions: []
    }, null, 2),
    "```",
    "",
    "## Review range",
    "",
    `- vcs: ${input.input.vcs}`,
    `- base: ${input.input.base}`,
    `- head: ${input.input.head}`,
    input.input.vcsRoot ? `- vcs_root: ${input.input.vcsRoot}` : undefined,
    "",
    "## Existing sidecar catalog",
    "",
    "```json",
    JSON.stringify(input.catalog ?? null, null, 2),
    "```",
    "",
    "## Document candidates",
    "",
    "```json",
    JSON.stringify(candidatePayload, null, 2),
    "```",
    "",
    "## Diff summary",
    "",
    input.diff ? renderDiffSummary(input.diff) : "diff summary unavailable. Use document candidates and existing catalog only.",
    "",
    "## Warnings",
    "",
    input.warnings.length > 0 ? input.warnings.map((warning) => `- ${warning}`).join("\n") : "- none"
  ].filter((line): line is string => line !== undefined).join("\n")
}

function renderDiffSummary(diff: DiffSummary): string {
  const lines = [
    `- vcs: ${diff.vcs ?? "unknown"}`,
    `- base: ${diff.base}`,
    `- head: ${diff.head}`,
    `- changed_files: ${diff.files.length}`,
    "",
    "| status | path | + | - | lang | flags |",
    "| --- | --- | ---: | ---: | --- | --- |",
    ...diff.files.slice(0, 120).map((file) => {
      const flags = [
        file.is_test ? "test" : "",
        file.is_interface_candidate ? "interface" : ""
      ].filter(Boolean).join(", ")
      return `| ${file.status} | ${file.path} | ${file.additions ?? 0} | ${file.deletions ?? 0} | ${file.language ?? ""} | ${flags} |`
    })
  ]
  if (diff.warnings.length > 0) {
    lines.push("", "warnings:", ...diff.warnings.map((warning) => `- ${warning}`))
  }
  if (diff.unifiedDiff) {
    lines.push("", "```diff", truncate(diff.unifiedDiff, MAX_DIFF_CHARS), "```")
  }
  return lines.join("\n")
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}\n... truncated ${value.length - maxChars} char(s) ...`
}
