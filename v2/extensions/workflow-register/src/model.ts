import * as vscode from "vscode"

export type StepCompletion = "auto" | "manual"
export type StepMessage = "full" | "current" | "silent" | "step"

export interface BobWorkflowApi {
  registerSource?: (id: string, name?: string) => unknown
}

export interface BobTask {
  sendMessage?: (...args: unknown[]) => unknown
  setStepComplete?: () => unknown
  startSubagent?: (prompt: string, preset?: unknown, mask?: unknown) => unknown
  getMessages?: () => unknown[]
  getAllMetadata?: () => Record<string, unknown>
}

export interface BobWorkflow {
  hidden?: boolean
  getId: () => string
  getLabel: () => string
  getMenuLabel: () => string
  getDescription: () => string
  getMode: () => string
  isEnabled: (env?: { workspace?: string }) => Promise<boolean>
  getSteps: () => Array<{ id: string; title: string; execution: (task: BobTask) => Promise<boolean> }>
  getApprovalConfig: () => { allowed_permissions: string[]; autoApprovalEnabled: boolean }
}

export interface BobSourceLike {
  registerWorkflow?: (workflow: BobWorkflow) => unknown
  log?: (message: string) => unknown
}

export interface Todo {
  id: string
  text: string
  raw: string
}

export interface StepDef {
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
  resultSource?: "agent" | "lastAssistant"
  resultCommand?: string
  resultCommandArgs: unknown[]
}

export interface CommandResult {
  command: string
  ok: boolean
  value?: unknown
  error?: string
}

export interface WorkflowDef {
  id: string
  name: string
  label: string
  menuLabel: string
  description: string
  mode: string
  promptWithoutTodo: string
  command?: string
  commandArgs: unknown[]
  permissions: string[]
  autoApprovalEnabled: boolean
  workspaceRequired: boolean
  hidden: boolean
  todoEnabled: boolean
  todoAsSteps: boolean
  stepCompletion: StepCompletion
  stepMessage: StepMessage
  todos: Todo[]
  stepsById: Record<string, StepDef>
  file: vscode.Uri
}

export interface ActiveStep {
  key: string
  title: string
  workflowLabel: string
  stepId: string
  task: BobTask
  resolve: (value: boolean) => void
}
