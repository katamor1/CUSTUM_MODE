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
   * 現在の workflow step chat から取得した最新 assistant text。
   * result handoff provider はこれを使い、agent に再生成させず既存生成物から再開できる。
   */
  latestAssistantText?: string
  /** step result として渡す場合の latestAssistantText alias。 */
  resultText?: string
  /** 生成 artifact として扱う provider 向けの latestAssistantText alias。 */
  artifactText?: string
}

export interface ActionExecutionResult {
  ok: boolean
  value?: unknown
  error?: string
}
