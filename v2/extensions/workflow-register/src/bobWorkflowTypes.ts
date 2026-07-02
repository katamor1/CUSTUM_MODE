import type * as vscode from "vscode"
import type { ActionRegistry } from "./core/actionRegistry"
import type {
  CoreWorkflowDefinition,
  WorkflowGuardrailsDefinition,
  WorkflowInputDefinition,
  WorkflowStepExecutionDefinition
} from "./core/model"
import type { ResultSource } from "./resultHandoff"

export const DEFAULT_MAX_RESULT_BYTES = 20_000

export type StepCompletionMode = "auto" | "manual"
export type StepMessageMode = "full" | "current" | "silent" | "step"

export interface BobWorkflowTask {
  sendMessage?: (...args: unknown[]) => Promise<unknown> | Thenable<unknown> | unknown
  setStepComplete?: () => unknown
  startSubagent?: (prompt: string, preset?: unknown, mask?: unknown) => Promise<unknown> | Thenable<unknown> | unknown
  getMessages?: () => unknown[]
  getAllMetadata?: () => Record<string, unknown>
  toSerializable?: () => unknown
}

export interface BobWorkflowStep {
  id: string
  title: string
  execution: (task: BobWorkflowTask) => Promise<boolean>
}

export interface BobWorkflow {
  hidden?: boolean
  getId: () => string
  getLabel: () => string
  getMenuLabel: () => string
  getDescription: () => string
  getMode?: () => string
  isEnabled: (env?: { workspace?: string }) => Promise<boolean>
  getSteps: () => BobWorkflowStep[]
  getApprovalConfig: () => {
    allowed_permissions: string[]
    autoApprovalEnabled: boolean
  }
}

export interface WorkflowTodoItem {
  id: string
  text: string
  raw: string
}

export interface WorkflowStepDefinition {
  id: string
  prompt: string
  command?: string
  commandArgs: unknown[]
  sendResult: boolean
  required: boolean
  completeOnSuccess: boolean
  runAgent: boolean
  resultKey?: string
  includeState: string[]
  maxResultBytes: number
  stateRequired: boolean
  captureResult: boolean
  resultSource?: ResultSource
  resultCommand?: string
  resultCommandArgs: unknown[]
}

export interface WorkflowStepCommandResult {
  command: string
  ok: boolean
  value?: unknown
  error?: string
}

export interface WorkflowStateEntry {
  key: string
  value: string
}

export interface WorkflowDefinition {
  id: string
  logicalWorkflowId?: string
  name: string
  label: string
  menuLabel: string
  description: string
  prompt: string
  promptWithoutTodo: string
  command?: string
  commandArgs: unknown[]
  mode: string
  permissions: string[]
  autoApprovalEnabled: boolean
  workspaceRequired: boolean
  hidden: boolean
  todoEnabled: boolean
  todoRequired: boolean
  todoSource: string
  todoAsSteps: boolean
  stepCompletion: StepCompletionMode
  stepMessage: StepMessageMode
  stepExecution: WorkflowStepExecutionDefinition
  stepsById: Record<string, WorkflowStepDefinition>
  todos: WorkflowTodoItem[]
  inputs: Record<string, WorkflowInputDefinition>
  guardrails: WorkflowGuardrailsDefinition
  workflowRoot?: string
  workflowFile?: string
  workflowFolderName?: string
  file: vscode.Uri
  core: CoreWorkflowDefinition
}

export interface LoadResult {
  workflows: WorkflowDefinition[]
  coreWorkflows: CoreWorkflowDefinition[]
  diagnostics: string[]
}

export interface ActiveStep {
  key: string
  workflowId: string
  workflowLabel: string
  runId: string
  stepId: string
  title: string
  task: BobWorkflowTask
  stepDefinition?: WorkflowStepDefinition
  guardrails: WorkflowGuardrailsDefinition
  actionRegistry?: ActionRegistry
  inputs?: Record<string, unknown>
  state?: Record<string, string>
  messageStartIndex: number
  resolve: (value: boolean) => void
}

export type BobWorkflowRunnerInputCollector = (
  task: BobWorkflowTask,
  provided: Record<string, unknown>
) => Promise<Record<string, unknown> | undefined>
