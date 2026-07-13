import * as vscode from "vscode"
import { FileRunControlStore, RunPauseMode } from "../core/runControlStore"
import { FileRunStateStore } from "../core/runStateStore"
import { fallbackWorkspaceRootCandidates, findWorkflowRootCandidates, MarkerRootCandidate } from "../core/workspaceRoots"
import { findRunSelection, listRunSelections, pickRunSelection, RunSelection } from "../workflowRunSelection"
import {
  assertOperationHubRunRevision,
  isOperationHubRunMutationTarget,
  OperationHubRunMutationTarget,
  validateOperationHubRunMutationTarget
} from "../operationHubMutationTarget"

interface RunControlCommandOptions {
  showMarkdownReport: (title: string, summary: string, lines: string[]) => Promise<void>
}

type RunCommandArg = string | OperationHubRunMutationTarget | RunSelection | { runId?: string; run?: { runId?: string } } | undefined

export async function pauseCurrentRun(_options: RunControlCommandOptions, runArg?: RunCommandArg): Promise<unknown> {
  return requestPause(runArg, "afterCurrentStep", "manual")
}

export async function pauseAfterCurrentStep(_options: RunControlCommandOptions, runArg?: RunCommandArg): Promise<unknown> {
  return requestPause(runArg, "afterCurrentStep", "manual")
}

export async function pauseBeforeNextAiCall(_options: RunControlCommandOptions, runArg?: RunCommandArg): Promise<unknown> {
  return requestPause(runArg, "beforeNextAiCall", "manual-before-next-ai-call")
}

export async function resumePausedRun(_options: RunControlCommandOptions, runArg?: RunCommandArg): Promise<unknown> {
  const runId = resolveRunId(runArg)
  const roots = await workflowRootCandidates()
  const selection = isOperationHubRunMutationTarget(runArg)
    ? await validateStructuredRunSelection(runArg, roots)
    : runId
      ? await findRunSelection(runId, roots, createRunStore)
      : await pickRunSelection(roots, createRunStore)
  if (!selection) {
    const message = runId ? `Workflow run not found: ${runId}` : "No workflow run selected."
    await vscode.window.showWarningMessage(message)
    return message
  }
  const run = selection.run ?? await createRunStore(selection.root).loadRun(selection.runId)
  if (!run) {
    const message = `Workflow run not found: ${selection.runId}`
    await vscode.window.showWarningMessage(message)
    return message
  }
  if (run.status !== "paused") {
    const message = `Workflow run is not paused: ${run.runId} (${run.status})`
    await vscode.window.showWarningMessage(message)
    return message
  }
  return vscode.commands.executeCommand(
    "workflowRegister.resumeRun",
    isOperationHubRunMutationTarget(runArg)
      ? { ...runArg, workspaceRoot: selection.root }
      : selection.runId
  )
}

export async function inspectRunControl(options: RunControlCommandOptions, runArg?: RunCommandArg): Promise<void> {
  const runId = resolveRunId(runArg)
  const roots = await workflowRootCandidates()
  const selections = await listRunSelections(roots, createRunStore)
  const selection = runId
    ? selections.find((item) => item.runId === runId)
    : await pickRunSelection(roots, createRunStore)
  if (!selection) {
    await vscode.window.showWarningMessage(runId ? `Workflow run not found: ${runId}` : "No workflow run selected.")
    return
  }
  const control = await createControlStore(selection.root).loadControl(selection.runId)
  const run = selection.run ?? await createRunStore(selection.root).loadRun(selection.runId)
  const lines = [
    `- runId: ${selection.runId}`,
    `- root: ${selection.root}`,
    `- runStatus: ${run?.status ?? "unknown"}`,
    `- currentStep: ${run?.currentStep ?? "none"}`,
    `- pauseRequestedAt: ${control?.pauseRequestedAt ?? "none"}`,
    `- pauseReason: ${control?.pauseReason ?? "none"}`,
    `- requestedBy: ${control?.requestedBy ?? "none"}`,
    `- mode: ${control?.mode ?? "none"}`,
    `- clearedAt: ${control?.clearedAt ?? "none"}`,
    `- workflow.pause: ${run?.state["workflow.pause"] ?? "none"}`
  ]
  await options.showMarkdownReport("Workflow Run Control", `${selection.runId}: ${run?.status ?? "unknown"}`, lines)
}

