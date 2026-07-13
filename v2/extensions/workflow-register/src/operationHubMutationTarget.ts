import { createHash } from "crypto"
import * as fs from "fs/promises"
import * as path from "path"
import type { WorkflowRunState } from "./core/model"
import { assertSafeWorkflowRunId, readContainedRunFile } from "./core/runtime/runStatePath"

export interface OperationHubRunMutationTarget {
  source: "operationHub"
  workspaceRoot: string
  runId: string
  expectedRevision: string
}

export interface OperationHubWorkflowMutationTarget {
  source: "operationHub"
  workspaceRoot: string
  workflowId: string
}

export interface OperationHubRunSnapshot {
  run: WorkflowRunState
  revision: string
}

export class OperationHubRefreshRequiredError extends Error {
  readonly code = "operation_hub_refresh_required"

  constructor(reason: string) {
    super(`${reason} Operation Hub を更新してから再実行してください。`)
    this.name = "OperationHubRefreshRequiredError"
  }
}

export function isOperationHubRunMutationTarget(value: unknown): value is OperationHubRunMutationTarget {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<Record<keyof OperationHubRunMutationTarget, unknown>>
  return candidate.source === "operationHub" &&
    typeof candidate.workspaceRoot === "string" &&
    typeof candidate.runId === "string" &&
    typeof candidate.expectedRevision === "string"
}

export function isOperationHubWorkflowMutationTarget(value: unknown): value is OperationHubWorkflowMutationTarget {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<Record<keyof OperationHubWorkflowMutationTarget, unknown>>
  return candidate.source === "operationHub" &&
    typeof candidate.workspaceRoot === "string" &&
    typeof candidate.workflowId === "string"
}

export async function canonicalOperationHubWorkspaceRoot(
  requestedRoot: string,
  candidateRoots: readonly string[]
): Promise<string> {
  if (!requestedRoot.trim()) throw refreshRequired("workspace root が指定されていません。")
  let requestedCanonical: string
  try {
    requestedCanonical = await fs.realpath(path.resolve(requestedRoot))
  } catch {
    throw refreshRequired("指定された workspace root は存在しません。")
  }
  for (const candidateRoot of candidateRoots) {
    let candidateCanonical: string
    try {
      candidateCanonical = await fs.realpath(path.resolve(candidateRoot))
    } catch {
      continue
    }
    if (sameCanonicalPath(candidateCanonical, requestedCanonical)) return candidateCanonical
  }
  throw refreshRequired("指定された workspace root は現在の候補ではありません。")
}

export async function readOperationHubRunSnapshot(
  workspaceRoot: string,
  runId: string
): Promise<OperationHubRunSnapshot> {
  let bytes: Uint8Array
  try {
    assertSafeWorkflowRunId(runId)
    bytes = (await readContainedRunFile(workspaceRoot, runId)).bytes
  } catch {
    throw refreshRequired(`run '${runId}' を再読込できません。`)
  }
  let run: WorkflowRunState
  try {
    run = JSON.parse(Buffer.from(bytes).toString("utf8")) as WorkflowRunState
  } catch {
    throw refreshRequired(`run '${runId}' の内容を再読込できません。`)
  }
  if (run.runId !== runId) throw refreshRequired(`run '${runId}' の識別子が変更されました。`)
  return { run, revision: operationHubContentRevision(bytes) }
}

export async function validateOperationHubRunMutationTarget(
  target: OperationHubRunMutationTarget,
  candidateRoots: readonly string[]
): Promise<{ workspaceRoot: string; snapshot: OperationHubRunSnapshot }> {
  if (!target.expectedRevision.trim()) throw refreshRequired("run revision が指定されていません。")
  const workspaceRoot = await canonicalOperationHubWorkspaceRoot(target.workspaceRoot, candidateRoots)
  const snapshot = await assertOperationHubRunRevision(workspaceRoot, target.runId, target.expectedRevision)
  return { workspaceRoot, snapshot }
}

export async function assertOperationHubRunRevision(
  workspaceRoot: string,
  runId: string,
  expectedRevision: string
): Promise<OperationHubRunSnapshot> {
  if (!expectedRevision.trim()) throw refreshRequired("run revision が指定されていません。")
  const snapshot = await readOperationHubRunSnapshot(workspaceRoot, runId)
  if (snapshot.revision !== expectedRevision) {
    throw refreshRequired(`run '${runId}' は表示後に更新されました。`)
  }
  return snapshot
}

export function operationHubContentRevision(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

export function refreshRequired(reason: string): OperationHubRefreshRequiredError {
  return new OperationHubRefreshRequiredError(reason)
}

function sameCanonicalPath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLocaleLowerCase() === right.toLocaleLowerCase()
    : left === right
}
