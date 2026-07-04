import * as fs from "node:fs/promises"
import * as path from "node:path"
import YAML from "yaml"
import { pathExists, resolveWorkspacePath, toPosixPath, writeTextFile } from "./fileSystem"
import { formatSchemaErrors, loadSchemaValidator } from "./schemaLoader"
import type { ReviewInput } from "./reviewTypes"

export const REVIEW_FOCUS_VALUES = [
  "requirement-code-consistency",
  "design-code-consistency",
  "test-gap",
  "document-update-gap",
  "unintended-change",
  "interface-impact",
  "rt-ts-rule",
  "shared-memory-impact"
] as const

export const CHANGE_TYPE_VALUES = ["bugfix", "feature", "spec_change", "refactor", "performance", "maintenance"] as const
export const VCS_VALUES = ["git", "bazaar", "bzr"] as const
export const ARTIFACT_KIND_VALUES = ["requirements", "basic_design", "detailed_design", "test_spec", "ledgers", "tickets"] as const

export type ReviewFocus = typeof REVIEW_FOCUS_VALUES[number]
export type ChangeType = typeof CHANGE_TYPE_VALUES[number]
export type VcsKind = typeof VCS_VALUES[number]
export type ArtifactKind = typeof ARTIFACT_KIND_VALUES[number]

export const REVIEW_FOCUS_PRESETS = {
  standard: ["requirement-code-consistency", "design-code-consistency", "test-gap"],
  document_update: ["document-update-gap", "unintended-change"],
  interface: ["interface-impact", "unintended-change"],
  rt_shared_memory: ["rt-ts-rule", "shared-memory-impact", "interface-impact"],
  test_gap: ["test-gap", "requirement-code-consistency"]
} as const satisfies Record<string, readonly ReviewFocus[]>

export type ReviewFocusPreset = keyof typeof REVIEW_FOCUS_PRESETS

export type ReviewInputDraft = {
  review: {
    id?: string
    title?: string
    change_type?: ChangeType | string
    purpose?: string
    base?: string
    head?: string
    vcs?: VcsKind | string
    vcs_root?: string
    ticket_ids?: string[]
    author_note?: string
    out_of_scope?: string[]
  }
  artifact_candidates: ReviewInputArtifactDraft[]
  focus_preset?: ReviewFocusPreset | string
  review_focus?: Array<ReviewFocus | string>
  analysis_options?: ReviewInput["analysis_options"]
  bob_options?: ReviewInput["bob_options"]
}

export type ReviewInputArtifactDraft = {
  kind: ArtifactKind | string
  path: string
  version?: string
  updated_at?: string
  sections?: string[]
  sheets?: string[]
  rows?: string[]
  cases?: string[]
  note?: string
}

export type ReviewInputBuildResult =
  | { status: "ok"; reviewInput: ReviewInput; yaml: string; warnings: string[] }
  | { status: "error"; errors: string[]; warnings: string[] }

export type ReviewInputWriteResult =
  | { status: "ok"; reviewInput: ReviewInput; yaml: string; outputPath: string; backupPath?: string; warnings: string[] }
  | { status: "error"; outputPath: string; errors: string[]; warnings: string[] }

export async function buildReviewInputFromDraft(draft: ReviewInputDraft, options: { workspaceRoot: string; strictPaths?: boolean }): Promise<ReviewInputBuildResult> {
  const warnings: string[] = []
  const errors: string[] = []
  const strictPaths = options.strictPaths ?? true

  const reviewFocus = resolveReviewFocus(draft, errors)
  const changeType = enumValue(draft.review.change_type ?? "maintenance", CHANGE_TYPE_VALUES, "review.change_type", errors)
  const vcs = enumValue(draft.review.vcs ?? "git", VCS_VALUES, "review.vcs", errors)
  const artifacts = await buildArtifacts(draft.artifact_candidates, options.workspaceRoot, strictPaths, errors)

  const reviewInput: ReviewInput = {
    schema_version: 1,
    review: compactRecord({
      id: nonEmpty(draft.review.id) ?? makeReviewId(draft.review.title),
      title: nonEmpty(draft.review.title) ?? "コード整合プレレビュー",
      change_type: changeType ?? "maintenance",
      purpose: nonEmpty(draft.review.purpose) ?? "要求・設計・テスト仕様とコード変更の整合性を正式レビュー前に確認する",
      base: nonEmpty(draft.review.base) ?? "HEAD~1",
      head: nonEmpty(draft.review.head) ?? "HEAD",
      vcs: vcs ?? "git",
      vcs_root: nonEmpty(draft.review.vcs_root),
      ticket_ids: uniqueStrings(draft.review.ticket_ids),
      author_note: nonEmpty(draft.review.author_note),
      out_of_scope: uniqueStrings(draft.review.out_of_scope)
    }),
    artifacts,
    review_focus: reviewFocus,
    analysis_options: draft.analysis_options ?? defaultAnalysisOptions(),
    bob_options: draft.bob_options ?? defaultBobOptions()
  }

  const schemaErrors = await validateReviewInputShape(reviewInput)
  errors.push(...schemaErrors)

  if (errors.length > 0) return { status: "error", errors: uniqueStrings(errors) ?? [], warnings }
  return { status: "ok", reviewInput, yaml: renderReviewInputYaml(reviewInput), warnings }
}

