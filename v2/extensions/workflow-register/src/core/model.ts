export type WorkflowSchemaVersion = "legacy" | "workflow-register/v1"
export type WorkflowStepType = "command" | "agent" | "manual" | "result"
export type RunStatus = "running" | "paused" | "reviewing" | "held" | "completed" | "failed"
export type StepRunStatus = "pending" | "running" | "reviewing" | "held" | "completed" | "failed"
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
  requireApproval?: WorkflowApprovalRuleDefinition[]
}

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

export interface WorkflowActionDefinition {
  provider: string
  args?: unknown
}

export type ResultSourceDefinition =
  | { source: "state"; stateKey: string; sinks: ResultSinkDefinition[] }
  | { source: "literal"; text: string; sinks: ResultSinkDefinition[] }
  | { source: "agent"; sinks: ResultSinkDefinition[] }

export type ResultSinkDefinition =
  | { type: "command"; command: string; args?: unknown[] }
  | { type: "file"; path: string; encoding?: BufferEncoding }

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
  engineSteps: EngineStep[]
}

export interface AgentExecutionInput {
  workflowId: string
  logicalWorkflowId?: string
  workflowRoot?: string
  workflowFile?: string
  workflowFolderName?: string
  runId: string
  stepId: string
  prompt: string
  inputs: Record<string, unknown>
  state: Record<string, string>
}

export interface AgentProvider {
  run: (input: AgentExecutionInput) => Promise<string> | string
}

export interface ParseWorkflowRequest {
  sourceId: string
  filePath: string
  text: string
}

export type ParseWorkflowResult =
  | { ok: true; workflow: CoreWorkflowDefinition; diagnostics: string[] }
  | { ok: false; diagnostics: string[] }

export interface ActionExecutionInput {
  args: unknown
  inputs: Record<string, unknown>
  state?: Record<string, string>
  workflowId?: string
  logicalWorkflowId?: string
  workflowRoot?: string
  workflowFile?: string
  workflowFolderName?: string
  runId?: string
  stepId?: string
  /**
   * Latest assistant text captured from the current workflow step chat.
   * Result handoff providers may use this to resume from an already generated artifact
   * instead of asking the agent to regenerate earlier outputs.
   */
  latestAssistantText?: string
  /** Alias for latestAssistantText when the text is being handed off as a step result. */
  resultText?: string
  /** Alias for latestAssistantText for providers that treat the value as a generated artifact. */
  artifactText?: string
}

export interface ActionExecutionResult {
  ok: boolean
  value?: unknown
  error?: string
}

export interface ResultSinkWriteInput {
  workflowId: string
  logicalWorkflowId?: string
  workflowRoot?: string
  workflowFile?: string
  workflowFolderName?: string
  runId: string
  stepId: string
  inputs?: Record<string, unknown>
  state?: Record<string, string>
  text: string
}

export interface ResultSinkWriteResult {
  ok: boolean
  value?: unknown
  path?: string
  error?: string
}

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
