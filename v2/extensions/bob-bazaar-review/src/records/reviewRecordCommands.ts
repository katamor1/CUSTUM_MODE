import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as vscode from "vscode"
import { resolveWorkspaceRelativePath } from "./reviewRecordPaths"
import { buildReviewRecordQualityGate } from "./reviewRecordCommandCore"
import {
  REVIEW_RECORD_SCHEMA_VERSION,
  type ReviewRecord,
  type ReviewTriage
} from "./reviewRecordTypes"
import {
  generateCampaignSummary,
  readReviewRecord,
  readTriage,
  validateReviewRecord,
  writeCampaignSummaryArtifacts,
  writeReviewPacketArtifactAtPath,
  writeReviewRecord,
  writeTriage
} from "./reviewRecordStore"
import { createTriageDraft, validateTriage } from "./reviewTriage"

export interface ReviewRecordCommandInput {
  workspaceRoot?: string
  campaignId?: string
  reviewId?: string
  recordId?: string
  targetId?: string
  reviewPacketPath?: string
  checklistPath?: string
  reviewResultJsonPath?: string
  reviewResultMarkdownPath?: string
  triageYamlPath?: string
  reviewPacketText?: string
  backupExistingPacket?: boolean
  workflow?: Record<string, unknown>
  vcs?: ReviewRecord["vcs"]
  metrics?: ReviewRecord["metrics"]
  schemaValid?: boolean
  triagedBy?: string
  triagedAt?: string
}

export function registerReviewRecordCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("bobBazaar.records.initCampaign", (input?: ReviewRecordCommandInput) => initReviewRecordCampaign(context, input)),
    vscode.commands.registerCommand("bobBazaar.records.createRecord", (input?: ReviewRecordCommandInput) => createReviewRecord(input)),
    vscode.commands.registerCommand("bobBazaar.records.validateRecord", (input?: ReviewRecordCommandInput) => validateReviewRecordCommand(input)),
    vscode.commands.registerCommand("bobBazaar.records.createTriage", (input?: ReviewRecordCommandInput) => createReviewTriage(input)),
    vscode.commands.registerCommand("bobBazaar.records.validateTriage", (input?: ReviewRecordCommandInput) => validateReviewTriageCommand(input)),
    vscode.commands.registerCommand("bobBazaar.records.generateSummary", (input?: ReviewRecordCommandInput) => generateReviewCampaignSummary(input))
  )
}

export async function initReviewRecordCampaign(context: vscode.ExtensionContext, input: ReviewRecordCommandInput = {}): Promise<{ status: "ok"; targetRoot: string }> {
  const workspaceRoot = await resolveWorkspaceRoot(input)
  const templateRoot = context.asAbsolutePath(path.join("templates", ".bob-review-records"))
  const targetRoot = path.join(workspaceRoot, ".bob-review-records")
  await copyMissingOnly(templateRoot, targetRoot)
  await vscode.window.showInformationMessage(`Bazaar review campaign template を初期化しました: ${targetRoot}`)
  return { status: "ok", targetRoot }
}

export async function createReviewRecord(input: ReviewRecordCommandInput = {}): Promise<{ status: "ok"; path: string; issues: string[] }> {
  const workspaceRoot = await resolveWorkspaceRoot(input)
  const campaignId = await resolveCampaignId(input)
  const reviewId = await resolveReviewId(input)
  const reviewResultJsonPath = input.reviewResultJsonPath ?? `.bob/review/results/${reviewId}.json`
  const reviewResultMarkdownPath = input.reviewResultMarkdownPath ?? `.bob/review/results/${reviewId}.md`
  const reviewPacketPath = input.reviewPacketPath ?? `.bob-review-records/campaigns/${campaignId}/records/${reviewId}/review-packet.md`
  const triageYamlPath = input.triageYamlPath ?? `.bob-review-records/campaigns/${campaignId}/records/${reviewId}/triage.yaml`
  if (typeof input.reviewPacketText === "string") {
    await writeReviewPacketArtifactAtPath(workspaceRoot, reviewPacketPath, input.reviewPacketText, {
      backupExisting: input.backupExistingPacket ?? true
    })
  }
  const reviewResult = await readJsonArtifact(workspaceRoot, reviewResultJsonPath)
  const qualityGate = buildReviewRecordQualityGate(reviewResult, input.schemaValid)

  const record: ReviewRecord = {
    schema_version: REVIEW_RECORD_SCHEMA_VERSION,
    campaign_id: campaignId,
    record_id: input.recordId ?? `${input.targetId ?? reviewId}-run-001`,
    review_id: reviewId,
    target_id: input.targetId,
    workflow: input.workflow ?? {
      workflow_id: "bazaar-project-rule-review",
      unavailable: true,
      status: "completed"
    },
    vcs: input.vcs ?? inferVcs(reviewResult),
    inputs: {
      review_packet_path: reviewPacketPath,
      checklist_path: input.checklistPath ?? ".bob/review/checklist.json"
    },
    outputs: {
      review_result_json: reviewResultJsonPath,
      review_result_markdown: reviewResultMarkdownPath,
      triage_yaml: triageYamlPath
    },
    quality_gate: qualityGate,
    metrics: input.metrics ?? defaultMetrics(reviewResult),
    notes: "notes.md"
  }

  const filePath = await writeReviewRecord(workspaceRoot, record)
  const issues = await validateReviewRecord(workspaceRoot, record)
  await showIssuesOrOk(issues, `Bazaar review record を作成しました: ${filePath}`)
  return { status: "ok", path: filePath, issues }
}

