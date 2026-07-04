export type ResultSinkDefinition =
  | { type: "command"; command: string; args?: unknown[] }
  | { type: "file"; path: string; encoding?: BufferEncoding }

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
