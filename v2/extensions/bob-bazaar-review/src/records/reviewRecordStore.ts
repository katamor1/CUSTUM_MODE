import * as fs from "node:fs/promises"
import * as path from "node:path"
import {
  campaignDirectory,
  recordDirectory,
  recordYamlPath,
  resolveWorkspaceRelativePath,
  summaryJsonPath,
  summaryMarkdownPath,
  triageYamlPath,
  validateWorkspaceRelativePath
} from "./reviewRecordPaths"
import {
  REVIEW_RECORD_SCHEMA_VERSION,
  TRIAGE_SCHEMA_VERSION,
  type CampaignSummary,
  type ReviewRecord,
  type ReviewTriage
} from "./reviewRecordTypes"
import { fromYaml, toYaml } from "./reviewRecordYaml"

export async function writeReviewRecord(workspaceRoot: string, record: ReviewRecord): Promise<string> {
  validateRecordIdentity(record)
  const filePath = recordYamlPath(workspaceRoot, record.campaign_id, record.review_id)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, toYaml(record), "utf8")
  return filePath
}

export async function readReviewRecord(workspaceRoot: string, campaignId: string, reviewId: string): Promise<ReviewRecord> {
  const filePath = recordYamlPath(workspaceRoot, campaignId, reviewId)
  return fromYaml<ReviewRecord>(await fs.readFile(filePath, "utf8"))
}

export async function writeTriage(workspaceRoot: string, campaignId: string, reviewId: string, triage: ReviewTriage): Promise<string> {
  if (triage.schema_version !== TRIAGE_SCHEMA_VERSION) {
    throw new Error(`triage.schema_version must be ${TRIAGE_SCHEMA_VERSION}`)
  }
  if (triage.review_id !== reviewId) {
    throw new Error(`triage.review_id must match ${reviewId}`)
  }
  const filePath = triageYamlPath(workspaceRoot, campaignId, reviewId)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, toYaml(triage), "utf8")
  return filePath
}

export async function writeReviewPacketArtifact(
  workspaceRoot: string,
  campaignId: string,
  reviewId: string,
  packetText: string,
  options: { backupExisting?: boolean; overwrite?: boolean } = {}
): Promise<{ packetPath: string; backupPaths: string[] }> {
  const packetPath = path.join(recordDirectory(workspaceRoot, campaignId, reviewId), "review-packet.md")
  const backupPaths: string[] = []
  await fs.mkdir(path.dirname(packetPath), { recursive: true })

  if (await exists(packetPath)) {
    if (options.backupExisting) {
      const backupPath = await nextBackupPath(packetPath)
      await fs.copyFile(packetPath, backupPath)
      backupPaths.push(backupPath)
    } else if (!options.overwrite) {
      throw new Error(`review packet artifact already exists: ${packetPath}`)
    }
  }

  await fs.writeFile(packetPath, packetText, "utf8")
  return { packetPath, backupPaths }
}

export async function readTriage(workspaceRoot: string, campaignId: string, reviewId: string): Promise<ReviewTriage> {
  const filePath = triageYamlPath(workspaceRoot, campaignId, reviewId)
  return fromYaml<ReviewTriage>(await fs.readFile(filePath, "utf8"))
}

export async function validateReviewRecord(workspaceRoot: string, record: ReviewRecord): Promise<string[]> {
  const issues: string[] = []
  if (record?.schema_version !== REVIEW_RECORD_SCHEMA_VERSION) {
    issues.push(`schema_version must be ${REVIEW_RECORD_SCHEMA_VERSION}`)
  }
  for (const fieldName of ["campaign_id", "record_id", "review_id"] as const) {
    if (typeof record?.[fieldName] !== "string" || !record[fieldName].trim()) {
      issues.push(`${fieldName} is required`)
    }
  }

  issues.push(...validateWorkspaceRelativePath(record?.inputs?.review_packet_path, "inputs.review_packet_path"))
  issues.push(...validateWorkspaceRelativePath(record?.inputs?.checklist_path, "inputs.checklist_path"))
  issues.push(...validateWorkspaceRelativePath(record?.outputs?.review_result_json, "outputs.review_result_json"))
  issues.push(...validateWorkspaceRelativePath(record?.outputs?.review_result_markdown, "outputs.review_result_markdown"))
  issues.push(...validateWorkspaceRelativePath(record?.outputs?.triage_yaml, "outputs.triage_yaml"))

  if (record?.quality_gate?.schema_valid !== true) {
    issues.push("quality_gate.schema_valid must be true for a valid review record")
  }

  for (const [fieldName, relativePath] of [
    ["inputs.review_packet_path", record?.inputs?.review_packet_path],
    ["outputs.review_result_json", record?.outputs?.review_result_json],
    ["outputs.review_result_markdown", record?.outputs?.review_result_markdown]
  ] as const) {
    if (typeof relativePath !== "string") continue
    try {
      const absolute = resolveWorkspaceRelativePath(workspaceRoot, relativePath)
      await fs.access(absolute)
    } catch (error: any) {
      issues.push(`${fieldName} artifact is not readable: ${error?.message ?? String(error)}`)
    }
  }

  return issues
}

