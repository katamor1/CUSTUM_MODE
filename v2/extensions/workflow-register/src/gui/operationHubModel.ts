import * as path from "path"
import {
  ARTIFACT_MANIFEST_STATE_KEY,
  ARTIFACT_REUSE_STATE_KEY,
  parseWorkflowArtifactManifest,
  type WorkflowArtifactManifest
} from "../core/artifacts"
import type { CoreWorkflowDefinition, WorkflowRunState } from "../core/model"
import { isWorkflowRunStateWritable } from "../core/runStateStore"

export const OPERATION_HUB_ALLOWED_ACTIONS = [
  "refresh",
  "openOperationHubPanel",
  "openWorkflowBuilder",
  "validateWorkspaceWorkflows",
  "openRunControl",
  "openBazaarReview",
  "openConsistencyWizard",
  "runWorkflow",
  "startFromArtifacts",
  "resumeRun",
  "retryCurrentStep",
  "acceptCurrentStep",
  "acceptAndRunNextStep",
  "runNextStep",
  "openManualStepPanel",
  "pauseCurrentRun",
  "inspectRunControl",
  "openArtifact"
] as const

export type OperationHubActionId = typeof OPERATION_HUB_ALLOWED_ACTIONS[number]
export type OperationHubStatus = "ok" | "warning" | "error" | "info"

export interface OperationHubAction {
  id: OperationHubActionId
  label: string
  commandId?: string
  workflowId?: string
  runId?: string
  workspaceRoot?: string
  expectedRevision?: string
  artifactPath?: string
  variant?: "primary" | "secondary" | "danger"
}

export interface OperationHubExtensionStatus {
  id: string
  label: string
  available: boolean
}

export interface OperationHubSetupState {
  bobRootPresent: boolean
  workflowsPresent: boolean
  runStatePresent: boolean
  mcpConfigPresent: boolean
  traceabilityPresent: boolean
}

export interface OperationHubModelInput {
  workspaceName: string
  workspaceRoots: string[]
  extensionStatus: OperationHubExtensionStatus[]
  setup: OperationHubSetupState
  workflows: OperationHubWorkflowInput[]
  runs: OperationHubRunInput[]
  focusedRunId?: string
  focusedWorkspaceRoot?: string
}

export type OperationHubWorkflowInput = Pick<
  CoreWorkflowDefinition,
  "id" | "label" | "description" | "hidden" | "inputs" | "artifacts" | "category" | "workflowRoot"
>

export interface OperationHubRunInput {
  root: string
  run: WorkflowRunState
  revision?: string
}

export interface OperationHubHomeModel {
  workspaceName: string
  workspaceRoots: string[]
  activeRunCount: number
  workflowCount: number
  recommendedActions: OperationHubAction[]
}

export interface OperationHubSetupItem {
  id: string
  label: string
  status: OperationHubStatus
  message: string
  action?: OperationHubAction
}

export interface OperationHubWorkflowSummary {
  id: string
  label: string
  description: string
  category: string
  requiredInputCount: number
  artifactCount: number
  primaryActions: OperationHubAction[]
}

export interface OperationHubArtifactSummary {
  label: string
  displayPath: string
  workspacePath: string
  action: OperationHubAction
}

export interface OperationHubRunSummary {
  runId: string
  workflowId: string
  workflowName: string
  status: WorkflowRunState["status"]
  statusLabel: string
  currentStepLabel: string
  bobTaskSyncLabel: string
  bobTaskSyncStatus: OperationHubStatus
  artifactManifestLabel?: string
  artifactManifestStatus?: OperationHubStatus
  artifactReuseLabel?: string
  artifactReuseStatus?: OperationHubStatus
  completedStepCount: number
  totalStepCount: number
  updatedAt: string
  root: string
  focused: boolean
  primaryActions: OperationHubAction[]
  artifacts: OperationHubArtifactSummary[]
}

export interface OperationHubModel {
  home: OperationHubHomeModel
  setupChecklist: OperationHubSetupItem[]
  workflowCatalog: OperationHubWorkflowSummary[]
  runMonitor: OperationHubRunSummary[]
}

interface ArtifactReuseState {
  sourceRunId?: string
  startStepId?: string
  reusedStepIds?: unknown[]
  hydratedKeys?: unknown[]
}

