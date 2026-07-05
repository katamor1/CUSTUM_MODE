import * as fs from "node:fs/promises"
import * as path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { applyTemplate, loadPromptTemplates } from "../templates/templateLoader"
import { relativePosix, writeJsonFile, writeTextFile } from "./fileSystem"
import { normalizeReviewProcessingLimits, truncateUtf8Text, type ReviewProcessingLimits } from "./limits"
import type { CodeAnalysisResult } from "./analysisTypes"
import type { DiffSummary } from "./diffTypes"
import type { DocumentExtractionResult, EvidenceRef } from "./documentTypes"
import type { ReviewInput } from "./reviewTypes"
import type { TraceabilityResult } from "./traceabilityResultTypes"

const PRIVACY_NOTICE_JA = "生成物は社内設計書・顧客仕様・ソースコード・raw diff を含む可能性があります。"
const MANAGED_PACKAGE_OUTPUTS = [
  "prompts",
  "code-slices",
  "tables",
  "input-normalized.json",
  "changed-files.json",
  "changed-symbols.json",
  "document-index.json",
  "evidence-index.json",
  "traceability-map.json",
  "manifest.yaml",
  "change-summary.md",
  "diff-context.md",
  "document-excerpts.md",
  "traceability-map.md",
  "deterministic-checks.md",
  "bob-input.md"
]

export async function buildReviewPackage(input: {
  workspaceRoot: string
  outDir: string
  reviewInput: ReviewInput
  diff: DiffSummary
  documents: DocumentExtractionResult
  codeAnalysis: CodeAnalysisResult
  traceability: TraceabilityResult
  limits?: Partial<ReviewProcessingLimits>
  workflowRunId?: string
}): Promise<string[]> {
  const { outDir, reviewInput, diff, documents, codeAnalysis, traceability } = input
  const limits = normalizeReviewProcessingLimits(input.limits)
  const packageWarnings: string[] = []
  const generationId = randomUUID()
  await fs.mkdir(outDir, { recursive: true })
  await cleanManagedPackageOutputs(outDir)
  await writePrompts(outDir)
  await writeCodeSlices(outDir, codeAnalysis)
  await writeTables(outDir, documents)

  const evidence = [...documents.evidence, ...codeAnalysis.evidence]
  await writeJsonFile(path.join(outDir, "input-normalized.json"), reviewInput)
  await writeJsonFile(path.join(outDir, "changed-files.json"), { vcs: diff.vcs ?? "git", vcsRoot: diff.vcsRoot, files: diff.files, warnings: diff.warnings })
  await writeJsonFile(path.join(outDir, "changed-symbols.json"), {
    symbols: codeAnalysis.changedSymbols,
    functions: codeAnalysis.functions,
    defines: codeAnalysis.defines,
    globals: codeAnalysis.globals,
    call_graph: codeAnalysis.callGraph,
    rt_forbidden_candidates: codeAnalysis.rtForbiddenCandidates,
    warnings: codeAnalysis.warnings
  })
  await writeJsonFile(path.join(outDir, "document-index.json"), { documents: documents.documents, warnings: documents.warnings })
  await writeJsonFile(path.join(outDir, "evidence-index.json"), { evidence: evidence.map(stripEvidenceText) })
  await writeJsonFile(path.join(outDir, "traceability-map.json"), { rows: traceability.rows, warnings: traceability.warnings })

  const changeSummary = buildChangeSummary(reviewInput, diff, codeAnalysis, documents)
  const diffContext = buildDiffContext(diff, codeAnalysis, limits, packageWarnings)
  let deterministicChecks = buildDeterministicChecks(documents, codeAnalysis, traceability, packageWarnings)

  await writeTextFile(path.join(outDir, "change-summary.md"), changeSummary)
  await writeTextFile(path.join(outDir, "diff-context.md"), diffContext)
  await writeTextFile(path.join(outDir, "document-excerpts.md"), documents.excerptsMarkdown)
  await writeTextFile(path.join(outDir, "traceability-map.md"), traceability.markdown)

  const templates = await loadPromptTemplates()
  const bobInputSource = applyTemplate(templates.bobInputTemplate, {
    "prompt.system": templates.system,
    "prompt.task": templates.task,
    "prompt.output_format": templates.outputFormat,
    "review.summary": buildReviewSummary(reviewInput, diff),
    change_summary: changeSummary,
    deterministic_checks: deterministicChecks,
    document_excerpts: documents.excerptsMarkdown,
    diff_context: diffContext,
    changed_symbols_summary: codeAnalysis.summaryMarkdown,
    traceability_map: traceability.markdown,
    evidence_index_summary: evidenceIndexSummary(evidence)
  })
  const bobInput = limitBobInput(bobInputSource, limits, packageWarnings)
  deterministicChecks = buildDeterministicChecks(documents, codeAnalysis, traceability, packageWarnings)

  await writeTextFile(path.join(outDir, "manifest.yaml"), buildManifest(reviewInput, diff, evidence, input.workspaceRoot, outDir, packageWarnings, generationId, input.workflowRunId))
  await writeTextFile(path.join(outDir, "deterministic-checks.md"), deterministicChecks)
  await writeTextFile(path.join(outDir, "bob-input.md"), bobInput)
  return packageWarnings
}

