import type { CoreWorkflowDefinition } from "./modelSchema"

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