export function buildOperationHubModel(input: OperationHubModelInput): OperationHubModel {
  const workflowCatalog = buildWorkflowCatalog(input.workflows)
  const runMonitor = input.runs
    .map((item) => summarizeRunForHub(
      item.root,
      item.run,
      input.focusedRunId,
      item.revision,
      input.focusedWorkspaceRoot
    ))
    .sort((a, b) => Number(b.focused) - Number(a.focused) || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 20)
  const activeRunCount = runMonitor.filter((run) => !["completed", "failed"].includes(run.status)).length
  return {
    home: {
      workspaceName: input.workspaceName,
      workspaceRoots: input.workspaceRoots,
      activeRunCount,
      workflowCount: workflowCatalog.length,
      recommendedActions: buildRecommendedActions(activeRunCount)
    },
    setupChecklist: buildSetupChecklist(input.setup, input.extensionStatus),
    workflowCatalog,
    runMonitor
  }
}

export function summarizeRunForHub(
  root: string,
  run: WorkflowRunState,
  focusedRunId?: string,
  revision?: string,
  focusedWorkspaceRoot?: string
): OperationHubRunSummary {
  const currentStep = run.steps.find((step) => step.id === run.currentStep)
  const completedStepCount = run.steps.filter((step) => step.status === "completed").length
  const bobTaskSync = summarizeBobTaskSync(run)
  const manifest = artifactManifestForRun(run)
  const artifactReuse = summarizeArtifactReuse(run)
  return {
    runId: run.runId,
    workflowId: run.workflowId,
    workflowName: run.workflowName || run.workflowId,
    status: run.status,
    statusLabel: statusLabel(run),
    currentStepLabel: currentStep ? `${currentStep.id}: ${currentStep.title}` : run.currentStep ?? "未選択",
    bobTaskSyncLabel: bobTaskSync.label,
    bobTaskSyncStatus: bobTaskSync.status,
    artifactManifestLabel: manifest ? `Reusable artifacts: ${manifest.artifacts.length}` : undefined,
    artifactManifestStatus: manifest ? "ok" : undefined,
    artifactReuseLabel: artifactReuse?.label,
    artifactReuseStatus: artifactReuse?.status,
    completedStepCount,
    totalStepCount: run.steps.length,
    updatedAt: run.updatedAt,
    root,
    focused: run.runId === focusedRunId && (
      !focusedWorkspaceRoot || sameWorkspaceRoot(root, focusedWorkspaceRoot)
    ),
    primaryActions: actionsForRun(root, run, Boolean(manifest?.artifacts.length), revision),
    artifacts: artifactsForRun(root, run, manifest)
  }
}

function sameWorkspaceRoot(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.resolve(value)
    return process.platform === "win32" ? resolved.toLowerCase() : resolved
  }
  return normalize(left) === normalize(right)
}

function buildRecommendedActions(activeRunCount: number): OperationHubAction[] {
  const actions: OperationHubAction[] = [
    { id: "openBazaarReview", label: "Bazaar レビューを開始", commandId: "bobBazaar.openReviewGui", variant: "primary" },
    { id: "openConsistencyWizard", label: "整合プレレビューを開始", commandId: "bobCodeConsistency.openReviewWizard", variant: "primary" },
    { id: "openWorkflowBuilder", label: "ワークフローを作る", commandId: "workflowRegister.openWorkflowBuilder" },
    { id: "validateWorkspaceWorkflows", label: "セットアップを再確認", commandId: "workflowRegister.validateWorkspaceWorkflows" }
  ]
  if (activeRunCount > 0) {
    actions.splice(2, 0, { id: "openRunControl", label: "前回の続きを確認", commandId: "workflowRegister.inspectRunControl", variant: "primary" })
  }
  return actions
}

