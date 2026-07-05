import * as fs from "node:fs/promises"
import * as path from "node:path"
import {
  recordDirectory,
  recordYamlPath,
  resolveWorkspaceRelativePath,
  triageYamlPath,
  validateWorkspaceRelativePath
} from "./reviewRecordPaths"
import {
  REVIEW_RECORD_SCHEMA_VERSION,
  TRIAGE_SCHEMA_VERSION,
  type ReviewRecord,
  type ReviewTriage
} from "./reviewRecordTypes"
import { fromYaml, toYaml } from "./reviewRecordYaml"

export { generateCampaignSummary, writeCampaignSummaryArtifacts } from "./reviewRecordSummary"

/**
 * `.bob-review-records` 配下へ review record YAML を保存する。
 *
 * この file は review campaign の監査用生成物なので、書き込み前に schema と
 * record identity を固定し、後続 triage/summary が同じ ID を参照できる状態にする。
 */
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
  return writeReviewPacketFile(packetPath, packetText, options)
}

/**
 * workflow から指定された workspace-relative path へ review packet artifact を保存する。
 *
 * packet には差分や規約など機密になり得る内容が含まれるため、任意の絶対パスではなく
 * workspace containment を通過した path だけを生成物の出力先にする。
 */
export async function writeReviewPacketArtifactAtPath(
  workspaceRoot: string,
  packetRelativePath: string,
  packetText: string,
  options: { backupExisting?: boolean; overwrite?: boolean } = {}
): Promise<{ packetPath: string; backupPaths: string[] }> {
  const packetPath = resolvePacketArtifactPath(workspaceRoot, packetRelativePath)
  return writeReviewPacketFile(packetPath, packetText, options)
}

function resolvePacketArtifactPath(workspaceRoot: string, packetRelativePath: string): string {
  try {
    return resolveWorkspaceRelativePath(workspaceRoot, packetRelativePath)
  } catch (error: any) {
    throw new Error(`workspace-relative path escapes workspace: ${packetRelativePath}: ${error?.message ?? String(error)}`)
  }
}

async function writeReviewPacketFile(
  packetPath: string,
  packetText: string,
  options: { backupExisting?: boolean; overwrite?: boolean }
): Promise<{ packetPath: string; backupPaths: string[] }> {
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

function validateRecordIdentity(record: ReviewRecord): void {
  if (record.schema_version !== REVIEW_RECORD_SCHEMA_VERSION) {
    throw new Error(`record.schema_version must be ${REVIEW_RECORD_SCHEMA_VERSION}`)
  }
  if (!record.campaign_id?.trim()) throw new Error("record.campaign_id is required")
  if (!record.record_id?.trim()) throw new Error("record.record_id is required")
  if (!record.review_id?.trim()) throw new Error("record.review_id is required")
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
