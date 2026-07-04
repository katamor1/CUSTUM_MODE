export interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface BazaarCommandResult {
  stdout: string
  stderr: string
  command: string
  args: string[]
  cwd: string
}

export interface McpTextContent {
  type: "text"
  text: string
}

export interface McpToolResponse {
  content: McpTextContent[]
}

export type RequiredAllowedCwd = (args: unknown, name: string) => Promise<string>

export interface CwdToolInput {
  cwd: string
}

export interface BazaarRevisionToolInput extends CwdToolInput {
  revision: string
}

export interface BazaarRevisionRangeToolInput extends CwdToolInput {
  baseRevision: string
  targetRevision: string
}

export interface BazaarWorkingTreeDiffToolInput extends CwdToolInput {
  baseRevision?: string
}

export interface BazaarCatRevisionToolInput extends BazaarRevisionToolInput {
  path: string
}

export interface ReviewJsonToolInput {
  json: string
}

export interface OptionalProjectRulesPathInput extends CwdToolInput {
  path?: string
}

export interface StoredReviewResultInput extends CwdToolInput {
  reviewId: string
}
