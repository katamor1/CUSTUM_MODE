import { RunStepState, WorkflowRunState } from "./model"
import { TaskSnapshotSummary } from "./taskSnapshots"

export interface WorkflowRunDiagnosticReport {
  title: string
  summary: string
  lines: string[]
}

export interface WorkflowRunDiagnosticOptions {
  snapshotsByRunId?: Record<string, TaskSnapshotSummary[]>
}

export function buildWorkflowRunDiagnosticReport(runs: WorkflowRunState[], options: WorkflowRunDiagnosticOptions = {}): WorkflowRunDiagnosticReport {
  const lines = runs.length === 0 ? ["- No workflow runs were found."] : runs.flatMap((run) => [...formatWorkflowRunDiagnostics(run, { snapshots: options.snapshotsByRunId?.[run.runId] ?? [] }), ""])
  if (lines[lines.length - 1] === "") lines.pop()
  const failed = runs.filter((run) => run.status === "failed").length
  const paused = runs.filter((run) => run.status === "paused").length
  const reviewing = runs.filter((run) => run.status === "reviewing").length
  const held = runs.filter((run) => run.status === "held").length
  const attempts = runs.reduce((sum, run) => sum + run.steps.reduce((stepSum, step) => stepSum + (step.attempts?.length ?? 0), 0), 0)
  const pausedPart = paused > 0 ? ` ${paused} paused;` : ""
  return {
    title: "Workflow Run Diagnostics",
    summary: `${runs.length} run(s); ${failed} failed;${pausedPart} ${reviewing} reviewing; ${held} held; ${attempts} archived attempt(s).`,
    lines
  }
}

export function formatWorkflowRunDiagnostics(run: WorkflowRunState, options: { snapshots?: TaskSnapshotSummary[] } = {}): string[] {
  const lines = [
    `## ${run.runId}`,
    "",
    `- status: ${run.status}`,
    `- workflow: ${run.workflowId}`,
    `- workflow name: ${run.workflowName}`,
    `- current step: ${run.currentStep ?? "none"}`,
    `- updated: ${run.updatedAt}`
  ]
  if (run.error) {
    lines.push(`- error: ${run.error}`)
    const hint = workflowRunFailureHint(run.error)
    if (hint) lines.push(`- suggested fix: ${hint}`)
  }
  if (run.state["workflow.definitionMismatch"]) lines.push(`- workflow definition mismatch: ${run.state["workflow.definitionMismatch"]}`)
  if (run.state["workflow.pause"]) lines.push("", "Pause:", ...formatJsonState(run.state["workflow.pause"]))
  const problemStep = currentProblemStep(run)
  if (problemStep) {
    lines.push("", "Current attention step:", `- id: ${problemStep.id}`, `- title: ${problemStep.title}`, `- type: ${problemStep.type}`, `- status: ${problemStep.status}`, `- current attempt: ${problemStep.attempt ?? 1}`, `- archived attempts: ${problemStep.attempts?.length ?? 0}`)
    if (problemStep.reviewStartedAt) lines.push(`- review started: ${problemStep.reviewStartedAt}`)
    if (problemStep.acceptedAt) lines.push(`- accepted: ${problemStep.acceptedAt}`)
    if (problemStep.error) {
      lines.push(`- step error: ${problemStep.error}`)
      const hint = workflowRunFailureHint(problemStep.error)
      if (hint) lines.push(`- step suggested fix: ${hint}`)
    }
  }
  const stateKeys = Object.keys(run.state).sort()
  lines.push("", "State:", stateKeys.length === 0 ? "- no state values captured" : `- keys: ${stateKeys.join(", ")}`)
  if (run.state["workflow.preflightWarnings"]) lines.push(`- preflight warnings: ${run.state["workflow.preflightWarnings"]}`)
  lines.push("", "Steps:")
  for (const step of run.steps) {
    lines.push(`- ${step.id}: ${step.status}; attempt=${step.attempt ?? 1}; archivedAttempts=${step.attempts?.length ?? 0}${step.reviewStartedAt ? `; reviewStartedAt=${step.reviewStartedAt}` : ""}${step.acceptedAt ? `; acceptedAt=${step.acceptedAt}` : ""}${step.error ? `; error=${step.error}` : ""}`)
    appendAttemptSummaries(lines, step)
  }
  appendTaskSnapshots(lines, run, options.snapshots ?? [])
  return lines
}

