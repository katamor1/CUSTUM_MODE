import type { WorkflowSchemaVersion, WorkflowStepType } from "./modelSchema"

export type RunStatus = "running" | "paused" | "reviewing" | "held" | "completed" | "failed"
export type StepRunStatus = "pending" | "running" | "reviewing" | "held" | "completed" | "failed"

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
  createdAt: string
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
  steps: RunStepState[]
  createdAt: string
  updatedAt: string
  error?: string
}
