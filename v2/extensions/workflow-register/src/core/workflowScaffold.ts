export type WorkflowTemplateKind =
  | "simple-agent"
  | "command-then-agent"
  | "manual-checklist"
  | "input-driven-agent"
  | "preflight-files"
  | "artifact-output"
  | "guarded-command"
  | "review-workflow"

export interface WorkflowScaffoldInput {
  name: string
  title: string
  description: string
  template: WorkflowTemplateKind
}

type WorkflowScaffoldStepCompletion = "auto" | "manual"
type WorkflowScaffoldStepMessage = "full" | "current" | "silent" | "step"
type WorkflowScaffoldStepReviewPauseAfter = "everyStep" | "agentAndCommand" | "none"

interface WorkflowHeaderOptions {
  stepCompletion?: WorkflowScaffoldStepCompletion
  stepMessage?: WorkflowScaffoldStepMessage
  stepReviewEnabled?: boolean
  stepReviewPauseAfter?: WorkflowScaffoldStepReviewPauseAfter
  stepReviewRequireAcceptBeforeNext?: boolean
}

export const workflowTemplates: Array<{ id: WorkflowTemplateKind; label: string; description: string }> = [
  { id: "simple-agent", label: "Simple Agent Workflow", description: "One AI step with a prompt." },
  { id: "command-then-agent", label: "Command then Agent Workflow", description: "One command step followed by one AI step." },
  { id: "manual-checklist", label: "Manual Checklist Workflow", description: "Several manual confirmation steps." },
  { id: "input-driven-agent", label: "Input Driven Agent Workflow", description: "Collects typed input before running an AI step." },
  { id: "preflight-files", label: "Preflight Files Workflow", description: "Checks required workspace files before running." },
  { id: "artifact-output", label: "Artifact Output Workflow", description: "Captures an AI result into a file artifact." },
  { id: "guarded-command", label: "Guarded Command Workflow", description: "Runs a command with guardrails and approval guidance." },
  { id: "review-workflow", label: "Review Workflow", description: "Collects context and produces a structured review." }
]

const WINDOWS_RESERVED_WORKFLOW_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9"
])

export function createWorkflowMarkdown(input: WorkflowScaffoldInput): string {
  const name = normalizeWorkflowName(input.name)
  const title = input.title.trim() || titleFromName(name)
  const description = input.description.trim() || `Run ${title}.`
  switch (input.template) {
    case "command-then-agent": return commandThenAgentTemplate(name, title, description)
    case "manual-checklist": return manualChecklistTemplate(name, title, description)
    case "input-driven-agent": return inputDrivenAgentTemplate(name, title, description)
    case "preflight-files": return preflightFilesTemplate(name, title, description)
    case "artifact-output": return artifactOutputTemplate(name, title, description)
    case "guarded-command": return guardedCommandTemplate(name, title, description)
    case "review-workflow": return reviewWorkflowTemplate(name, title, description)
    case "simple-agent":
    default: return simpleAgentTemplate(name, title, description)
  }
}

export function normalizeWorkflowName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^[._-]+/, "").replace(/[. ]+$/, "")
  return avoidWindowsReservedName(normalized || "new-workflow")
}

function avoidWindowsReservedName(name: string): string {
  const dotIndex = name.indexOf(".")
  const base = dotIndex < 0 ? name : name.slice(0, dotIndex)
  if (!WINDOWS_RESERVED_WORKFLOW_NAMES.has(base.toUpperCase())) return name
  return dotIndex < 0 ? `${name}-workflow` : `${base}-workflow${name.slice(dotIndex)}`
}

function quote(value: string): string {
  return JSON.stringify(value)
}

function titleFromName(name: string): string {
  return name.split(/[._-]+/).filter(Boolean).map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ") || "New Workflow"
}

function header(
  name: string,
  title: string,
  description: string,
  extra: string,
  options: WorkflowHeaderOptions = {}
): string {
  const stepCompletion = options.stepCompletion ?? "auto"
  const stepMessage = options.stepMessage ?? "current"
  const stepReviewEnabled = options.stepReviewEnabled ?? false
  const stepReviewPauseAfter = options.stepReviewPauseAfter ?? (stepReviewEnabled ? "agentAndCommand" : "none")
  const stepReviewRequireAcceptBeforeNext = options.stepReviewRequireAcceptBeforeNext ?? stepReviewEnabled
  return `---
schemaVersion: workflow-register/v1
name: ${name}
description: ${quote(description)}
title: ${quote(title)}
mode: agent
workspaceRequired: true
todo: false
todoRequired: false
todoAsSteps: false
stepCompletion: ${stepCompletion}
stepMessage: ${stepMessage}
stepExecution:
  mode: engineSteps
  allowOutOfOrder: false
  showInBob: true
stepReview:
  enabled: ${stepReviewEnabled}
  pauseAfter: ${stepReviewPauseAfter}
  requireAcceptBeforeNext: ${stepReviewRequireAcceptBeforeNext}
  allowRetry: true
  allowEditBeforeRetry: true
  preserveAttempts: true
${extra.trimEnd()}
---
# ${title}

## Goal

${description}
`
}