export function workflowRunFailureHint(error: string): string | undefined {
  if (error.includes("Unsupported action provider")) return "Register an ActionProvider for this provider id, or replace the command step with vscode.executeCommand."
  if (error.includes("vscode.executeCommand requires the command id")) return "Put the VS Code command id as the first item in action.args."
  if (error.includes("Command is denied by workflow guardrails")) return "Remove the command from deniedCommands or choose a safer command."
  if (error.includes("Command is not allowed by workflow guardrails")) return "Add the provider id to allowedCommands or remove the allowlist."
  if (error.includes("Agent provider is required")) return "Configure workflowRegister.agentCommand or register an AgentProvider through the extension API."
  if (error.includes("Workflow preflight failed")) return "Fix missing required files or failing preflight checks before running the workflow again."
  if (error.includes("Required workflow file is missing")) return "Create the missing file or remove it from requires.files/preflight.files."
  if (error.includes("Workflow state is missing")) return "Check resultKey/stateKey spelling and ensure the producing step runs before the consuming step."
  if (error.includes("Result file path escapes the workspace")) return "Use a relative artifact or result path inside the workspace."
  if (error.includes("Unsupported result sink")) return "Register a result sink for this sink type or use the built-in file sink."
  if (error.includes("Unsupported result command")) return "Allow or replace the command result sink. File sinks are usually safer for generated artifacts."
  if (error.includes("waiting for step review")) return "Accept the current step, or retry it after adjusting the workflow step definition."
  if (error.includes("Workflow definition changed")) return "Enable stepReview.allowEditBeforeRetry or retry with the original workflow definition."
  if (error.includes("Workflow step order/id changed")) return "Keep completed step ids and order stable while retrying a run."
  return undefined
}

function currentProblemStep(run: WorkflowRunState): RunStepState | undefined {
  return run.steps.find((step) => step.id === run.currentStep && (step.status === "failed" || step.status === "held" || step.status === "reviewing"))
    ?? run.steps.find((step) => step.status === "failed" || step.status === "held" || step.status === "reviewing")
}

function formatJsonState(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    return Object.entries(parsed).map(([key, entry]) => `- ${key}: ${String(entry)}`)
  } catch {
    return [`- ${value}`]
  }
}

function appendAttemptSummaries(lines: string[], step: RunStepState): void {
  const attempts = step.attempts ?? []
  if (attempts.length === 0) return
  for (const attempt of attempts) {
    const stateKeys = Object.keys(attempt.stateSnapshot ?? {}).sort()
    lines.push(`  - attempt ${attempt.attempt}: ${attempt.status}; createdAt=${attempt.createdAt}; stateKeys=${stateKeys.length === 0 ? "none" : stateKeys.join(",")}${attempt.error ? `; error=${attempt.error}` : ""}`)
  }
}

function appendTaskSnapshots(lines: string[], run: WorkflowRunState, snapshots: TaskSnapshotSummary[]): void {
  if (snapshots.length === 0) return
  lines.push("", "Task snapshots:")
  for (const snapshot of snapshots) {
    const notes: string[] = []
    if (snapshot.workflowDefinitionHash && run.workflowDefinitionHash && snapshot.workflowDefinitionHash !== run.workflowDefinitionHash) notes.push("workflow hash mismatch")
    if (run.currentStep && snapshot.stepId !== run.currentStep) notes.push("step mismatch")
    if (snapshot.truncated) notes.push("truncated")
    if (snapshot.handoffError) notes.push(`handoffError=${snapshot.handoffError}`)
    const suffix = notes.length > 0 ? `; ${notes.join("; ")}` : ""
    lines.push(`- ${snapshot.createdAt}: ${snapshot.reason}; step=${snapshot.stepId}; lastAssistantText=${snapshot.hasLastAssistantText ? "yes" : "no"}${suffix}`)
  }
}
