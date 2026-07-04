import {
  appendWorkflowContext,
  appendWorkflowStateDataBlock,
  type WorkflowStateEntry
} from "./workflowPromptContext"

export interface WorkflowAgentPromptInput {
  workflowId: string
  workflowName: string
  workflowRoot?: string
  workflowFile?: string
  workflowFolderName?: string
  stepIndex: number
  stepId: string
  stepTitle: string
  stepPrompt: string
  workflowInstructions: string
  stateEntries: WorkflowStateEntry[]
}

export function buildWorkflowAgentPrompt(input: WorkflowAgentPromptInput): string {
  const lines = [
    "You are executing one automated Bob workflow step as an AI subagent.",
    "Complete only the current workflow step. Return the exact result text that should be shown to the user.",
    "",
    "Workflow:",
    `- id: ${input.workflowId}`,
    `- name: ${input.workflowName}`,
    ""
  ]
  appendWorkflowContext(lines, {
    workflowRoot: input.workflowRoot,
    workflowFile: input.workflowFile,
    workflowFolderName: input.workflowFolderName,
    stateEntries: input.stateEntries
  })
  lines.push(
    `<workflow_step index="${input.stepIndex + 1}" id="${escapeXmlAttribute(input.stepId)}">`,
    `Title: ${input.stepTitle}`,
    "",
    "<workflow_step_instructions>",
    input.stepPrompt,
    "</workflow_step_instructions>",
    "</workflow_step>",
    "",
    "<workflow_instructions>",
    input.workflowInstructions,
    "</workflow_instructions>"
  )
  appendWorkflowStateDataBlock(lines, input.stateEntries)
  return lines.join("\n")
}

export function extractSubagentResult(value: unknown): string | undefined {
  if (typeof value === "string") return trimToResult(value)
  if (typeof value === "object" && value !== null && "result" in value) return trimToResult((value as { result?: unknown }).result)
  return undefined
}

function trimToResult(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function escapeXmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
