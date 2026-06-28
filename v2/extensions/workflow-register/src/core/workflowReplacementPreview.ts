import { ValidateWorkflowResult, validateWorkflowText } from "./workflowValidator"

export interface WorkflowReplacementCandidate {
  filePath: string
  workflowName: string
  originalMarkdown: string
  replacementMarkdown: string
  validation: ValidateWorkflowResult
  canApply: boolean
  backupRelativePath: string
}

export interface WorkflowReplacementInput {
  sourceId: string
  filePath: string
  originalMarkdown: string
  replacementMarkdown: string
  now?: Date
}

export function createWorkflowReplacementCandidate(input: WorkflowReplacementInput): WorkflowReplacementCandidate {
  const workflowName = workflowNameFromPath(input.filePath)
  const validation = validateWorkflowText({ sourceId: input.sourceId, filePath: input.filePath, text: input.replacementMarkdown })
  return {
    filePath: input.filePath,
    workflowName,
    originalMarkdown: input.originalMarkdown,
    replacementMarkdown: input.replacementMarkdown,
    validation,
    canApply: validation.ok,
    backupRelativePath: buildWorkflowBackupPath(input.filePath, input.now ?? new Date())
  }
}

export function buildWorkflowBackupPath(filePath: string, now: Date): string {
  const workflowName = workflowNameFromPath(filePath)
  return `.bob/workflows/.backups/${workflowName}/${timestampForPath(now)}-WORKFLOW.md`
}

export function workflowNameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/")
  const match = normalized.match(/(?:^|\/)\.bob\/workflows\/([^/]+)\/WORKFLOW\.md$/)
  if (match?.[1]) return sanitizePathSegment(match[1])
  const parts = normalized.split("/").filter(Boolean)
  return sanitizePathSegment(parts.length >= 2 ? parts[parts.length - 2] : "workflow")
}

export function previewFileNameForWorkflow(filePath: string, now: Date): string {
  return `${workflowNameFromPath(filePath)}-${timestampForPath(now)}-replacement-WORKFLOW.md`
}

export function timestampForPath(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "") || "workflow"
}
