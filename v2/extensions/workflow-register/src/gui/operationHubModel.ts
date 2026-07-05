import * as path from "path"
import type { CoreWorkflowDefinition, WorkflowRunState } from "../core/model"

export const OPERATION_HUB_ALLOWED_ACTIONS = [
  "refresh",
  "openWorkflowBuilder",
  "validateWorkspaceWorkflows",
  "openRunControl",
  "openBazaarReview",
  "openConsistencyWizard",
  "runWorkflow",
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
}

export type OperationHubWorkflowInput = Pick<
  CoreWorkflowDefinition,
  "id" | "label" | "description" | "hidden" | "inputs" | "artifacts" | "category"
>

export interface OperationHubRunInput {
  root: string
  run: WorkflowRunState
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
  completedStepCount: number
  totalStepCount: number
  updatedAt: string
  root: string
  primaryActions: OperationHubAction[]
  artifacts: OperationHubArtifactSummary[]
}

export interface OperationHubModel {
  home: OperationHubHomeModel
  setupChecklist: OperationHubSetupItem[]
  workflowCatalog: OperationHubWorkflowSummary[]
  runMonitor: OperationHubRunSummary[]
}

export function buildOperationHubModel(input: OperationHubModelInput): OperationHubModel {
  const workflowCatalog = buildWorkflowCatalog(input.workflows)
  const runMonitor = input.runs
    .map((item) => summarizeRunForHub(item.root, item.run))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
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

export function summarizeRunForHub(root: string, run: WorkflowRunState): OperationHubRunSummary {
  const currentStep = run.steps.find((step) => step.id === run.currentStep)
  const completedStepCount = run.steps.filter((step) => step.status === "completed").length
  return {
    runId: run.runId,
    workflowId: run.workflowId,
    workflowName: run.workflowName || run.workflowId,
    status: run.status,
    statusLabel: statusLabel(run.status),
    currentStepLabel: currentStep ? `${currentStep.id}: ${currentStep.title}` : run.currentStep ?? "未選択",
    completedStepCount,
    totalStepCount: run.steps.length,
    updatedAt: run.updatedAt,
    root,
    primaryActions: actionsForRun(run),
    artifacts: artifactsForRun(root, run)
  }
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
          variant: "primary"
        } satisfies OperationHubAction
      ]
    }))
    .sort((a, b) => `${a.category}:${a.label}`.localeCompare(`${b.category}:${b.label}`, "ja"))
}

function actionsForRun(run: WorkflowRunState): OperationHubAction[] {
  const inspect = { id: "inspectRunControl", label: "詳細", commandId: "workflowRegister.inspectRunControl", runId: run.runId } as const
  const current = run.currentStep ? run.steps.find((step) => step.id === run.currentStep) : undefined
  switch (run.status) {
    case "reviewing":
      return [
        { id: "acceptAndRunNextStep", label: "承認して次へ", commandId: "workflowRegister.acceptAndRunNextStep", runId: run.runId, variant: "primary" },
        { id: "retryCurrentStep", label: "再試行", commandId: "workflowRegister.retryCurrentStep", runId: run.runId },
        inspect
      ]
    case "held":
      return [
        { id: "openManualStepPanel", label: "手順を開く", commandId: "workflowRegister.openManualStepPanel", runId: run.runId, variant: "primary" },
        { id: "runNextStep", label: "次へ", commandId: "workflowRegister.runNextStep", runId: run.runId },
        inspect
      ]
    case "paused":
      return [
        { id: "resumeRun", label: "再開", commandId: "workflowRegister.resumePausedRun", runId: run.runId, variant: "primary" },
        inspect
      ]
    case "failed":
      return [
        { id: "retryCurrentStep", label: "再試行", commandId: "workflowRegister.retryCurrentStep", runId: run.runId, variant: "primary" },
        inspect
      ]
    case "running":
      if (current?.status === "pending") {
        return [
          { id: "runNextStep", label: "次へ", commandId: "workflowRegister.runNextStep", runId: run.runId, variant: "primary" },
          inspect
        ]
      }
      return [
        { id: "pauseCurrentRun", label: "一時停止", commandId: "workflowRegister.pauseCurrentRun", runId: run.runId },
        inspect
      ]
    default:
      return [inspect]
  }
}

function artifactsForRun(root: string, run: WorkflowRunState): OperationHubArtifactSummary[] {
  return Object.entries(run.state)
    .filter(([, value]) => typeof value === "string")
    .map(([key, rawValue]) => ({ key, rawValue: String(rawValue) }))
    .filter((item) => looksLikeArtifactPath(item.rawValue))
    .map((item) => {
      const workspacePath = path.isAbsolute(item.rawValue) ? path.resolve(item.rawValue) : path.resolve(root, item.rawValue)
      return {
        label: item.key,
        displayPath: path.relative(root, workspacePath).replace(/\\/g, "/") || item.rawValue,
        workspacePath,
        action: {
          id: "openArtifact",
          label: "成果物を開く",
          commandId: "vscode.open",
          artifactPath: workspacePath
        } satisfies OperationHubAction
      }
    })
    .slice(0, 8)
}

function looksLikeArtifactPath(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.includes("\n") || trimmed.includes("\0")) return false
  if (trimmed.startsWith("..")) return false
  return /^\.bob[/-]/i.test(trimmed) || /^\.bob-/i.test(trimmed) || /\.(md|json|ya?ml|txt|csv|html)$/i.test(trimmed) || path.isAbsolute(trimmed)
}

function statusLabel(status: WorkflowRunState["status"]): string {
  switch (status) {
    case "running": return "実行中"
    case "paused": return "一時停止"
    case "checkpoint": return "分岐確認待ち"
    case "reviewing": return "人間確認待ち"
    case "held": return "手動操作待ち"
    case "completed": return "完了"
    case "failed": return "失敗"
    default: return status
  }
}