async function requestPause(runArg: RunCommandArg, mode: RunPauseMode, reason: string): Promise<unknown> {
  const runId = resolveRunId(runArg)
  const roots = await workflowRootCandidates()
  const selection = isOperationHubRunMutationTarget(runArg)
    ? await validateStructuredRunSelection(runArg, roots)
    : runId
      ? await findRunSelection(runId, roots, createRunStore)
      : await pickInterruptibleRun(roots)
  if (!selection) {
    const message = runId ? `Workflow run not found: ${runId}` : "No running workflow run selected."
    await vscode.window.showWarningMessage(message)
    return message
  }
  const run = selection.run ?? await createRunStore(selection.root).loadRun(selection.runId)
  if (!run) {
    const message = `Workflow run not found: ${selection.runId}`
    await vscode.window.showWarningMessage(message)
    return message
  }
  if (run.status === "completed" || run.status === "failed") {
    const message = `Workflow run cannot be paused: ${run.runId} (${run.status})`
    await vscode.window.showWarningMessage(message)
    return message
  }
  if (isOperationHubRunMutationTarget(runArg)) {
    await assertOperationHubRunRevision(selection.root, selection.runId, runArg.expectedRevision)
  }
  const control = await createControlStore(selection.root).requestPause({
    runId: selection.runId,
    mode,
    reason,
    requestedBy: "user"
  })
  const message = run.status === "paused"
    ? `Workflow run is already paused: ${selection.runId}`
    : `Pause requested for workflow run ${selection.runId}. It will stop at the next checkpoint.`
  await vscode.window.showInformationMessage(message)
  return control
}

async function pickInterruptibleRun(roots: MarkerRootCandidate[]): Promise<RunSelection | undefined> {
  const selections = (await listRunSelections(roots, createRunStore))
    .filter((selection) => selection.run && selection.run.status !== "completed" && selection.run.status !== "failed")
  if (selections.length === 0) return undefined
  const picked = await vscode.window.showQuickPick(selections.map((selection) => ({
    label: selection.runId,
    description: selection.run?.status,
    detail: `${selection.run?.workflowId}; root=${selection.root}; currentStep=${selection.run?.currentStep ?? "none"}`,
    selection
  })), { title: "Pause Workflow Run" })
  return picked?.selection
}

function resolveRunId(value: RunCommandArg): string | undefined {
  if (typeof value === "string") return value
  if (!value || typeof value !== "object") return undefined
  if (typeof value.runId === "string") return value.runId
  if ("run" in value && value.run && typeof value.run.runId === "string") return value.run.runId
  return undefined
}

function createRunStore(workspaceRoot: string): FileRunStateStore {
  return new FileRunStateStore({ workspaceRoot })
}

function createControlStore(workspaceRoot: string): FileRunControlStore {
  return new FileRunControlStore({ workspaceRoot })
}

async function validateStructuredRunSelection(
  target: OperationHubRunMutationTarget,
  roots: MarkerRootCandidate[]
): Promise<RunSelection> {
  const validated = await validateOperationHubRunMutationTarget(
    target,
    roots.map((candidate) => candidate.root)
  )
  return {
    root: validated.workspaceRoot,
    runId: target.runId,
    run: validated.snapshot.run
  }
}

async function workflowRootCandidates(): Promise<MarkerRootCandidate[]> {
  const folders = vscode.workspace.workspaceFolders ?? []
  if (folders.length === 0) return []
  const markerRoots = await findWorkflowRootCandidates(folders)
  return markerRoots.length > 0 ? markerRoots : fallbackWorkspaceRootCandidates(folders)
}