export async function validateReviewRecordCommand(input: ReviewRecordCommandInput = {}): Promise<{ status: "ok" | "error"; issues: string[] }> {
  const workspaceRoot = await resolveWorkspaceRoot(input)
  const campaignId = await resolveCampaignId(input)
  const reviewId = await resolveReviewId(input)
  const record = await readReviewRecord(workspaceRoot, campaignId, reviewId)
  const issues = await validateReviewRecord(workspaceRoot, record)
  await showIssuesOrOk(issues, "Bazaar review record は検証に通りました。")
  return { status: issues.length === 0 ? "ok" : "error", issues }
}

export async function createReviewTriage(input: ReviewRecordCommandInput = {}): Promise<{ status: "ok"; path: string; issues: string[] }> {
  const workspaceRoot = await resolveWorkspaceRoot(input)
  const campaignId = await resolveCampaignId(input)
  const reviewId = await resolveReviewId(input)
  const reviewResultPath = input.reviewResultJsonPath ?? `.bob/review/results/${reviewId}.json`
  const reviewResult = await readJsonArtifact(workspaceRoot, reviewResultPath)
  const triage = createTriageDraft(reviewResult, {
    triagedBy: input.triagedBy,
    triagedAt: input.triagedAt
  })
  const filePath = await writeTriage(workspaceRoot, campaignId, reviewId, triage)
  const issues = validateTriage(triage, reviewResult)
  await showIssuesOrOk(issues, `Bazaar review triage 雛形を作成しました: ${filePath}`)
  return { status: "ok", path: filePath, issues }
}

export async function validateReviewTriageCommand(input: ReviewRecordCommandInput = {}): Promise<{ status: "ok" | "error"; issues: string[] }> {
  const workspaceRoot = await resolveWorkspaceRoot(input)
  const campaignId = await resolveCampaignId(input)
  const reviewId = await resolveReviewId(input)
  const reviewResultPath = input.reviewResultJsonPath ?? `.bob/review/results/${reviewId}.json`
  const [triage, reviewResult] = await Promise.all([
    readTriage(workspaceRoot, campaignId, reviewId),
    readJsonArtifact(workspaceRoot, reviewResultPath)
  ])
  const issues = validateTriage(triage, reviewResult)
  await showIssuesOrOk(issues, "Bazaar review triage は検証に通りました。")
  return { status: issues.length === 0 ? "ok" : "error", issues }
}

export async function generateReviewCampaignSummary(input: ReviewRecordCommandInput = {}): Promise<{ status: "ok"; jsonPath: string; markdownPath: string }> {
  const workspaceRoot = await resolveWorkspaceRoot(input)
  const campaignId = await resolveCampaignId(input)
  const summary = await generateCampaignSummary(workspaceRoot, campaignId)
  const paths = await writeCampaignSummaryArtifacts(workspaceRoot, campaignId, summary)
  await vscode.window.showInformationMessage(`Bazaar review campaign summary を生成しました: ${paths.markdownPath}`)
  return { status: "ok", ...paths }
}

