import * as path from "node:path"
import { collectGitDiff } from "./gitDiffCollector"
import { discoverReviewInputCandidates } from "./reviewInputDiscovery"
import { explainReviewInputDiagnostics } from "./reviewInputDiagnostics"
import { ARTIFACT_KIND_VALUES, CHANGE_TYPE_VALUES, REVIEW_FOCUS_VALUES, VCS_VALUES, writeReviewInputFromDraft, type ReviewInputDraft } from "./reviewInputBuilder"
import type { DiffSummary, ReviewInput } from "./types"
import { writeTextFile } from "./fileSystem"

export type PrepareAiReviewInputDraftPromptInput = {
  workspaceRoot: string
  outputDir: string
  reviewInputPath: string
  base: string
  head: string
  vcs: "git" | "bazaar" | "bzr"
  vcsRoot?: string
  bzrPath?: string
  diffFixturePath?: string
  textEncoding?: string
}

export type PrepareAiReviewInputDraftPromptResult = {
  status: "ok"
  promptPath: string
  prompt: string
  warnings: string[]
}

export type ApplyAiReviewInputDraftInput = {
  workspaceRoot: string
  reviewInputPath: string
  text: string
  strictPaths?: boolean
}

export type ApplyAiReviewInputDraftResult =
  | { status: "ok"; outputPath: string; backupPath?: string; reviewInput: ReviewInput; warnings: string[] }
  | { status: "error"; errors: string[]; warnings: string[] }

const PROMPT_FILE_NAME = "ai-draft-prompt.md"
const MAX_DIFF_CHARS = 14000
const MAX_CANDIDATE_COUNT = 120