export async function generateCampaignSummary(workspaceRoot: string, campaignId: string): Promise<CampaignSummary> {
  const root = campaignDirectory(workspaceRoot, campaignId)
  const recordsRoot = path.join(root, "records")
  const records = await readCampaignRecords(recordsRoot)
  const summary = emptyCampaignSummary(campaignId)

  for (const record of records) {
    summary.records_total += 1
    const status = String(record.workflow?.status ?? "")
    if (status === "completed") summary.completed += 1
    else if (status === "blocked") summary.blocked += 1
    else if (status === "failed") summary.failed += 1

    if (record.quality_gate?.schema_valid === true) {
      summary.schema_valid_records += 1
    } else {
      summary.schema_invalid_records += 1
    }

    switch (record.vcs?.revision_mode) {
      case "singleRevision":
        summary.singleRevision_count += 1
        break
      case "revisionRange":
        summary.revisionRange_count += 1
        break
      case "workingTreeSinceRevision":
      case "workingTree":
        summary.workingTree_count += 1
        break
    }

    summary.baseline_review_minutes_total += numberOrZero(record.metrics?.baseline_review_minutes)
    summary.bob_review_minutes_total += numberOrZero(record.metrics?.bob_review_minutes)
    summary.human_triage_minutes_total += numberOrZero(record.metrics?.human_triage_minutes)

    const triage = await tryReadTriage(workspaceRoot, campaignId, record.review_id)
    if (triage) {
      summary.findings_total += Array.isArray(triage.items) ? triage.items.length : 0
      summary.findings_accepted += numberOrZero(triage.summary?.accepted)
      summary.findings_rejected += numberOrZero(triage.summary?.rejected)
      summary.findings_needs_investigation += numberOrZero(triage.summary?.needs_investigation)
      summary.findings_deferred += numberOrZero(triage.summary?.deferred)
    } else {
      summary.triage_missing += 1
      summary.warnings.push(`triage missing for ${record.review_id}`)
    }
  }

  summary.estimated_minutes_saved =
    summary.baseline_review_minutes_total -
    summary.bob_review_minutes_total -
    summary.human_triage_minutes_total

  return summary
}

export async function writeCampaignSummaryArtifacts(workspaceRoot: string, campaignId: string, summary: CampaignSummary): Promise<{ jsonPath: string; markdownPath: string }> {
  const jsonPath = summaryJsonPath(workspaceRoot, campaignId)
  const markdownPath = summaryMarkdownPath(workspaceRoot, campaignId)
  await fs.mkdir(path.dirname(jsonPath), { recursive: true })
  await fs.writeFile(jsonPath, JSON.stringify(summary, null, 2) + "\n", "utf8")
  await fs.writeFile(markdownPath, renderCampaignSummaryMarkdown(summary), "utf8")
  return { jsonPath, markdownPath }
}

function validateRecordIdentity(record: ReviewRecord): void {
  if (record.schema_version !== REVIEW_RECORD_SCHEMA_VERSION) {
    throw new Error(`record.schema_version must be ${REVIEW_RECORD_SCHEMA_VERSION}`)
  }
  if (!record.campaign_id?.trim()) throw new Error("record.campaign_id is required")
  if (!record.record_id?.trim()) throw new Error("record.record_id is required")
  if (!record.review_id?.trim()) throw new Error("record.review_id is required")
}

