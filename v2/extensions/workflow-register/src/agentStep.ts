import {
  appendWorkflowContext,
  appendWorkflowStateDataBlock,
  type WorkflowStateEntry
} from "./workflowPromptContext"
import type { AgentExecutionInput } from "./core/model"

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

export interface WorkflowAgentExecutionPromptInput {
  execution: AgentExecutionInput
  workflowName: string
  workflowRoot?: string
  workflowFile?: string
  workflowFolderName?: string
  stepIndex: number
  stepTitle: string
  workflowInstructions: string
  includeState: string[]
}

export function buildWorkflowAgentExecutionPrompt(input: WorkflowAgentExecutionPromptInput): string {
  const execution = input.execution
  return buildWorkflowAgentPrompt({
    workflowId: execution.workflowId,
    workflowName: input.workflowName,
    workflowRoot: execution.workflowRoot ?? input.workflowRoot,
    workflowFile: execution.workflowFile ?? input.workflowFile,
    workflowFolderName: execution.workflowFolderName ?? input.workflowFolderName,
    stepIndex: input.stepIndex,
    stepId: execution.stepId,
    stepTitle: input.stepTitle,
    stepPrompt: execution.prompt,
    workflowInstructions: input.workflowInstructions,
    stateEntries: stateEntriesFromRecord(execution.state, input.includeState)
  })
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

function stateEntriesFromRecord(state: Record<string, string>, keys: string[]): WorkflowStateEntry[] {
  return keys.flatMap((key) => state[key] === undefined ? [] : [{ key, value: state[key] }])
}
