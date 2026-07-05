import type { ResultSinkDefinition } from "./modelSinks"

/**
 * WORKFLOW.md から読み込む schema version の互換性契約。
 *
 * legacy は既存定義の継続読み込み用であり、新しい runtime metadata を追加しても
 * 既存 workflow の識別と移行判定に使う値はここで固定する。
 */
export type WorkflowSchemaVersion = "legacy" | "workflow-register/v1"
export type WorkflowStepType = "command" | "agent" | "manual" | "result"
export type WorkflowStepCompletionMode = "auto" | "manual"
export type WorkflowStepMessageMode = "full" | "current" | "silent" | "step"
export type WorkflowStepExecutionMode = "full" | "todo" | "engineSteps"
export type WorkflowFailurePolicy = "stop" | "continue" | "warn"
export type WorkflowStepReviewPauseAfter = "everyStep" | "agentAndCommand" | "none"

export interface WorkflowInputDefinition {
  type: "string" | "number" | "boolean" | "select"
  title?: string
  required?: boolean
  requiredWhen?: string
  prompt?: boolean
  default?: unknown
  options?: string[]
}

export interface WorkflowRequiresDefinition {
  workspace?: boolean
  bob?: {
    minVersion?: string
  }
  files?: string[]
}

export interface WorkflowPreflightDefinition {
  id: string
  title?: string
  required?: boolean
  checks?: string[]
  files?: string[]
  failurePolicy?: WorkflowFailurePolicy
}

export interface WorkflowToolDefinition {
  purpose?: string
  required?: boolean
  outputKey?: string
  inputSource?: string
  failurePolicy?: WorkflowFailurePolicy
}

export interface WorkflowApprovalRuleDefinition {
  id?: string
  when?: string
  message?: string
}

export interface WorkflowGuardrailsDefinition {
  allowedCommands?: string[]
  deniedCommands?: string[]
  allowedCommandIds?: string[]
  deniedCommandIds?: string[]
  requireApproval?: WorkflowApprovalRuleDefinition[]
}

/**
 * workflow step が生成した成果物の書き込み契約。
 *
 * artifact path はテンプレート展開後に result sink へ渡される生成物境界であり、
 * 未解決テンプレートや workspace 外 path の扱いは writer 側の安全確認に委ねる。
 */
export interface WorkflowArtifactDefinition {
  id: string
  producedBy?: string
  path: string
  schema?: string
}

export interface WorkflowCompletionDefinition {
  summary?: string
  includeArtifacts?: boolean
  validateResult?: boolean
  visualization?: {
    type?: string
    enabled?: boolean
  }
}

export interface WorkflowStepReviewDefinition {
  enabled: boolean
  pauseAfter: WorkflowStepReviewPauseAfter
  requireAcceptBeforeNext: boolean
  allowRetry: boolean
  allowEditBeforeRetry: boolean
  preserveAttempts: boolean
}

export interface WorkflowStepExecutionDefinition {
  mode: WorkflowStepExecutionMode
  allowOutOfOrder: boolean
  showInBob: boolean
}

export interface WorkflowBranchingDefinition {
  enabled: boolean
  loops: WorkflowBranchLoopDefinition[]
}

export interface WorkflowBranchLoopDefinition {
  id: string
  title?: string
  entryStep: string
  maxIterations: number
  extensionSize: number
  checkpoint?: WorkflowBranchCheckpointDefinition
}

export interface WorkflowBranchCheckpointDefinition {
  title?: string
  message?: string
}

export interface WorkflowStepTransitionDefinition {
  decisions: WorkflowTransitionDecisionDefinition[]
  default: WorkflowTransitionDefaultAction
}

export type WorkflowTransitionDefaultAction = string

export interface WorkflowTransitionDecisionDefinition {
  id: string
  when: WorkflowTransitionConditionDefinition
  goto: string
  loop?: string
}

export interface WorkflowTransitionConditionDefinition {
  stateKey: string
  equals?: unknown
  notEquals?: unknown
  in?: unknown[]
  exists?: boolean
  truthy?: boolean
}