function buildManifest(reviewInput: ReviewInput, diff: DiffSummary, evidence: EvidenceRef[], workspaceRoot: string, outDir: string, packageWarnings: string[], generationId: string, workflowRunId?: string): string {
  return [
    "package_version: 1",
    `generation_id: ${generationId}`,
    `created_at: ${JSON.stringify(new Date().toISOString())}`,
    "created_by: bob-code-consistency-review",
    "preprocess_version: 0.1.0",
    "artifact_metadata:",
    "  producer_extension: bob-code-consistency-review",
    "  producer_version: 0.1.0",
    `  workflow_run_id: ${yamlScalar(workflowRunId ?? "")}`,
    `  source_vcs: ${yamlScalar(diff.vcs ?? "git")}`,
    `  source_revision: ${yamlScalar(sourceRevision(diff))}`,
    `  input_hash: ${sha256Prefixed({ reviewInput, diff: diffHashInput(diff) })}`,
    "  contains_sensitive_context: true",
    "  human_review_required: true",
    "repository:",
    `  vcs: ${diff.vcs ?? "git"}`,
    diff.vcsRoot ? `  root: ${JSON.stringify(relativePosix(workspaceRoot, diff.vcsRoot))}` : undefined,
    `  base: ${diff.base}`,
    `  head: ${diff.head}`,
    "review:",
    `  id: ${reviewInput.review.id}`,
    `  title: ${JSON.stringify(reviewInput.review.title)}`,
    `  change_type: ${reviewInput.review.change_type}`,
    "prompts:",
    "  template_id: consistency-review-v1",
    "inputs:",
    `  review_package: ${relativePosix(workspaceRoot, outDir)}`,
    `  evidence_count: ${evidence.length}`,
    "privacy_notice:",
    "  generated_artifacts_may_contain_sensitive_context: true",
    `  message: ${JSON.stringify("Generated files may contain internal design docs, customer specs, source code, and raw diff. Ignore .bob-review/ and .bob-trace/ai-traceability-draft/ unless intentionally versioned.")}`,
    "  recommended_gitignore:",
    "    - .bob-review/",
    "    - .bob-trace/ai-traceability-draft/",
    "    - .bob/workflows/runs/",
    packageWarnings.length > 0 ? "truncation_warnings:" : undefined,
    ...packageWarnings.map((warning) => `  - ${JSON.stringify(warning)}`),
    ""
  ].filter((line): line is string => line !== undefined).join("\n")
}

function sourceRevision(diff: DiffSummary): string {
  if (diff.base && diff.head) return `${diff.base}..${diff.head}`
  return diff.head || diff.base || ""
}

function diffHashInput(diff: DiffSummary): Record<string, unknown> {
  return {
    vcs: diff.vcs ?? "git",
    vcsRoot: diff.vcsRoot,
    base: diff.base,
    head: diff.head,
    files: diff.files,
    warnings: diff.warnings
  }
}

function sha256Prefixed(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`
}

function yamlScalar(value: string): string {
  return /^[A-Za-z0-9_.:/@+-]+$/.test(value) ? value : JSON.stringify(value)
}

async function cleanManagedPackageOutputs(outDir: string): Promise<void> {
  // 生成 package の鮮度を保つため、管理対象の既知ファイルだけを消し、ユーザーが置いた補助ファイルは残す。
  await Promise.all(MANAGED_PACKAGE_OUTPUTS.map((item) =>
    fs.rm(path.join(outDir, item), { recursive: true, force: true })
  ))
}

function buildReviewSummary(reviewInput: ReviewInput, diff: DiffSummary): string {
  const lines = [
    `- review_id: ${reviewInput.review.id}`,
    `- title: ${reviewInput.review.title}`,
    `- vcs: ${diff.vcs ?? "git"}`,
    `- target_range: ${diff.base}..${diff.head}`,
    `- change_type: ${reviewInput.review.change_type}`,
    `- purpose: ${reviewInput.review.purpose}`,
    `- review_focus: ${reviewInput.review_focus.join(", ")}`
  ]
  if (reviewInput.review.out_of_scope && reviewInput.review.out_of_scope.length > 0) {
    lines.push(`- out_of_scope: ${joinHumanList(reviewInput.review.out_of_scope)}`)
  }
  return lines.join("\n")
}

function joinHumanList(values: string[]): string {
  if (values.length <= 1) return values.join("")
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`
}