function buildSetupChecklist(setup: OperationHubSetupState, extensions: OperationHubExtensionStatus[]): OperationHubSetupItem[] {
  const items: OperationHubSetupItem[] = extensions.map((extension) => ({
    id: `extension:${extension.id}`,
    label: extension.label,
    status: extension.available ? "ok" : "warning",
    message: extension.available ? "有効化済みです。" : "未検出です。標準導線は表示しますが、実行時に拡張の導入が必要です。"
  }))
  items.push(
    {
      id: "bobRoot",
      label: ".bob",
      status: setup.bobRootPresent ? "ok" : "warning",
      message: setup.bobRootPresent ? ".bob が見つかりました。" : ".bob が未作成です。初期化またはテンプレート作成を実行してください。",
      action: setup.bobRootPresent ? undefined : { id: "openWorkflowBuilder", label: "ワークフローを作る", commandId: "workflowRegister.openWorkflowBuilder" }
    },
    {
      id: "workflows",
      label: ".bob/workflows",
      status: setup.workflowsPresent ? "ok" : "warning",
      message: setup.workflowsPresent ? "ワークフロー定義を検出しました。" : "ワークフロー定義が未検出です。",
      action: setup.workflowsPresent ? undefined : { id: "openWorkflowBuilder", label: "作成する", commandId: "workflowRegister.openWorkflowBuilder" }
    },
    {
      id: "runState",
      label: "run state",
      status: setup.runStatePresent ? "ok" : "info",
      message: setup.runStatePresent ? "実行履歴を検出しました。" : "まだ実行履歴はありません。"
    },
    {
      id: "mcpConfig",
      label: "Bazaar MCP",
      status: setup.mcpConfigPresent ? "ok" : "warning",
      message: setup.mcpConfigPresent ? ".bob/mcp.json を検出しました。" : "Bazaar 連携が必要な場合は MCP 設定を作成してください。",
      action: setup.mcpConfigPresent ? undefined : { id: "openBazaarReview", label: "Bazaar GUI を開く", commandId: "bobBazaar.openReviewGui" }
    },
    {
      id: "traceability",
      label: "traceability",
      status: setup.traceabilityPresent ? "ok" : "info",
      message: setup.traceabilityPresent ? "traceability sidecar を検出しました。" : "整合プレレビュー時に必要に応じて作成します。"
    }
  )
  return items
}

function buildWorkflowCatalog(workflows: OperationHubWorkflowInput[]): OperationHubWorkflowSummary[] {
  return workflows
    .filter((workflow) => !workflow.hidden)
    .map((workflow) => ({
      id: workflow.id,
      label: workflow.label || workflow.id,
      description: workflow.description || "",
      category: workflow.category || "未分類",
      requiredInputCount: Object.values(workflow.inputs || {}).filter((input) => Boolean(input.required)).length,
      artifactCount: workflow.artifacts?.length ?? 0,
      primaryActions: [
        {
          id: "runWorkflow",
          label: "開始",
          commandId: "workflowRegister.runWorkflow",
          workflowId: workflow.id,
          workspaceRoot: workflow.workflowRoot,
          variant: "primary"
        } satisfies OperationHubAction
      ]
    }))
    .sort((a, b) => `${a.category}:${a.label}`.localeCompare(`${b.category}:${b.label}`, "ja"))
}

function actionsForRun(root: string, run: WorkflowRunState, hasReusableArtifacts: boolean, revision?: string): OperationHubAction[] {
  const target = { runId: run.runId, workspaceRoot: root, expectedRevision: revision }
  const inspect = { id: "inspectRunControl", label: "詳細", commandId: "workflowRegister.inspectRunControl", ...target } as const
  if (!isWorkflowRunStateWritable(run)) return [inspect]
  const startFromArtifacts = hasReusableArtifacts
    ? {
      id: "startFromArtifacts",
      label: "成果物から開始",
      commandId: "workflowRegister.startFromStepWithArtifacts",
      workflowId: run.workflowId,
      ...target,
      variant: run.status === "completed" ? "primary" : "secondary"
    } satisfies OperationHubAction
    : undefined
  const withReuse = (actions: OperationHubAction[]) => startFromArtifacts ? [startFromArtifacts, ...actions] : actions
  const current = run.currentStep ? run.steps.find((step) => step.id === run.currentStep) : undefined
  switch (run.status) {
    case "reviewing":
      return withReuse([
        { id: "acceptAndRunNextStep", label: "承認して次へ", commandId: "workflowRegister.acceptAndRunNextStep", ...target, variant: "primary" },
        { id: "retryCurrentStep", label: "再試行", commandId: "workflowRegister.retryCurrentStep", ...target },
        inspect
      ])
    case "held":
      return withReuse([
        { id: "openManualStepPanel", label: "手順を開く", commandId: "workflowRegister.openManualStepPanel", ...target, variant: "primary" },
        { id: "runNextStep", label: "次へ", commandId: "workflowRegister.runNextStep", ...target },
        inspect
      ])
    case "paused":
      return withReuse([
        { id: "resumeRun", label: "再開", commandId: "workflowRegister.resumePausedRun", ...target, variant: "primary" },
        inspect
      ])
    case "failed":
      return withReuse([
        { id: "retryCurrentStep", label: "再試行", commandId: "workflowRegister.retryCurrentStep", ...target, variant: "primary" },
        inspect
      ])
    case "running":
      if (current?.status === "pending") {
        return withReuse([
          { id: "runNextStep", label: "次へ", commandId: "workflowRegister.runNextStep", ...target, variant: "primary" },
          inspect
        ])
      }
      return withReuse([
        { id: "pauseCurrentRun", label: "一時停止", commandId: "workflowRegister.pauseCurrentRun", ...target },
        inspect
      ])
    default:
      return withReuse([inspect])
  }
}

