import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as vscode from "vscode"

export interface InitializeCodeConsistencyWorkspaceOptions {
  context: vscode.ExtensionContext
  workspaceRoot: string
  reviewInputPath?: string
}

export interface InitializeCodeConsistencyWorkspaceResult {
  status: "created" | "updated" | "unchanged"
  workspaceRoot: string
  workflowPath: string
  reviewInputPath: string
  gitignorePath: string
  placeholderDocumentPath?: string
  backupPath?: string
  reviewInputBackupPath?: string
  message: string
}

type FileInitializationResult = {
  status: "created" | "updated" | "unchanged"
  path: string
  backupPath?: string
  message: string
}

const WORKFLOW_RELATIVE_PATH = path.join(".bob", "workflows", "code-consistency-review", "WORKFLOW.md")
const WORKFLOW_TEMPLATE_RELATIVE_PATH = path.join("templates", ".bob", "workflows", "code-consistency-review", "WORKFLOW.md")
const REVIEW_INPUT_RELATIVE_PATH = "review-input.yaml"
const REVIEW_PLACEHOLDER_DOCUMENT_RELATIVE_PATH = path.join("docs", "review-input-placeholder.md")
const GENERATED_ARTIFACT_IGNORE_LINES = [".bob-review/", ".bob-trace/ai-traceability-draft/", ".bob/workflows/runs/"]
const GENERATED_ARTIFACT_IGNORE_HEADER = "# Bob code consistency generated review artifacts"

const REVIEW_INPUT_TEMPLATE = `# Bob Code Consistency Review input skeleton.
# 実レビュー前に id/title/purpose/base/head、artifact path、section ID を実案件向けに更新してください。
schema_version: 1
review:
  id: sample-review
  title: コード整合プレレビュー
  change_type: maintenance
  purpose: 要求・設計・テスト仕様とコード変更の整合性を正式レビュー前に確認する
  base: HEAD~1
  head: HEAD
  vcs: git
  ticket_ids:
    - TICKET-PLACEHOLDER
  out_of_scope:
    - 生成された雛形のため、実レビュー前に文書パスと section ID を更新する
artifacts:
  requirements:
    - path: docs/review-input-placeholder.md
      sections:
        - REQ-PLACEHOLDER
  basic_design:
    - path: docs/review-input-placeholder.md
      sections:
        - BD-PLACEHOLDER
  detailed_design:
    - path: docs/review-input-placeholder.md
      sections:
        - DD-PLACEHOLDER
  test_spec:
    - path: docs/review-input-placeholder.md
      sections:
        - TC-PLACEHOLDER
review_focus:
  - requirement-code-consistency
  - design-code-consistency
  - test-gap
analysis_options:
  include_callers: true
  include_callees: true
  include_global_access: true
  include_struct_impact: true
  include_ledgers: true
  max_call_depth: 2
  max_code_context_lines: 80
bob_options:
  prompt_template: consistency-review-v1
  output_format: yaml
  require_evidence: true
  allow_questions: true
  forbid_final_approval: true
`

const REVIEW_PLACEHOLDER_DOCUMENT_TEMPLATE = `# review-input placeholder

このファイルは \`bobCodeConsistency.initializeWorkspace\` が生成する review-input.yaml 雛形用の仮文書です。
実レビューでは、実際の要求書・基本設計書・詳細設計書・テスト仕様書へ差し替えてください。

## REQ-PLACEHOLDER

- 仮の要求 section です。実レビュー前に REQ-* などの実 ID へ置き換えてください。

## BD-PLACEHOLDER

- 仮の基本設計 section です。実レビュー前に BD-* などの実 ID へ置き換えてください。

## DD-PLACEHOLDER

- 仮の詳細設計 section です。実レビュー前に DD-* などの実 ID へ置き換えてください。

## TC-PLACEHOLDER

- 仮のテスト仕様 section です。実レビュー前に TC-* などの実 ID へ置き換えてください。
`

export async function initializeCodeConsistencyWorkspace(options: InitializeCodeConsistencyWorkspaceOptions): Promise<InitializeCodeConsistencyWorkspaceResult> {
  const workflowPath = path.join(options.workspaceRoot, WORKFLOW_RELATIVE_PATH)
  const templatePath = options.context.asAbsolutePath(WORKFLOW_TEMPLATE_RELATIVE_PATH)
  const template = await fs.readFile(templatePath, "utf8")
  const workflowResult = await writeOrUpdateTemplateFile(workflowPath, template, {
    created: `コード整合プレレビュー workflow を作成しました: ${workflowPath}`,
    updated: `コード整合プレレビュー workflow を更新しました: ${workflowPath}`,
    unchanged: `コード整合プレレビュー workflow は既に最新です: ${workflowPath}`
  })

  const reviewInputPath = path.isAbsolute(options.reviewInputPath ?? "")
    ? options.reviewInputPath as string
    : path.join(options.workspaceRoot, options.reviewInputPath ?? REVIEW_INPUT_RELATIVE_PATH)
  const reviewInputResult = await createReviewInputSkeletonIfMissing(reviewInputPath)
  const placeholderDocumentResult = await createPlaceholderDocumentIfNeeded(options.workspaceRoot, reviewInputResult)
  const gitignoreResult = await ensureGeneratedArtifactGitignore(options.workspaceRoot)

  const status = mergeStatus([workflowResult.status, reviewInputResult.status, placeholderDocumentResult?.status ?? "unchanged", gitignoreResult.status])
  const message = [workflowResult.message, reviewInputResult.message, placeholderDocumentResult?.message, gitignoreResult.message].filter(Boolean).join("\n")

  return {
    status,
    workspaceRoot: options.workspaceRoot,
    workflowPath,
    reviewInputPath,
    gitignorePath: gitignoreResult.path,
    placeholderDocumentPath: placeholderDocumentResult?.path,
    backupPath: workflowResult.backupPath,
    reviewInputBackupPath: reviewInputResult.backupPath,
    message
  }
}

