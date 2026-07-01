import * as path from "node:path"
import { collectGitDiff } from "./gitDiffCollector"
import { discoverReviewInputCandidates } from "./reviewInputDiscovery"
import { writeTextFile } from "./fileSystem"
import {
  readTraceabilityCatalog,
  writeTraceabilityCatalog,
  type WriteTraceabilityCatalogResult
} from "./traceabilityCatalogStore"
import type { DiffSummary, ReviewInput } from "./types"
import type {
  TraceabilityCatalog,
  TraceabilityDecision,
  TraceabilityDomain,
  TraceabilityItem,
  TraceabilityLink,
  TraceabilityStatus
} from "./traceabilityCatalog"

export type PrepareAiTraceabilityDraftPromptInput = {
  workspaceRoot: string
  outputDir: string
  catalogPath?: string
  docsRoot?: string
  base: string
  head: string
  vcs: "git" | "bazaar" | "bzr"
  vcsRoot?: string
  bzrPath?: string
  diffFixturePath?: string
  textEncoding?: string
}

export type PrepareAiTraceabilityDraftPromptResult = {
  status: "ok"
  promptPath: string
  prompt: string
  warnings: string[]
}

export type ApplyAiTraceabilityDraftInput = {
  workspaceRoot: string
  catalogPath?: string
  text: string
  textEncoding?: string
}

export type ApplyAiTraceabilityDraftResult =
  | { status: "ok"; catalogPath: string; backupPath?: string; catalog: TraceabilityCatalog; warnings: string[] }
  | { status: "error"; errors: string[]; warnings: string[] }

export type MergeAiTraceabilityDraftResult = { status: "ok"; catalog: TraceabilityCatalog; warnings: string[] }

const PROMPT_FILE_NAME = "ai-draft-prompt.md"
const MAX_DIFF_CHARS = 14000
const MAX_CANDIDATE_COUNT = 160

