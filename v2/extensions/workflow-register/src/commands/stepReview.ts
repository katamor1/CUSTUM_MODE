import * as path from "path"
import * as vscode from "vscode"
import { editWorkflowInBuilder } from "./editWorkflowInBuilder"
import { FileRunStateStore } from "../core/runStateStore"
import { RunStepState, WorkflowRunState } from "../core/model"
import { fallbackWorkspaceRootCandidates, findWorkflowRootCandidates, MarkerRootCandidate } from "../core/workspaceRoots"

interface StepReviewCommandOptions {
  showMarkdownReport: (title: string, summary: string, lines: string[]) => Promise<void>
}

export interface StepReviewBuilderCommandOptions extends StepReviewCommandOptions {
  extensionUri: vscode.Uri
  sourceId: string
}

interface RunSelection {
  root: string
  runId: string
  run: WorkflowRunState
}

interface AcceptOptions {
  silent?: boolean
}

export async function acceptCurrentStep(options: StepReviewCommandOptions, runId?: string, acceptOptions: AcceptOptions = {}): Promise<WorkflowRunState | string> {
  const selection = runId ? await findRunSelection(runId) : await pickRunSelection("Accept reviewed workflow step", (run) => run.status === "reviewing")
  if (!selection) return runId ? `Workflow run not found or not waiting for review: ${runId}` : "No reviewing workflow run selected."
  const runStore = new FileRunStateStore({ workspaceRoot: selection.root })
  const run = await runStore.loadRun(selection.runId)
  if (!run) return `Workflow run not found: ${selection.runId}`
  const accepted = acceptReviewingStep(run)
  await runStore.saveRun(accepted)
  const message = accepted.status === "completed"
    ? `Accepted final step and completed workflow run: ${accepted.runId}`
    : `Accepted step; next step is ${accepted.currentStep}: ${accepted.runId}`
  if (!acceptOptions.silent) await vscode.window.showInformationMessage(message)
  return accepted
}

export async function acceptAndRunNextStep(options: StepReviewCommandOptions, runId?: string): Promise<unknown> {
  const accepted = await acceptCurrentStep(options, runId, { silent: true })
  if (typeof accepted === "string") {
    await vscode.window.showWarningMessage(accepted)
    return accepted
  }
  if (accepted.status === "completed") {
    const message = `Workflow run completed: ${accepted.runId}`
    await vscode.window.showInformationMessage(message)
    return accepted
  }
  return vscode.commands.executeCommand("workflowRegister.resumeRun", accepted.runId)
}

export async function runNextStep(_options: StepReviewCommandOptions, runId?: string): Promise<unknown> {
  const selection = runId ? await findRunSelection(runId) : await pickRunSelection("Run next workflow step", (run) => run.status === "running" || run.status === "held" || run.status === "failed")
  if (!selection) return runId ? `Workflow run not found: ${runId}` : "No workflow run selected."
  if (selection.run.status === "reviewing") {
    const message = "Current step is waiting for review. Accept or retry it before running the next step."
    await vscode.window.showWarningMessage(message)
    return message
  }
  return vscode.commands.executeCommand("workflowRegister.resumeRun", selection.runId)
}

export async function inspectCurrentStep(options: StepReviewCommandOptions, runId?: string): Promise<void> {
  const selection = runId ? await findRunSelection(runId) : await pickRunSelection("Inspect workflow step")
  if (!selection) {
    await vscode.window.showWarningMessage(runId ? `Workflow run not found: ${runId}` : "No workflow run selected.")
    return
  }
  const run = selection.run
  const index = run.currentStep ? run.steps.findIndex((step) => step.id === run.currentStep) : -1
  const current = index >= 0 ? run.steps[index] : undefined
  const lines = [
    `- runId: ${run.runId}`,
    `- workflow: ${run.workflowId}`,
    `- status: ${run.status}`,
    `- currentStep: ${run.currentStep ?? "none"}`,
    `- root: ${selection.root}`,
    `- workflowFile: ${run.workflowFile ?? "none"}`,
    `- workflowDefinitionHash: ${run.workflowDefinitionHash ?? "none"}`,
    `- workflowDefinitionMismatch: ${run.state["workflow.definitionMismatch"] ?? "none"}`
  ]
  if (current) {
    lines.push(
      `- currentStepStatus: ${current.status}`,
      `- currentStepTitle: ${current.title}`,
      `- currentAttempt: ${current.attempt ?? 1}`,
      `- archivedAttempts: ${current.attempts?.length ?? 0}`
    )
  }
  lines.push("", "## Current Step Attempts")
  appendAttemptLines(lines, current)
  lines.push("", "## Steps")
  for (const [stepIndex, step] of run.steps.entries()) {
    lines.push(`- ${stepIndex + 1}. ${step.id}: ${step.status}; title=${step.title}; attempt=${step.attempt ?? 1}; archivedAttempts=${step.attempts?.length ?? 0}; startedAt=${step.startedAt ?? "none"}; reviewStartedAt=${step.reviewStartedAt ?? "none"}; acceptedAt=${step.acceptedAt ?? "none"}; completedAt=${step.completedAt ?? "none"}; error=${step.error ?? "none"}`)
  }
  await options.showMarkdownReport("Workflow Step", `${run.runId}: ${run.status}`, lines)
}

