import type { RunStepState, WorkflowRunState } from "./model"
import { CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION } from "./runtime/runStateCodec"
import type { RunStateLoadDiagnostic } from "./runtime/runStateCodec"
import type { TaskSnapshotSummary } from "./taskSnapshots"

export interface WorkflowRunDiagnosticReport {
  title: string
  summary: string
  lines: string[]
}

export interface WorkflowRunDurabilitySummary {
  eventCount: number
  eventHeadHash?: string
  journalPending: boolean
  lockPresent: boolean
}

export interface WorkflowRunDiagnosticOptions {
  snapshotsByRunId?: Record<string, TaskSnapshotSummary[]>
  runDocumentDiagnostics?: RunStateLoadDiagnostic[]
  durabilityByRunId?: Record<string, WorkflowRunDurabilitySummary>
}

export function buildWorkflowRunDiagnosticReport(runs: WorkflowRunState[], options: WorkflowRunDiagnosticOptions = {}): WorkflowRunDiagnosticReport {
  const lines = runs.length === 0 ? ["- No workflow runs were found."] : runs.flatMap((run) => [
    ...formatWorkflowRunDiagnostics(run, {
      snapshots: options.snapshotsByRunId?.[run.runId] ?? [],
      durability: options.durabilityByRunId?.[run.runId]
    }),
    ""
  ])
  if (lines[lines.length - 1] === "") lines.pop()
  const documentDiagnostics = options.runDocumentDiagnostics ?? []
  if (documentDiagnostics.length > 0) {
    if (lines.length > 0) lines.push("")
    lines.push("Run document diagnostics:")
    for (const diagnostic of documentDiagnostics) {
      lines.push(`- ${diagnostic.runId} [${diagnostic.severity}/${diagnostic.code}]: ${diagnostic.message}`)
    }
  }
  const failed = runs.filter((run) => run.status === "failed").length
  const paused = runs.filter((run) => run.status === "paused").length
  const reviewing = runs.filter((run) => run.status === "reviewing").length
  const held = runs.filter((run) => run.status === "held").length
  const attempts = runs.reduce((sum, run) => sum + run.steps.reduce((stepSum, step) => stepSum + (step.attempts?.length ?? 0), 0), 0)
  const pausedPart = paused > 0 ? ` ${paused} paused;` : ""
  const documentPart = documentDiagnostics.length > 0 ? `; ${documentDiagnostics.length} run document diagnostic(s)` : ""
  const durabilityCount = Object.keys(options.durabilityByRunId ?? {}).length
  const durabilityPart = durabilityCount > 0 ? `; ${durabilityCount} run durability record(s)` : ""
  return {
    title: "Workflow Run Diagnostics",
    summary: `${runs.length} run(s); ${failed} failed;${pausedPart} ${reviewing} reviewing; ${held} held; ${attempts} archived attempt(s)${documentPart}${durabilityPart}.`,
    lines
  }
}

export function formatWorkflowRunDiagnostics(
  run: WorkflowRunState,
  options: { snapshots?: TaskSnapshotSummary[]; durability?: WorkflowRunDurabilitySummary } = {}
): string[] {
  const schemaVersion = run.schemaVersion ?? "unversioned"
  const lines = [
    `## ${run.runId}`,
    "",
    `- status: ${run.status}`,
    `- workflow: ${run.workflowId}`,
    `- workflow name: ${run.workflowName}`,
    `- run state schema: ${schemaVersion}`,
    `- current step: ${run.currentStep ?? "none"}`,
    `- updated: ${run.updatedAt}`
  ]
  if (run.schemaVersion && run.schemaVersion !== CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION) {
    lines.push("- run state access: read-only")
  }
  if (options.durability) {
    lines.push(
      "",
      "Run durability:",
      `- immutable events: ${options.durability.eventCount}`,
      `- event head: ${options.durability.eventHeadHash ?? "none"}`,
      `- journal: ${options.durability.journalPending ? "pending" : "none"}`,
      `- execution lease: ${options.durability.lockPresent ? "present" : "none"}`
    )
  }
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
  const branchingLines = formatBranchingDiagnostics(run)
  if (branchingLines.length > 0) lines.push("", ...branchingLines)
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

export function formatBranchingDiagnostics(run: WorkflowRunState): string[] {
  if (!run.branching) return []
  const lines: string[] = ["Branch loops:"]
  const loops = Object.values(run.branching.loops ?? {})
  if (loops.length === 0) {
    lines.push("- No branch loops recorded.")
  } else {
    for (const loop of loops) {
      lines.push(`- ${loop.loopId}: count=${loop.count}; allowed=${loop.allowed}; maxIterations=${loop.maxIterations}; extensionSize=${loop.extensionSize}; checkpoints=${loop.checkpointCount}; lastTransitionAt=${loop.lastTransitionAt ?? "none"}`)
    }
  }
  lines.push("", "Branch checkpoint:")
  const checkpoint = run.branching.checkpoint
  if (!checkpoint) {
    lines.push("- none")
  } else {
    lines.push(
      `- id: ${checkpoint.id}`,
      `- loopId: ${checkpoint.loopId}`,
      `- transition: ${checkpoint.fromStepId} -> ${checkpoint.toStepId}`,
      `- decisionId: ${checkpoint.decisionId}`,
      `- count: ${checkpoint.count}/${checkpoint.allowed}`,
      `- extensionSize: ${checkpoint.extensionSize}`,
      `- message: ${checkpoint.message}`
    )
  }
  lines.push("", "Branching history:")
  const history = run.branching.history ?? []
  if (history.length === 0) {
    lines.push("- No branch transitions recorded.")
  } else {
    for (const item of history) {
      lines.push(`- ${item.createdAt} ${item.action}: ${item.decisionId}; ${item.fromStepId} -> ${item.toStepId ?? "none"}; loop=${item.loopId ?? "none"}; count=${item.loopCount ?? "none"}`)
    }
  }
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
  if (error.includes("stale revision") || error.includes("changed since it was loaded")) return "Refresh the run and retry the operation against the latest persisted revision."
  if (error.includes("busy or locked")) return "Wait for the active workflow operation to finish, then refresh and retry."
  if (error.includes("journal")) return "Inspect the journal and event-log evidence before retrying; do not delete conflicting durability files."
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
