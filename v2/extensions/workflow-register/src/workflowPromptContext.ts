export interface WorkflowStateEntry {
  key: string
  value: string
}

export interface WorkflowPromptContextInput {
  workflowRoot?: string
  workflowFile?: string
  workflowFolderName?: string
  stateEntries?: WorkflowStateEntry[]
}

export function appendWorkflowContext(lines: string[], input: WorkflowPromptContextInput): void {
  const bazaarRepositoryRoot = bazaarRepositoryRootFromState(input.stateEntries ?? [])
  if (!input.workflowRoot && !input.workflowFile && !input.workflowFolderName && !bazaarRepositoryRoot) return

  lines.push("", "<workflow_context>")
  if (input.workflowRoot) lines.push(`<workflow_root>${escapeXmlText(input.workflowRoot)}</workflow_root>`)
  if (input.workflowFile) lines.push(`<workflow_file>${escapeXmlText(input.workflowFile)}</workflow_file>`)
  if (input.workflowFolderName) lines.push(`<workflow_folder_name>${escapeXmlText(input.workflowFolderName)}</workflow_folder_name>`)
  if (bazaarRepositoryRoot) lines.push(`<bazaar_repository_root>${escapeXmlText(bazaarRepositoryRoot)}</bazaar_repository_root>`)
  lines.push(
    "<path_rules>",
    "- workflow_root is already resolved; do not rediscover or infer the Bob workspace root.",
    "- Resolve .bob/... paths by joining the relative path to workflow_root. Normal reads and writes inside workflow_root are allowed.",
    "- Do not search parent directories, sibling workspace folders, or full workspace trees for .bob.",
    "- If a required .bob file is missing under workflow_root, report the missing file instead of widening the search.",
    "- For Bazaar repository operations, use bazaar_repository_root or reviewContext.workspacePath when present; do not infer a repository by scanning unrelated workspace folders.",
    "- workflow_root and bazaar_repository_root may be the same path. When they match, these rules still allow normal .bob and Bazaar operations inside that directory.",
    "</path_rules>",
    "</workflow_context>"
  )
}

function bazaarRepositoryRootFromState(stateEntries: WorkflowStateEntry[]): string | undefined {
  for (const entry of stateEntries) {
    if (entry.key !== "reviewContext") continue
    const parsed = parseObject(entry.value)
    const value = firstString(parsed.workspacePath, parsed.repositoryRoot, parsed.repositoryPath, parsed.repository)
    if (value) return value
  }
  return undefined
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value
  }
  return undefined
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