async function resolveWorkspaceRoot(input: ReviewRecordCommandInput): Promise<string> {
  if (input.workspaceRoot) return validateOpenWorkspaceRoot(input.workspaceRoot)
  const folders = vscode.workspace.workspaceFolders ?? []
  if (folders.length === 1) return folders[0].uri.fsPath
  const picked = await vscode.window.showWorkspaceFolderPick({ placeHolder: "Bazaar review record の workspace を選択" })
  if (!picked) throw new Error("workspaceRoot is required")
  return picked.uri.fsPath
}

function validateOpenWorkspaceRoot(value: string): string {
  const folders = vscode.workspace.workspaceFolders ?? []
  if (folders.length === 0) throw new Error("workspaceRoot requires an open workspace folder")
  const resolved = path.resolve(value)
  if (!folders.some((folder) => isInsideOrSame(folder.uri.fsPath, resolved))) {
    throw new Error(`workspaceRoot must be inside an open workspace folder: ${value}`)
  }
  return resolved
}

function isInsideOrSame(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

async function resolveCampaignId(input: ReviewRecordCommandInput): Promise<string> {
  if (input.campaignId) return input.campaignId
  const value = await vscode.window.showInputBox({
    title: "Bazaar review campaign id",
    prompt: "campaign_id を入力してください。",
    value: "phase1-bazaar-review-uat-001",
    validateInput: (text) => text.trim() ? undefined : "campaign_id は必須です。"
  })
  if (!value) throw new Error("campaignId is required")
  return value
}

async function resolveReviewId(input: ReviewRecordCommandInput): Promise<string> {
  if (input.reviewId) return input.reviewId
  const value = await vscode.window.showInputBox({
    title: "Bazaar review id",
    prompt: "review_id を入力してください。例: bazaar-r125-project-rule-review",
    validateInput: (text) => text.trim() ? undefined : "review_id は必須です。"
  })
  if (!value) throw new Error("reviewId is required")
  return value
}

async function readJsonArtifact(workspaceRoot: string, relativePath: string): Promise<any> {
  const absolute = resolveWorkspaceRelativePath(workspaceRoot, relativePath)
  return JSON.parse(await fs.readFile(absolute, "utf8"))
}

async function copyMissingOnly(sourceDir: string, targetDir: string): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true })
  const entries = await fs.readdir(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name)
    const targetPath = path.join(targetDir, entry.name)
    if (entry.isDirectory()) {
      await copyMissingOnly(sourcePath, targetPath)
    } else if (entry.isFile()) {
      try {
        await fs.access(targetPath)
      } catch {
        await fs.mkdir(path.dirname(targetPath), { recursive: true })
        await fs.copyFile(sourcePath, targetPath)
      }
    }
  }
}
async function showIssuesOrOk(issues: string[], okMessage: string): Promise<void> {
  if (issues.length === 0) {
    await vscode.window.showInformationMessage(okMessage)
  } else {
    await vscode.window.showWarningMessage(issues.join("\n"))
  }
}

function inferVcs(reviewResult: any): ReviewRecord["vcs"] {
  const vcs = reviewResult?.vcs ?? {}
  return {
    type: "bazaar",
    repository: typeof vcs.repository === "string" ? vcs.repository : ".",
    revision_mode: normalizeRevisionMode(vcs.revision_mode),
    revision: typeof vcs.revision === "string" ? vcs.revision : undefined,
    base_revision: typeof vcs.base_revision === "string" ? vcs.base_revision : undefined,
    target_revision: typeof vcs.target_revision === "string" ? vcs.target_revision : undefined
  }
}

function normalizeRevisionMode(mode: unknown): string {
  if (mode === "single" || mode === "singleRevision") return "singleRevision"
  if (mode === "range" || mode === "revisionRange") return "revisionRange"
  if (mode === "workingTree" || mode === "workingTreeSinceRevision") return "workingTreeSinceRevision"
  return "singleRevision"
}

function defaultMetrics(reviewResult: any): ReviewRecord["metrics"] {
  const findingsTotal = Array.isArray(reviewResult?.findings) ? reviewResult.findings.length : 0
  return {
    baseline_review_minutes: 0,
    bob_review_minutes: 0,
    human_triage_minutes: 0,
    findings_total: findingsTotal,
    findings_accepted: 0,
    findings_rejected: 0,
    findings_needs_investigation: findingsTotal,
    findings_deferred: 0
  }
}