export async function writeReviewInputFromDraft(input: {
  draft: ReviewInputDraft
  workspaceRoot: string
  outputPath: string
  overwrite?: boolean
  backupExisting?: boolean
  strictPaths?: boolean
}): Promise<ReviewInputWriteResult> {
  const build = await buildReviewInputFromDraft(input.draft, { workspaceRoot: input.workspaceRoot, strictPaths: input.strictPaths })
  if (build.status === "error") return { status: "error", outputPath: input.outputPath, errors: build.errors, warnings: build.warnings }

  const existing = await readIfExists(input.outputPath)
  if (existing !== undefined && input.overwrite === false) {
    return { status: "error", outputPath: input.outputPath, errors: [`review-input.yaml already exists: ${input.outputPath}`], warnings: build.warnings }
  }

  let backupPath: string | undefined
  if (existing !== undefined && input.backupExisting !== false) {
    backupPath = `${input.outputPath}.bak-${timestampForFileName(new Date())}`
    await writeTextFile(backupPath, existing)
  }

  await writeTextFile(input.outputPath, build.yaml)
  return { status: "ok", reviewInput: build.reviewInput, yaml: build.yaml, outputPath: input.outputPath, backupPath, warnings: build.warnings }
}

function resolveReviewFocus(draft: ReviewInputDraft, errors: string[]): ReviewFocus[] {
  const raw = draft.review_focus && draft.review_focus.length > 0
    ? draft.review_focus
    : REVIEW_FOCUS_PRESETS[enumValue(draft.focus_preset ?? "standard", Object.keys(REVIEW_FOCUS_PRESETS) as ReviewFocusPreset[], "focus_preset", errors) ?? "standard"]

  const result: ReviewFocus[] = []
  for (const value of raw) {
    const normalized = enumValue(value, REVIEW_FOCUS_VALUES, "review_focus", errors)
    if (normalized && !result.includes(normalized)) result.push(normalized)
  }
  if (result.length === 0) errors.push("review_focus must include at least one valid focus value")
  return result
}

async function buildArtifacts(candidates: ReviewInputArtifactDraft[], workspaceRoot: string, strictPaths: boolean, errors: string[]): Promise<Record<string, unknown>> {
  const artifacts: Record<string, unknown[]> = {}
  if (!Array.isArray(candidates) || candidates.length === 0) {
    errors.push("artifact_candidates must include at least one artifact")
    return artifacts
  }

  for (const candidate of candidates) {
    const kind = enumValue(candidate.kind, ARTIFACT_KIND_VALUES, "artifact.kind", errors)
    const artifactPath = nonEmpty(candidate.path)
    if (!kind || !artifactPath) {
      if (!artifactPath) errors.push("artifact.path must be a non-empty string")
      continue
    }
    const resolvedPath = resolveWorkspacePath(workspaceRoot, artifactPath)
    if (!isInsideWorkspace(workspaceRoot, resolvedPath)) {
      errors.push(`artifact path escapes workspace: ${artifactPath}`)
      continue
    }

    if (strictPaths && !(await pathExists(resolvedPath))) {
      errors.push(`artifact path does not exist: ${artifactPath}`)
      continue
    }
    const storedPath = path.isAbsolute(artifactPath)
      ? path.relative(workspaceRoot, resolvedPath)
      : artifactPath

    const item = compactRecord({
      path: toPosixPath(storedPath),
      version: nonEmpty(candidate.version),
      updated_at: nonEmpty(candidate.updated_at),
      sections: uniqueStrings(candidate.sections),
      sheets: uniqueStrings(candidate.sheets),
      rows: uniqueStrings(candidate.rows),
      cases: uniqueStrings(candidate.cases),
      note: nonEmpty(candidate.note)
    })
    artifacts[kind] = [...(artifacts[kind] ?? []), item]
  }

  return artifacts
}

async function validateReviewInputShape(reviewInput: ReviewInput): Promise<string[]> {
  const validate = await loadSchemaValidator("review-input")
  if (validate(reviewInput)) return []
  return formatSchemaErrors(validate).map((error) => `schema ${error}`)
}

function renderReviewInputYaml(reviewInput: ReviewInput): string {
  return YAML.stringify(reviewInput, { lineWidth: 120 })
}

function defaultAnalysisOptions(): NonNullable<ReviewInput["analysis_options"]> {
  return {
    include_callers: true,
    include_callees: true,
    include_global_access: true,
    include_struct_impact: true,
    include_ledgers: true,
    max_call_depth: 2,
    max_code_context_lines: 80,
    language: ["c", "h"]
  }
}

function defaultBobOptions(): NonNullable<ReviewInput["bob_options"]> {
  return {
    prompt_template: "consistency-review-v1",
    output_format: "yaml",
    require_evidence: true,
    allow_questions: true,
    forbid_final_approval: true
  }
}

function enumValue<const T extends string>(value: unknown, allowed: readonly T[], name: string, errors: string[]): T | undefined {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${name} must be a non-empty string`)
    return undefined
  }
  const normalized = value.trim()
  if ((allowed as readonly string[]).includes(normalized)) return normalized as T
  errors.push(`${name} has invalid value '${normalized}'. Allowed: ${allowed.join(", ")}`)
  return undefined
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function uniqueStrings(values: unknown): string[] | undefined {
  if (!Array.isArray(values)) return undefined
  const result = [...new Set(values.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean))]
  return result.length > 0 ? result : undefined
}

function compactRecord<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T
}

function makeReviewId(title: unknown): string {
  const source = nonEmpty(title) ?? "review-input-draft"
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "review-input-draft"
}

async function readIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8")
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined
    throw error
  }
}

function isInsideWorkspace(workspaceRoot: string, filePath: string): boolean {
  const root = path.resolve(workspaceRoot)
  const target = path.resolve(filePath)
  const relative = path.relative(root, target)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error
}

function timestampForFileName(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}