function artifactsForRun(root: string, run: WorkflowRunState, manifest?: WorkflowArtifactManifest): OperationHubArtifactSummary[] {
  const manifestArtifacts = (manifest?.artifacts ?? []).map((artifact) => artifactSummary(root, artifact.stateKey || artifact.id, artifact.path))
  const stateArtifacts = Object.entries(run.state)
    .filter(([, value]) => typeof value === "string")
    .map(([key, rawValue]) => ({ key, rawValue: String(rawValue) }))
    .filter((item) => item.key !== ARTIFACT_MANIFEST_STATE_KEY && looksLikeArtifactPath(item.rawValue))
    .map((item) => artifactSummary(root, item.key, item.rawValue))
  return uniqueArtifacts([...manifestArtifacts, ...stateArtifacts]).slice(0, 8)
}

function artifactSummary(root: string, label: string, rawPath: string): OperationHubArtifactSummary {
  const workspacePath = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(root, rawPath)
  return {
    label,
    displayPath: path.relative(root, workspacePath).replace(/\\/g, "/") || rawPath,
    workspacePath,
    action: {
      id: "openArtifact",
      label: "成果物を開く",
      commandId: "vscode.open",
      artifactPath: workspacePath
    } satisfies OperationHubAction
  }
}

function uniqueArtifacts(values: OperationHubArtifactSummary[]): OperationHubArtifactSummary[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = value.workspacePath
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function looksLikeArtifactPath(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.includes("\n") || trimmed.includes("\0")) return false
  if (trimmed.startsWith("..")) return false
  return /^\.bob[/-]/i.test(trimmed) || /^\.bob-/i.test(trimmed) || /\.(md|json|ya?ml|txt|csv|html)$/i.test(trimmed) || path.isAbsolute(trimmed)
}

function summarizeBobTaskSync(run: WorkflowRunState): { label: string; status: OperationHubStatus } {
  const sync = run.bobTaskSync
  const status = sync?.drift?.status ?? "unknown"
  const through = sync?.completedThroughStepId ? ` / through ${sync.completedThroughStepId}` : ""
  switch (status) {
    case "synced":
      return { label: `Bob Todo: synced${through}`, status: "ok" }
    case "taskUnavailable":
      return { label: "Bob Todo: repair pending; run.json is authoritative", status: "warning" }
    case "requiresNewBobTask":
      return { label: "Bob Todo: cannot rewind; start from run.json", status: "error" }
    case "repairFailed":
      return { label: "Bob Todo: repair failed; run.json is authoritative", status: "error" }
    case "repairPending":
      return { label: "Bob Todo: repair pending", status: "warning" }
    default:
      return { label: "Bob Todo: not linked yet", status: "info" }
  }
}

function summarizeArtifactReuse(run: WorkflowRunState): { label: string; status: OperationHubStatus } | undefined {
  const value = run.state[ARTIFACT_REUSE_STATE_KEY]
  if (typeof value !== "string") return undefined
  const parsed = parseJsonObject(value) as ArtifactReuseState | undefined
  if (!parsed) return undefined
  const reused = Array.isArray(parsed.reusedStepIds) ? parsed.reusedStepIds.length : 0
  const hydrated = Array.isArray(parsed.hydratedKeys) ? parsed.hydratedKeys.length : 0
  const source = parsed.sourceRunId ? ` from ${parsed.sourceRunId}` : ""
  const start = parsed.startStepId ? ` / start ${parsed.startStepId}` : ""
  return { label: `Artifacts reused: ${reused} step(s), ${hydrated} state key(s)${source}${start}`, status: "ok" }
}

function artifactManifestForRun(run: WorkflowRunState): WorkflowArtifactManifest | undefined {
  return parseWorkflowArtifactManifest(run.state[ARTIFACT_MANIFEST_STATE_KEY])
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function statusLabel(run: WorkflowRunState): string {
  const current = run.currentStep ? run.steps.find((step) => step.id === run.currentStep) : undefined
  if (run.status === "running" && current?.status === "pending") return "次ステップ実行待ち"
  switch (run.status) {
    case "running": return "実行中"
    case "paused": return "一時停止"
    case "checkpoint": return "分岐確認待ち"
    case "reviewing": return "人間確認待ち"
    case "held": return "手動操作待ち"
    case "completed": return "完了"
    case "failed": return "失敗"
    default: return run.status
  }
}