async function ensureGeneratedArtifactGitignore(workspaceRoot: string): Promise<FileInitializationResult> {
  const gitignorePath = path.join(workspaceRoot, ".gitignore")
  const current = await readIfExists(gitignorePath)
  const missing = GENERATED_ARTIFACT_IGNORE_LINES.filter((line) => !hasGitignoreLine(current ?? "", line))
  if (missing.length === 0) {
    return {
      status: "unchanged",
      path: gitignorePath,
      message: `生成物 ignore は既に .gitignore に設定済みです: ${gitignorePath}`
    }
  }

  await fs.mkdir(path.dirname(gitignorePath), { recursive: true })
  const block = [GENERATED_ARTIFACT_IGNORE_HEADER, ...missing].join("\n")
  const next = current && current.trim()
    ? `${current.trimEnd()}\n\n${block}\n`
    : `${block}\n`
  await fs.writeFile(gitignorePath, next, "utf8")
  return {
    status: current === undefined ? "created" : "updated",
    path: gitignorePath,
    message: `.gitignore に生成物 ignore を追加しました: ${gitignorePath}\n生成物は機密情報を含む可能性があります: .bob-review/ と .bob-trace/ai-traceability-draft/ を確認してください。`
  }
}

function hasGitignoreLine(text: string, expected: string): boolean {
  return text.split(/\r?\n/).some((line) => line.trim() === expected)
}

async function writeOrUpdateTemplateFile(
  filePath: string,
  template: string,
  messages: { created: string; updated: string; unchanged: string }
): Promise<FileInitializationResult> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })

  const current = await readIfExists(filePath)
  if (current === template) {
    return { status: "unchanged", path: filePath, message: messages.unchanged }
  }

  let backupPath: string | undefined
  if (current !== undefined) {
    backupPath = `${filePath}.bak-${timestampForFileName(new Date())}`
    await fs.writeFile(backupPath, current, "utf8")
  }

  await fs.writeFile(filePath, template, "utf8")
  const status = current === undefined ? "created" : "updated"
  return {
    status,
    path: filePath,
    backupPath,
    message: status === "created" ? messages.created : messages.updated
  }
}

async function createReviewInputSkeletonIfMissing(reviewInputPath: string): Promise<FileInitializationResult> {
  await fs.mkdir(path.dirname(reviewInputPath), { recursive: true })

  const current = await readIfExists(reviewInputPath)
  if (current === undefined) {
    await fs.writeFile(reviewInputPath, REVIEW_INPUT_TEMPLATE, "utf8")
    return {
      status: "created",
      path: reviewInputPath,
      message: `review-input.yaml の雛形を作成しました: ${reviewInputPath}`
    }
  }

  if (current === REVIEW_INPUT_TEMPLATE) {
    return {
      status: "unchanged",
      path: reviewInputPath,
      message: `review-input.yaml の雛形は既に存在します: ${reviewInputPath}`
    }
  }

  const backupPath = `${reviewInputPath}.bak-${timestampForFileName(new Date())}`
  await fs.writeFile(backupPath, current, "utf8")
  return {
    status: "unchanged",
    path: reviewInputPath,
    backupPath,
    message: `既存の review-input.yaml を検出したため上書きせず、バックアップだけ作成しました: ${backupPath}`
  }
}

async function createPlaceholderDocumentIfNeeded(workspaceRoot: string, reviewInputResult: FileInitializationResult): Promise<FileInitializationResult | undefined> {
  if (reviewInputResult.status !== "created") return undefined

  const placeholderDocumentPath = path.join(workspaceRoot, REVIEW_PLACEHOLDER_DOCUMENT_RELATIVE_PATH)
  const current = await readIfExists(placeholderDocumentPath)
  if (current !== undefined) {
    return {
      status: "unchanged",
      path: placeholderDocumentPath,
      message: `review-input.yaml 雛形用の仮文書は既に存在します: ${placeholderDocumentPath}`
    }
  }

  await fs.mkdir(path.dirname(placeholderDocumentPath), { recursive: true })
  await fs.writeFile(placeholderDocumentPath, REVIEW_PLACEHOLDER_DOCUMENT_TEMPLATE, "utf8")
  return {
    status: "created",
    path: placeholderDocumentPath,
    message: `review-input.yaml 雛形用の仮文書を作成しました: ${placeholderDocumentPath}`
  }
}

function mergeStatus(statuses: Array<InitializeCodeConsistencyWorkspaceResult["status"]>): InitializeCodeConsistencyWorkspaceResult["status"] {
  if (statuses.includes("updated")) return "updated"
  if (statuses.includes("created")) return "created"
  return "unchanged"
}

async function readIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8")
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined
    throw error
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error
}

function timestampForFileName(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}
