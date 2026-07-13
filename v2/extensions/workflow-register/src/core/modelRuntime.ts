import type { WorkflowSchemaVersion, WorkflowStepExecutionMode, WorkflowStepType } from "./modelSchema"

export type RunStatus = "running" | "paused" | "checkpoint" | "reviewing" | "held" | "completed" | "failed"
export type StepRunStatus = "pending" | "running" | "reviewing" | "held" | "completed" | "failed"
export type BobTaskSyncDriftStatus = "unknown" | "synced" | "repairPending" | "taskUnavailable" | "requiresNewBobTask" | "repairFailed"

export interface RunStepAttempt {
  attempt: number
  status: StepRunStatus
  startedAt?: string
  completedAt?: string
  reviewStartedAt?: string
  acceptedAt?: string
  reviewDecision?: "accepted" | "rejected"
  reviewComment?: string
  error?: string
  stateSnapshot?: Record<string, string>
  branchDecisionId?: string
  branchLoopId?: string
  branchFromStepId?: string
  branchToStepId?: string
  branchLoopCount?: number
  createdAt: string
}

export interface WorkflowRunBranchingState {
  loops: Record<string, WorkflowBranchLoopState>
  checkpoint?: WorkflowBranchCheckpointState
  checkpointDecisions?: WorkflowBranchCheckpointDecisionRecord[]
  history: WorkflowBranchTransitionRecord[]
}

export interface WorkflowBranchLoopState {
  loopId: string
  count: number
  allowed: number
  maxIterations: number
  extensionSize: number
  checkpointCount: number
  lastTransitionAt?: string
}

export interface WorkflowBranchCheckpointState {
  id: string
  loopId: string
  fromStepId: string
  toStepId: string
  decisionId: string
  count: number
  allowed: number
  extensionSize: number
  message: string
  createdAt: string
}

export type WorkflowBranchCheckpointDecisionOutcome = "approved" | "aborted"

export interface WorkflowBranchCheckpointDecisionRecord {
  checkpointId: string
  outcome: WorkflowBranchCheckpointDecisionOutcome
  loopId: string
  ownerStepId: string
  targetStepId: string
  transitionDecisionId: string
  decidedAt: string
  reason?: string
}

export interface WorkflowBranchTransitionRecord {
  id: string
  loopId?: string
  decisionId: string
  fromStepId: string
  toStepId?: string
  action: "next" | "goto" | "end" | "fail" | "checkpoint"
  loopCount?: number
  createdAt: string
  conditionSnapshot?: unknown
}

export interface BobTaskSyncDriftState {
  status: BobTaskSyncDriftStatus
  reason?: string
  detectedAt?: string
  details?: string
}

export interface BobTaskSyncState {
  schemaVersion: "workflow-register/bob-task-sync/v1"
  projectionVersion: number
  mode?: WorkflowStepExecutionMode
  workflowDefinitionHash?: string
  completedThroughIndex: number
  completedThroughStepId?: string
  lastAppliedAt?: string
  lastCheckedAt?: string
  liveTaskAvailable?: boolean
  drift?: BobTaskSyncDriftState
}

export interface RunStepState {
  id: string
  title: string
  type: WorkflowStepType
  status: StepRunStatus
  attempt?: number
  attempts?: RunStepAttempt[]
  startedAt?: string
  completedAt?: string
  reviewStartedAt?: string
  acceptedAt?: string
  error?: string
}

export interface WorkflowRunState {
  schemaVersion?: string
  runId: string
  workflowId: string
  workflowName: string
  workflowSchemaVersion?: WorkflowSchemaVersion
  workflowDefinitionHash?: string
  workflowFile?: string
  engineVersion?: string
  status: RunStatus
  currentStep?: string
  inputs: Record<string, unknown>
  state: Record<string, string>
  branching?: WorkflowRunBranchingState
  bobTaskSync?: BobTaskSyncState
  steps: RunStepState[]
  createdAt: string
  updatedAt: string
  error?: string
}