export interface WorkflowManualFormDefinition {
  resultKey: string
  fields: WorkflowManualFormFieldDefinition[]
}

export interface WorkflowManualFormFieldDefinition {
  id: string
  title?: string
  type: "string" | "number" | "boolean" | "select"
  required?: boolean
  multiline?: boolean
  options?: string[]
}

export interface WorkflowManualApprovalDefinition {
  resultKey: string
  approveLabel?: string
  rejectLabel?: string
  message?: string
}

/**
 * action provider へ渡す command step の公開境界。
 *
 * provider ID は workflow 定義と拡張側 provider 登録を結び付ける互換性契約である。
 * args はテンプレート展開後に guardrails と承認判定へ渡されるため、型で信頼済みとは扱わない。
 */
export interface WorkflowActionDefinition {
  provider: string
  args?: unknown
}

export interface WorkflowUserActionDefinition {
  message?: string
  completeLabel?: string
  confirmOnComplete?: boolean
  confirmMessage?: string
}

export type ResultSourceDefinition =
  | { source: "state"; stateKey: string; sinks: ResultSinkDefinition[] }
  | { source: "literal"; text: string; sinks: ResultSinkDefinition[] }
  | { source: "agent"; sinks: ResultSinkDefinition[] }

export interface BaseEngineStep {
  id: string
  title: string
  type: WorkflowStepType
  required?: boolean
  prompt?: string
  sendResult?: boolean
  completeOnSuccess?: boolean
  includeState?: string[]
  maxResultBytes?: number
  stateRequired?: boolean
  transition?: WorkflowStepTransitionDefinition
  userAction?: WorkflowUserActionDefinition
}

export interface CommandEngineStep extends BaseEngineStep {
  type: "command"
  action: WorkflowActionDefinition
  resultKey?: string
}

export interface AgentEngineStep extends BaseEngineStep {
  type: "agent"
  resultKey?: string
  result?: ResultSourceDefinition
}

export interface ManualEngineStep extends BaseEngineStep {
  type: "manual"
  form?: WorkflowManualFormDefinition
  approval?: WorkflowManualApprovalDefinition
}

export interface ResultEngineStep extends BaseEngineStep {
  type: "result"
  result: ResultSourceDefinition
}

export type EngineStep = CommandEngineStep | AgentEngineStep | ManualEngineStep | ResultEngineStep

export interface WorkflowTodoDefinition {
  id: string
  title: string
  raw?: string
}

/**
 * parser と runtime が共有する正規化済み workflow 定義。
 *
 * schema 由来の値と runtime metadata を同じ object で運ぶため、ID、provider、
 * artifact、guardrails の互換性境界を下位 engine が読み違えないようここで固定する。
 */
export interface CoreWorkflowDefinition {
  id: string
  logicalWorkflowId?: string
  name: string
  label: string
  menuLabel?: string
  description: string
  schemaVersion: WorkflowSchemaVersion
  definitionHash?: string
  filePath?: string
  workflowRoot?: string
  workflowFile?: string
  workflowFolderName?: string
  prompt: string
  promptWithoutTodo: string
  command?: string
  commandArgs: unknown[]
  mode: string
  category?: string
  permissions: string[]
  autoApprovalEnabled: boolean
  workspaceRequired: boolean
  hidden: boolean
  todoEnabled: boolean
  todoRequired: boolean
  todoAsSteps: boolean
  stepCompletion: WorkflowStepCompletionMode
  stepMessage: WorkflowStepMessageMode
  stepExecution: WorkflowStepExecutionDefinition
  stepReview: WorkflowStepReviewDefinition
  todos: WorkflowTodoDefinition[]
  inputs: Record<string, WorkflowInputDefinition>
  requires: WorkflowRequiresDefinition
  preflight: WorkflowPreflightDefinition[]
  tools: Record<string, WorkflowToolDefinition>
  guardrails: WorkflowGuardrailsDefinition
  artifacts: WorkflowArtifactDefinition[]
  completion: WorkflowCompletionDefinition
  branching?: WorkflowBranchingDefinition
  engineSteps: EngineStep[]
}