export async function openCurrentStepInBuilder(options: StepReviewBuilderCommandOptions, runId?: string): Promise<void> {
  const selection = runId ? await findRunSelection(runId) : await pickRunSelection("Open current workflow step in builder", (run) => Boolean(run.currentStep && run.workflowFile))
  if (!selection) {
    await vscode.window.showWarningMessage(runId ? `Workflow run not found: ${runId}` : "No workflow run selected.")
    return
  }
  const run = selection.run
  if (!run.workflowFile) {
    await vscode.window.showWarningMessage(`Workflow file is not recorded for run: ${run.runId}`)
    return
  }
  await editWorkflowInBuilder({ sourceId: options.sourceId, extensionUri: options.extensionUri }, { uri: workflowFileUri(selection), focusStepId: run.currentStep })
}

function acceptReviewingStep(run: WorkflowRunState): WorkflowRunState {
  if (run.status !== "reviewing") throw new Error(`Workflow run is not waiting for review: ${run.status}`)
  const currentIndex = run.currentStep ? run.steps.findIndex((step) => step.id === run.currentStep) : -1
  if (currentIndex < 0) throw new Error(`Current step is not available: ${run.currentStep ?? "none"}`)
  const current = run.steps[currentIndex]
  if (current.status !== "reviewing") throw new Error(`Current step is not waiting for review: ${current.status}`)
  const now = new Date().toISOString()
  current.status = "completed"
  current.acceptedAt = now
  current.completedAt = now
  current.error = undefined

  const nextIndex = run.steps.findIndex((step, index) => index > currentIndex && (step.status === "pending" || step.status === "held" || step.status === "failed" || step.status === "reviewing"))
  if (nextIndex < 0) {
    run.status = "completed"
    run.currentStep = undefined
    run.error = undefined
  } else {
    run.status = "running"
    run.currentStep = run.steps[nextIndex].id
    run.error = undefined
  }
  return run
}

function appendAttemptLines(lines: string[], step: RunStepState | undefined): void {
  if (!step) {
    lines.push("- No current step.")
    return
  }
  const attempts = step.attempts ?? []
  if (attempts.length === 0) {
    lines.push("- No archived attempts.")
    return
  }
  for (const attempt of attempts) {
    const stateKeys = Object.keys(attempt.stateSnapshot ?? {}).sort()
    lines.push(`- attempt ${attempt.attempt}: ${attempt.status}; createdAt=${attempt.createdAt}; startedAt=${attempt.startedAt ?? "none"}; reviewStartedAt=${attempt.reviewStartedAt ?? "none"}; completedAt=${attempt.completedAt ?? "none"}; stateKeys=${stateKeys.length === 0 ? "none" : stateKeys.join(",")}; error=${attempt.error ?? "none"}`)
  }
}

function workflowFileUri(selection: RunSelection): vscode.Uri {
  const file = selection.run.workflowFile ?? ""
  return vscode.Uri.file(path.isAbsolute(file) ? file : path.join(selection.root, file))
}

async function pickRunSelection(title: string, predicate: (run: WorkflowRunState) => boolean = () => true): Promise<RunSelection | undefined> {
  const selections = (await listRunSelections()).filter((selection) => predicate(selection.run))
  if (selections.length === 0) return undefined
  const picked = await vscode.window.showQuickPick(selections.map((selection) => ({
    label: selection.runId,
    description: selection.run.status,
    detail: `${selection.run.workflowId}; root=${selection.root}; currentStep=${selection.run.currentStep ?? "none"}`,
    selection
  })), { title })
  return picked?.selection
}

async function findRunSelection(runId: string): Promise<RunSelection | undefined> {
  return (await listRunSelections()).find((selection) => selection.runId === runId)
}

async function listRunSelections(): Promise<RunSelection[]> {
  const roots = await workflowRootCandidates()
  const nested = await Promise.all(roots.map(async (candidate) => {
    const runStore = new FileRunStateStore({ workspaceRoot: candidate.root })
    const runs = await runStore.listRuns()
    return runs.map((run) => ({ root: candidate.root, runId: run.runId, run }))
  }))
  return nested.flat().sort((a, b) => b.run.updatedAt.localeCompare(a.run.updatedAt))
}

async function workflowRootCandidates(): Promise<MarkerRootCandidate[]> {
  const folders = vscode.workspace.workspaceFolders ?? []
  if (folders.length === 0) return []
  const markerRoots = await findWorkflowRootCandidates(folders)
  return markerRoots.length > 0 ? markerRoots : fallbackWorkspaceRootCandidates(folders)
}
