import type { ActionRegistry } from "./actionRegistry"
import type {
  WorkflowPreflightCheckInput,
  WorkflowPreflightCheckResult
} from "./engine/preflight"
import type {
  AgentProvider,
  CoreWorkflowDefinition,
  EngineStep,
  WorkflowRunState
} from "./model"
import type { RunControlState, RunControlStore } from "./runControlStore"
import type { RunStateStore } from "./runStateStore"
import type { ResultSinkRegistry } from "./resultSinkRegistry"

export type WorkflowExecutionMode = "full" | "singleStep"

export interface RunWorkflowOptions {
  executionMode?: WorkflowExecutionMode
  stepId?: string
  allowOutOfOrder?: boolean
}

export interface WorkflowEngineEventInput {
  workflow: CoreWorkflowDefinition
  run: WorkflowRunState
  step?: EngineStep
  agentText?: string
  commandValue?: unknown
  error?: string
  pause?: RunControlState
}

export interface WorkflowExecutionHooks {
  onWorkflowStart?: (input: WorkflowEngineEventInput) => Promise<void> | void
  onStepStart?: (input: WorkflowEngineEventInput) => Promise<void> | void
  onCommandResult?: (input: WorkflowEngineEventInput) => Promise<void> | void
  onAgentOutput?: (input: WorkflowEngineEventInput) => Promise<void> | void
  onHandoffFailed?: (input: WorkflowEngineEventInput) => Promise<void> | void
  onStepHeld?: (input: WorkflowEngineEventInput) => Promise<void> | void
  onStepFailed?: (input: WorkflowEngineEventInput) => Promise<void> | void
  onStepCompleted?: (input: WorkflowEngineEventInput) => Promise<void> | void
  onStepReviewRequired?: (input: WorkflowEngineEventInput) => Promise<void> | void
  onRunPaused?: (input: WorkflowEngineEventInput) => Promise<void> | void
  onWorkflowCompleted?: (input: WorkflowEngineEventInput) => Promise<void> | void
  onWorkflowFailed?: (input: WorkflowEngineEventInput) => Promise<void> | void
}

export interface ManualCompletionInput {
  workflow: CoreWorkflowDefinition
  run: WorkflowRunState
  step: EngineStep
}

export interface ManualCompletionResult {
  completed: boolean
  error?: string
  stateUpdates?: Record<string, unknown>
  formValues?: Record<string, unknown>
  approval?: {
    decision: "approved" | "rejected"
    reason?: string
    comment?: string
  }
  decision?: "approved" | "rejected"
  reason?: string
  comment?: string
}

export interface RecoverResultTextInput {
  workflow: CoreWorkflowDefinition
  run: WorkflowRunState
  step: EngineStep
  reason: "handoff-failed" | "retry-agent-result" | "missing-result-text"
}

export interface WorkflowEngineOptions {
  actions: ActionRegistry
  resultSinks: ResultSinkRegistry
  runStore: RunStateStore
  runControlStore?: RunControlStore
  agentProvider?: AgentProvider
  workspaceAvailable?: () => Promise<boolean> | boolean
  fileExists?: (relativePath: string) => Promise<boolean> | boolean
  preflightChecks?: Record<
    string,
    (input: WorkflowPreflightCheckInput) => Promise<WorkflowPreflightCheckResult> | WorkflowPreflightCheckResult
  >
  strictPreflightChecks?: boolean
  hooks?: WorkflowExecutionHooks
  manualCompletion?: (input: ManualCompletionInput) => Promise<ManualCompletionResult> | ManualCompletionResult
  recoverResultText?: (input: RecoverResultTextInput) => Promise<string | undefined> | string | undefined
}

export interface ResumeRunOptions {
  workflow: CoreWorkflowDefinition
  completeHeldStep?: boolean
  executionMode?: WorkflowExecutionMode
}

export interface RetryRunOptions {
  executionMode?: WorkflowExecutionMode
}