function buildChangeSummary(reviewInput: ReviewInput, diff: DiffSummary, codeAnalysis: CodeAnalysisResult, documents: DocumentExtractionResult): string {
  return [
    "# 変更サマリ",
    "",
    buildReviewSummary(reviewInput, diff),
    `- changed_files: ${diff.files.length}`,
    `- changed_functions: ${codeAnalysis.functions.length}`,
    `- document_evidence: ${documents.evidence.length}`,
    `- code_evidence: ${codeAnalysis.evidence.length}`,
    "",
    "## 変更ファイル",
    "",
    ...diff.files.map((file) => `- ${file.status}: ${file.path} (+${file.additions ?? 0}/-${file.deletions ?? 0})`)
  ].join("\n")
}

function buildDiffContext(diff: DiffSummary, codeAnalysis: CodeAnalysisResult, limits: ReviewProcessingLimits, packageWarnings: string[]): string {
  const suffix = "\n\n[truncated: maxRawDiffBytes]\n"
  const limitedDiff = truncateUtf8Text(diff.unifiedDiff ?? "", limits.maxRawDiffBytes, suffix)
  if (limitedDiff.truncated) {
    packageWarnings.push(`diff-context raw unified diff exceeded maxRawDiffBytes (${limitedDiff.originalBytes} > ${limits.maxRawDiffBytes}); truncated.`)
  }
  return [
    "# 差分コンテキスト",
    "",
    ...codeAnalysis.codeSlices.map((slice) => slice.markdown),
    "## Raw unified diff",
    "",
    "```diff",
    limitedDiff.text,
    "```",
    ""
  ].join("\n")
}

function buildDeterministicChecks(documents: DocumentExtractionResult, codeAnalysis: CodeAnalysisResult, traceability: TraceabilityResult, packageWarnings: string[] = []): string {
  const warnings = [...documents.warnings, ...codeAnalysis.warnings, ...traceability.warnings, ...packageWarnings]
  return [
    "# 決定論的チェック結果",
    "",
    `- document extraction warnings: ${documents.warnings.length}`,
    `- code analysis warnings: ${codeAnalysis.warnings.length}`,
    `- traceability warnings: ${traceability.warnings.length}`,
    `- package warnings: ${packageWarnings.length}`,
    `- evidence_id duplicates: ${hasDuplicateEvidenceIds([...documents.evidence, ...codeAnalysis.evidence]) ? "detected" : "none"}`,
    `- privacy: ${PRIVACY_NOTICE_JA} .gitignore に .bob-review/ と .bob-trace/ai-traceability-draft/ が含まれていることを確認してください。`,
    "",
    "## Warnings",
    "",
    ...(warnings.length > 0 ? warnings.map((warning) => `- ${warning}`) : ["- none"])
  ].join("\n")
}

function limitBobInput(text: string, limits: ReviewProcessingLimits, packageWarnings: string[]): string {
  const suffix = "\n\n[truncated: maxBobInputBytes]\n"
  const limited = truncateUtf8Text(text, limits.maxBobInputBytes, suffix)
  if (!limited.truncated) return text
  packageWarnings.push(`bob-input.md exceeded maxBobInputBytes (${limited.originalBytes} > ${limits.maxBobInputBytes}); truncated.`)
  return limited.text
}

function evidenceIndexSummary(evidence: EvidenceRef[]): string {
  return evidence.map((item) => `- ${item.evidence_id}: ${item.type} ${item.ref}${item.source ? ` (${item.source})` : ""}`).join("\n")
}

function stripEvidenceText(evidence: EvidenceRef): EvidenceRef {
  const { text: _text, ...rest } = evidence
  return rest
}

function hasDuplicateEvidenceIds(evidence: EvidenceRef[]): boolean {
  const ids = evidence.map((item) => item.evidence_id)
  return new Set(ids).size !== ids.length
}

async function writePrompts(outDir: string): Promise<void> {
  const templates = await loadPromptTemplates()
  const promptDir = path.join(outDir, "prompts")
  await Promise.all([
    writeTextFile(path.join(promptDir, "system.md"), templates.system),
    writeTextFile(path.join(promptDir, "task.md"), templates.task),
    writeTextFile(path.join(promptDir, "output-format.md"), templates.outputFormat)
  ])
}

async function writeCodeSlices(outDir: string, codeAnalysis: CodeAnalysisResult): Promise<void> {
  await Promise.all(codeAnalysis.codeSlices.map((slice) => writeTextFile(path.join(outDir, "code-slices", `${slice.evidence_id}.md`), slice.markdown)))
}

async function writeTables(outDir: string, documents: DocumentExtractionResult): Promise<void> {
  const tableExcerpts = documents.evidence.filter((item) => item.text?.includes("|"))
  await Promise.all(tableExcerpts.map((item) => writeTextFile(path.join(outDir, "tables", `${item.evidence_id}.md`), `# ${item.evidence_id}\n\n${item.text ?? ""}\n`)))
}