export async function prepareAiTraceabilityDraftPrompt(input: PrepareAiTraceabilityDraftPromptInput): Promise<PrepareAiTraceabilityDraftPromptResult> {
  const warnings: string[] = []
  const discovery = await discoverReviewInputCandidates(input.workspaceRoot, {
    docsRoot: input.docsRoot,
    textEncoding: input.textEncoding,
    maxFiles: MAX_CANDIDATE_COUNT
  })
  warnings.push(...discovery.warnings)

  const read = await readTraceabilityCatalog({ workspaceRoot: input.workspaceRoot, catalogPath: input.catalogPath, textEncoding: input.textEncoding })
  const catalog = read.status === "ok" ? read.catalog : undefined
  if (read.status === "error") warnings.push(...read.errors)

  let diff: DiffSummary | undefined
  try {
    diff = await collectGitDiff(minimalTraceabilityReviewInput(input), {
      workspaceRoot: input.workspaceRoot,
      diffFixturePath: input.diffFixturePath,
      bzrPath: input.bzrPath,
      textEncoding: input.textEncoding
    })
  } catch (error) {
    warnings.push(`diff summary unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }

  const prompt = renderTraceabilityPrompt({ input, catalog, diff, candidates: discovery.documents, warnings })
  const promptPath = path.join(input.outputDir, PROMPT_FILE_NAME)
  await writeTextFile(promptPath, prompt)
  return { status: "ok", promptPath, prompt, warnings }
}

export async function applyAiTraceabilityDraft(input: ApplyAiTraceabilityDraftInput): Promise<ApplyAiTraceabilityDraftResult> {
  const warnings: string[] = []
  let draft: TraceabilityCatalog
  try {
    draft = parseAiTraceabilityDraft(input.text)
  } catch (error) {
    return { status: "error", errors: [`AI traceability draft JSON parse failed: ${error instanceof Error ? error.message : String(error)}`], warnings }
  }

  const read = await readTraceabilityCatalog({ workspaceRoot: input.workspaceRoot, catalogPath: input.catalogPath, textEncoding: input.textEncoding })
  if (read.status === "error") return { status: "error", errors: read.errors, warnings }

  const merged = mergeAiTraceabilityDraft(read.catalog, draft)
  const write = await writeTraceabilityCatalog({
    workspaceRoot: input.workspaceRoot,
    catalogPath: input.catalogPath,
    catalog: merged.catalog,
    backupExisting: !read.created
  })
  if (write.status === "error") return { status: "error", errors: write.errors, warnings: [...warnings, ...merged.warnings] }
  return okApplyResult(write, merged.catalog, [...warnings, ...merged.warnings])
}

export function parseAiTraceabilityDraft(text: string): TraceabilityCatalog {
  const parsed = JSON.parse(extractJsonText(text)) as unknown
  if (!isRecord(parsed)) throw new Error("top-level value must be an object")
  if (parsed.schema_version !== 1) throw new Error("schema_version must be 1")

  const rawCatalog: TraceabilityCatalog = {
    schema_version: 1,
    documents: arrayValue(parsed.documents, "documents") as TraceabilityCatalog["documents"],
    domains: arrayValue(parsed.domains, "domains") as TraceabilityCatalog["domains"],
    items: arrayValue(parsed.items, "items") as TraceabilityCatalog["items"],
    links: arrayValue(parsed.links ?? [], "links") as TraceabilityCatalog["links"],
    decisions: arrayValue(parsed.decisions ?? [], "decisions") as TraceabilityCatalog["decisions"]
  }

  const violations = aiAcceptedStateViolations(rawCatalog)
  if (violations.length > 0) throw new Error(`AI draft must not create accepted state: ${violations.join("; ")}`)
  return {
    schema_version: 1,
    documents: rawCatalog.documents,
    domains: rawCatalog.domains.map((domain) => normalizeDomain(domain)),
    items: rawCatalog.items.map((item) => normalizeItem(item)),
    links: (rawCatalog.links ?? []).map((link) => normalizeLink(link)),
    decisions: (rawCatalog.decisions ?? []).map((decision) => normalizeDecision(decision))
  }
}

export function mergeAiTraceabilityDraft(existing: TraceabilityCatalog, draft: TraceabilityCatalog): MergeAiTraceabilityDraftResult {
  const warnings: string[] = []
  const catalog: TraceabilityCatalog = {
    schema_version: 1,
    documents: mergeByKey(existing.documents ?? [], draft.documents ?? [], (item) => item.document_id, () => false),
    domains: mergeByKey(existing.domains ?? [], draft.domains ?? [], (item) => item.code, isHumanReviewed),
    items: mergeByKey(existing.items ?? [], draft.items ?? [], itemKey, isHumanReviewed),
    links: mergeByKey(existing.links ?? [], draft.links ?? [], linkKey, isHumanReviewed),
    decisions: mergeByKey(existing.decisions ?? [], draft.decisions ?? [], decisionKey, isHumanReviewed)
  }

  return { status: "ok", catalog, warnings }
}

function okApplyResult(write: WriteTraceabilityCatalogResult & { status: "ok" }, catalog: TraceabilityCatalog, warnings: string[]): ApplyAiTraceabilityDraftResult {
  return {
    status: "ok",
    catalogPath: write.catalogPath,
    backupPath: write.backupPath,
    catalog,
    warnings
  }
}

function normalizeDomain(domain: TraceabilityDomain): TraceabilityDomain {
  return { ...domain, status: "proposed" }
}

function normalizeItem(item: TraceabilityItem): TraceabilityItem {
  return { ...item, id: undefined, status: "proposed" }
}

function normalizeLink(link: TraceabilityLink): TraceabilityLink {
  return { ...link, from: undefined, to: undefined, status: "proposed" }
}

function normalizeDecision(decision: TraceabilityDecision): TraceabilityDecision {
  return { ...decision, status: "proposed" }
}

function aiAcceptedStateViolations(catalog: TraceabilityCatalog): string[] {
  const violations: string[] = []
  for (const domain of catalog.domains) {
    if (domain.status !== "proposed") violations.push(`domain ${domain.code} has status ${domain.status}`)
  }
  for (const item of catalog.items) {
    if (item.id) violations.push(`item ${item.id} sets id`)
    if (item.status !== "proposed") violations.push(`item ${item.proposed_id ?? item.id ?? "(unknown)"} has status ${item.status}`)
  }
  for (const link of catalog.links ?? []) {
    if (link.from || link.to) violations.push(`link ${link.from ?? link.proposed_from ?? "(unknown)"} sets accepted endpoint`)
    if (link.status !== "proposed") violations.push(`link ${link.proposed_from ?? link.from ?? "(unknown)"} has status ${link.status}`)
  }
  for (const decision of catalog.decisions ?? []) {
    if (decision.status !== "proposed") violations.push(`decision ${decision.subject} has status ${decision.status}`)
  }
  return violations
}

function mergeByKey<T>(
  existingItems: T[],
  draftItems: T[],
  keyOf: (value: T) => string,
  preserveExisting: (value: T) => boolean
): T[] {
  const result = [...existingItems]
  for (const candidate of draftItems) {
    const key = keyOf(candidate)
    const index = result.findIndex((item) => keyOf(item) === key)
    if (index < 0) {
      result.push(candidate)
      continue
    }
    if (!preserveExisting(result[index])) result[index] = candidate
  }
  return result
}

function itemKey(item: TraceabilityItem): string {
  return item.proposed_id ?? item.id ?? `${item.type}:${item.source_document_id}:${item.domain}:${item.sequence}`
}

function linkKey(link: TraceabilityLink): string {
  return `${link.link_type}:${link.proposed_from ?? link.from ?? ""}:${link.proposed_to ?? link.to ?? ""}`
}

function decisionKey(decision: TraceabilityDecision): string {
  return `${decision.subject}:${decision.gate}:${decision.decision}`
}

function isHumanReviewed(value: { status?: TraceabilityStatus }): boolean {
  return value.status === "accepted" || value.status === "rejected" || value.status === "deprecated"
}

function extractJsonText(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]?.trim()) return fenced[1].trim()
  const first = text.indexOf("{")
  const last = text.lastIndexOf("}")
  if (first >= 0 && last > first) return text.slice(first, last + 1).trim()
  return text.trim()
}

function arrayValue(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function renderTraceabilityPrompt(input: {
  input: PrepareAiTraceabilityDraftPromptInput
  catalog?: TraceabilityCatalog
  diff?: DiffSummary
  candidates: Array<{ kind: string; path: string; sections?: string[]; cases?: string[]; rows?: string[]; sheets?: string[]; description?: string }>
  warnings: string[]
}): string {
  const candidatePayload = input.candidates.slice(0, MAX_CANDIDATE_COUNT).map((candidate) => ({
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
    "- statusは必ず `proposed`。人間承認前に `accepted`、`rejected`、`deprecated` を作らない。",
    "- itemは `id` を持ってはいけない。linkは `from` / `to` を持ってはいけない。",
    "- link_typeは `satisfies`, `elaborates`, `verified_by`, `clarifies`, `reviewed_by`, `references` のみ。",
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
        { proposed_from: "REQ-RS001-PAY-0001", proposed_to: "BD-BD001-PAY-0001", link_type: "satisfies", status: "proposed" },
        { proposed_from: "QA-QA001-PAY-0001", proposed_to: "REQ-RS001-PAY-0001", link_type: "clarifies", status: "proposed" },
        { proposed_from: "REQ-RS001-PAY-0001", proposed_to: "RV-RV001-PAY-0001", link_type: "reviewed_by", status: "proposed" }
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
    ...diff.files.slice(0, 120).map((file) => `| ${file.status} | ${file.path} | ${file.additions ?? 0} | ${file.deletions ?? 0} | ${file.language ?? ""} | ${[file.is_test ? "test" : "", file.is_interface_candidate ? "interface" : ""].filter(Boolean).join(", ")} |`)
  ]
  if (diff.warnings.length > 0) lines.push("", "warnings:", ...diff.warnings.map((warning) => `- ${warning}`))
  if (diff.unifiedDiff) lines.push("", "```diff", truncate(diff.unifiedDiff, MAX_DIFF_CHARS), "```")
  return lines.join("\n")
}

function minimalTraceabilityReviewInput(input: PrepareAiTraceabilityDraftPromptInput): ReviewInput {
  return {
    schema_version: 1,
    review: {
      id: "traceability-ai-draft",
      title: "Traceability AI draft context",
      change_type: "maintenance",
      purpose: "Traceability AI draft context generation",
      base: input.base,
      head: input.head,
      vcs: input.vcs,
      vcs_root: input.vcsRoot
    },
    artifacts: { requirements: [{ path: "traceability-placeholder.md" }] },
    review_focus: ["requirement-code-consistency"]
  }
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}\n... truncated ${value.length - maxChars} char(s) ...`
}