export async function prepareAiReviewInputDraftPrompt(input: PrepareAiReviewInputDraftPromptInput): Promise<PrepareAiReviewInputDraftPromptResult> {
  const warnings: string[] = []
  const discovery = await discoverReviewInputCandidates(input.workspaceRoot, { textEncoding: input.textEncoding, maxFiles: MAX_CANDIDATE_COUNT })
  warnings.push(...discovery.warnings)

  const diagnostics = await explainReviewInputDiagnostics({ inputPath: input.reviewInputPath, workspaceRoot: input.workspaceRoot, textEncoding: input.textEncoding })
  let diff: DiffSummary | undefined
  try {
    diff = await collectGitDiff(minimalReviewInput(input), {
      workspaceRoot: input.workspaceRoot,
      diffFixturePath: input.diffFixturePath,
      bzrPath: input.bzrPath,
      textEncoding: input.textEncoding
    })
  } catch (error) {
    warnings.push(`diff summary unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }

  const prompt = renderPrompt({ input, diagnostics, diff, candidates: discovery.documents, warnings })
  const promptPath = path.join(input.outputDir, PROMPT_FILE_NAME)
  await writeTextFile(promptPath, prompt)
  return { status: "ok", promptPath, prompt, warnings }
}

export async function applyAiReviewInputDraft(input: ApplyAiReviewInputDraftInput): Promise<ApplyAiReviewInputDraftResult> {
  const warnings: string[] = []
  let draft: ReviewInputDraft
  try {
    draft = parseAiReviewInputDraft(input.text)
  } catch (error) {
    return { status: "error", errors: [`AI draft JSON parse failed: ${error instanceof Error ? error.message : String(error)}`], warnings }
  }

  const result = await writeReviewInputFromDraft({
    draft,
    workspaceRoot: input.workspaceRoot,
    outputPath: input.reviewInputPath,
    overwrite: true,
    backupExisting: true,
    strictPaths: input.strictPaths ?? true
  })

  if (result.status === "error") return { status: "error", errors: result.errors, warnings: [...warnings, ...result.warnings] }
  return {
    status: "ok",
    outputPath: result.outputPath,
    backupPath: result.backupPath,
    reviewInput: result.reviewInput,
    warnings: [...warnings, ...result.warnings]
  }
}

export function parseAiReviewInputDraft(text: string): ReviewInputDraft {
  const jsonText = extractJsonText(text)
  const parsed = JSON.parse(jsonText) as unknown
  if (!isRecord(parsed)) throw new Error("top-level value must be an object")
  if (!isRecord(parsed.review)) throw new Error("review must be an object")
  if (!Array.isArray(parsed.artifact_candidates)) throw new Error("artifact_candidates must be an array")
  return parsed as ReviewInputDraft
}

function extractJsonText(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]?.trim()) return fenced[1].trim()
  const first = text.indexOf("{")
  const last = text.lastIndexOf("}")
  if (first >= 0 && last > first) return text.slice(first, last + 1).trim()
  return text.trim()
}

function renderPrompt(input: {
  input: PrepareAiReviewInputDraftPromptInput
  diagnostics: Awaited<ReturnType<typeof explainReviewInputDiagnostics>>
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
    "# AI Draft Request: review-input.yaml",
    "",
    "あなたは `review-input.yaml` の最終 YAML を書いてはいけません。返却するのは `ReviewInputDraft` JSON だけです。",
    "拡張機能側が `ReviewInputBuilder` と schema validator を通して最終 YAML を生成します。",
    "",
    "## 絶対ルール",
    "",
    "- 出力は JSON object だけ。Markdown、YAML、説明文、コメントは禁止。",
    "- `artifact_candidates[].path` は下の候補一覧に存在する path だけを使う。存在しない path を作らない。",
    "- `artifact_candidates[].kind`、`review.change_type`、`review.vcs`、`review_focus` は下の enum だけを使う。",
    "- 不確かな文書や section は無理に補完せず、最も関連しそうな候補だけを選ぶ。",
    "- 最終承認、レビュー完了判断、人間確認不要などは書かない。",
    "",
    "## Allowed enum",
    "",
    `change_type: ${CHANGE_TYPE_VALUES.join(", ")}`,
    `vcs: ${VCS_VALUES.join(", ")}`,
    `artifact.kind: ${ARTIFACT_KIND_VALUES.join(", ")}`,
    `review_focus: ${REVIEW_FOCUS_VALUES.join(", ")}`,
    "",
    "## Required JSON shape",
    "",
    "```json",
    JSON.stringify({
      review: {
        id: "short-review-id",
        title: "レビュータイトル",
        change_type: "bugfix",
        purpose: "変更目的",
        base: input.input.base,
        head: input.input.head,
        vcs: input.input.vcs,
        ticket_ids: ["TICKET-1234"],
        out_of_scope: ["必要に応じて対象外を書く"]
      },
      artifact_candidates: [
        {
          kind: "requirements",
          path: "docs/example.md",
          sections: ["REQ-EXAMPLE-001"]
        }
      ],
      review_focus: ["requirement-code-consistency", "design-code-consistency", "test-gap"]
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
    "## Diff summary",
    "",
    input.diff ? renderDiffSummary(input.diff) : "diff summary unavailable. Use document candidates and diagnostics only.",
    "",
    "## Existing review-input diagnostics",
    "",
    input.diagnostics.status === "ok" ? "- existing review-input.yaml is valid" : input.diagnostics.diagnostics.map((line) => `- ${line}`).join("\n"),
    "",
    "## Artifact candidates",
    "",
    "```json",
    JSON.stringify(candidatePayload, null, 2),
    "```",
    "",
    "## Discovery warnings",
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

function minimalReviewInput(input: PrepareAiReviewInputDraftPromptInput): ReviewInput {
  return {
    schema_version: 1,
    review: {
      id: "ai-draft",
      title: "AI draft context",
      change_type: "maintenance",
      purpose: "AI draft context generation",
      base: input.base,
      head: input.head,
      vcs: input.vcs,
      vcs_root: input.vcsRoot
    },
    artifacts: { requirements: [{ path: "review-input-placeholder.md" }] },
    review_focus: ["requirement-code-consistency"]
  }
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}\n... truncated ${value.length - maxChars} char(s) ...`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