async function readCampaignRecords(recordsRoot: string): Promise<ReviewRecord[]> {
  let entries: Array<import("node:fs").Dirent>
  try {
    entries = await fs.readdir(recordsRoot, { withFileTypes: true })
  } catch (error: any) {
    if (error?.code === "ENOENT") return []
    throw error
  }

  const records: ReviewRecord[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "_template") continue
    const filePath = path.join(recordsRoot, entry.name, "record.yaml")
    try {
      records.push(fromYaml<ReviewRecord>(await fs.readFile(filePath, "utf8")))
    } catch (error: any) {
      records.push({
        schema_version: REVIEW_RECORD_SCHEMA_VERSION,
        campaign_id: path.basename(path.dirname(recordsRoot)),
        record_id: entry.name,
        review_id: entry.name,
        quality_gate: { schema_valid: false },
        workflow: { status: "failed" },
        metrics: {},
        notes: `failed to read record.yaml: ${error?.message ?? String(error)}`
      })
    }
  }
  return records
}

async function tryReadTriage(workspaceRoot: string, campaignId: string, reviewId: string): Promise<ReviewTriage | undefined> {
  try {
    return await readTriage(workspaceRoot, campaignId, reviewId)
  } catch (error: any) {
    if (error?.code === "ENOENT") return undefined
    return undefined
  }
}

function emptyCampaignSummary(campaignId: string): CampaignSummary {
  return {
    campaign_id: campaignId,
    records_total: 0,
    completed: 0,
    failed: 0,
    blocked: 0,
    schema_valid_records: 0,
    schema_invalid_records: 0,
    singleRevision_count: 0,
    revisionRange_count: 0,
    workingTree_count: 0,
    findings_total: 0,
    findings_accepted: 0,
    findings_rejected: 0,
    findings_needs_investigation: 0,
    findings_deferred: 0,
    triage_missing: 0,
    baseline_review_minutes_total: 0,
    bob_review_minutes_total: 0,
    human_triage_minutes_total: 0,
    estimated_minutes_saved: 0,
    warnings: []
  }
}

function renderCampaignSummaryMarkdown(summary: CampaignSummary): string {
  const lines = [
    "# IBM Bob Bazaar レビュー実績サマリ",
    "",
    `- campaign_id: ${summary.campaign_id}`,
    "",
    "## 件数",
    "",
    "| 指標 | 値 |",
    "|---|---:|",
    `| records_total | ${summary.records_total} |`,
    `| schema_valid_records | ${summary.schema_valid_records} |`,
    `| schema_invalid_records | ${summary.schema_invalid_records} |`,
    `| triage_missing | ${summary.triage_missing} |`,
    "",
    "## Findings",
    "",
    "| 指標 | 値 |",
    "|---|---:|",
    `| findings_total | ${summary.findings_total} |`,
    `| findings_accepted | ${summary.findings_accepted} |`,
    `| findings_rejected | ${summary.findings_rejected} |`,
    `| findings_needs_investigation | ${summary.findings_needs_investigation} |`,
    `| findings_deferred | ${summary.findings_deferred} |`,
    "",
    "## 時間",
    "",
    "| 指標 | 分 |",
    "|---|---:|",
    `| baseline_review_minutes_total | ${summary.baseline_review_minutes_total} |`,
    `| bob_review_minutes_total | ${summary.bob_review_minutes_total} |`,
    `| human_triage_minutes_total | ${summary.human_triage_minutes_total} |`,
    `| estimated_minutes_saved | ${summary.estimated_minutes_saved} |`,
    "",
    "## Warnings",
    ""
  ]
  if (summary.warnings.length === 0) {
    lines.push("- none")
  } else {
    lines.push(...summary.warnings.map((warning) => `- ${warning}`))
  }
  lines.push("")
  return lines.join("\n")
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function nextBackupPath(filePath: string): Promise<string> {
  const first = `${filePath}.bak`
  if (!(await exists(first))) return first
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${filePath}.bak.${index}`
    if (!(await exists(candidate))) return candidate
  }
  throw new Error(`could not allocate backup path for ${filePath}`)
}