function simpleAgentTemplate(name: string, title: string, description: string): string {
  return header(name, title, description, `steps:
  - id: analyze
    title: Analyze
    type: agent
    prompt: |
      ${description}

      Summarize the result clearly and list any follow-up actions.`)
}

function commandThenAgentTemplate(name: string, title: string, description: string): string {
  return `${header(name, title, description, `guardrails:
  allowedCommands:
    - vscode.executeCommand
  allowedCommandIds:
    - example.commandId
steps:
  - id: collect-context
    title: Collect context
    type: command
    action:
      provider: vscode.executeCommand
      args:
        - example.commandId
    resultKey: collectedContext
    required: true
  - id: analyze
    title: Analyze context
    type: agent
    includeState:
      - collectedContext
    prompt: |
      Analyze the collected context and produce a concise result.`)}

## Setup

Replace example.commandId with a real VS Code command before running this workflow.
`
}

function manualChecklistTemplate(name: string, title: string, description: string): string {
  return header(name, title, description, `steps:
  - id: prepare
    title: Prepare inputs
    type: manual
    prompt: |
      Confirm that the required inputs and workspace files are ready.
    userAction:
      message: |
        Confirm that the required inputs and workspace files are ready.
      completeLabel: Ready
  - id: review
    title: Review result
    type: manual
    prompt: |
      Review the generated or collected result and note any issues.
    userAction:
      message: |
        Review the generated or collected result and note any issues.
      completeLabel: Reviewed
  - id: finish
    title: Finish workflow
    type: manual
    prompt: |
      Confirm that all follow-up actions are captured before completing the workflow.
    userAction:
      message: |
        Confirm that all follow-up actions are captured before completing the workflow.
      completeLabel: Finish`, { stepCompletion: "manual", stepMessage: "step" })
}

function inputDrivenAgentTemplate(name: string, title: string, description: string): string {
  return header(name, title, description, `inputs:
  target:
    type: string
    title: Target path or topic
    required: true
  outputStyle:
    type: select
    title: Output style
    required: true
    options:
      - concise
      - detailed
steps:
  - id: analyze
    title: Analyze input
    type: agent
    prompt: |
      Use the provided input values to complete the workflow.

      Target: {{inputs.target}}
      Output style: {{inputs.outputStyle}}`)
}

function preflightFilesTemplate(name: string, title: string, description: string): string {
  return header(name, title, description, `requires:
  workspace: true
  files:
    - package.json
preflight:
  - id: required-files
    title: Required files exist
    required: true
    files:
      - package.json
    failurePolicy: stop
steps:
  - id: inspect
    title: Inspect workspace
    type: agent
    prompt: |
      Inspect the required files and summarize whether the workspace is ready.`)
}

function artifactOutputTemplate(name: string, title: string, description: string): string {
  return header(name, title, description, `artifacts:
  - id: report
    producedBy: write-report
    path: .bob/artifacts/${name}-report.md
completion:
  includeArtifacts: true
steps:
  - id: analyze
    title: Analyze
    type: agent
    prompt: |
      ${description}

      Produce a Markdown report.
    resultKey: analysisReport
  - id: write-report
    title: Write report
    type: result
    result:
      source: state
      stateKey: analysisReport
      sinks:
        - type: file
          path: .bob/artifacts/${name}-report.md`)
}

function guardedCommandTemplate(name: string, title: string, description: string): string {
  return `${header(name, title, description, `guardrails:
  allowedCommands:
    - vscode.executeCommand
  allowedCommandIds:
    - example.safeCommand
  deniedCommandIds:
    - example.destructiveCommand
  requireApproval:
    - id: command-approval
      when: before-command
      message: Confirm that this command is safe for the current workspace.
steps:
  - id: run-safe-command
    title: Run safe command
    type: command
    action:
      provider: vscode.executeCommand
      args:
        - example.safeCommand
    resultKey: commandResult
  - id: summarize
    title: Summarize command result
    type: agent
    includeState:
      - commandResult
    prompt: |
      Summarize the command result and call out any risks.`)}

## Setup

Replace example.safeCommand with a real command and keep destructive command IDs in deniedCommandIds.
`
}

function reviewWorkflowTemplate(name: string, title: string, description: string): string {
  return header(name, title, description, `inputs:
  reviewScope:
    type: select
    title: Review scope
    required: true
    options:
      - code
      - docs
      - workflow
guardrails:
  allowedCommands:
    - vscode.executeCommand
  allowedCommandIds:
    - example.collectReviewContext
steps:
  - id: collect-review-context
    title: Collect review context
    type: command
    action:
      provider: vscode.executeCommand
      args:
        - example.collectReviewContext
    resultKey: reviewContext
  - id: review
    title: Review
    type: agent
    includeState:
      - reviewContext
    prompt: |
      Review the collected context for correctness, maintainability, and missing tests.
      Group findings by severity and include concrete next actions.`)
}
