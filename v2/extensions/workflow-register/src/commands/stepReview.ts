import * as path from "path"
import * as vscode from "vscode"
import { editWorkflowInBuilder } from "./editWorkflowInBuilder"
import { bobTaskSyncRegistry } from "../bobTaskSync"
import { FileRunStateStore } from "../core/runStateStore"
import { RunStepState, WorkflowRunState } from "../core/model"
import { pendingReviewTransitionStepId } from "../core/engine/runState"
import { fallbackWorkspaceRootCandidates, findWorkflowRootCandidates, MarkerRootCandidate } from "../core/workspaceRoots"
import { reviewTaskRegistry } from "../reviewTaskRegistry"
import type { BobWorkflowGateAcceptance, BobWorkflowGateAcceptResult } from "../bobWorkflowGateRegistry"
import {
  assertOperationHubRunRevision,
  isOperationHubRunMutationTarget,
  OperationHubRunMutationTarget,
  readOperationHubRunSnapshot,
  validateOperationHubRunMutationTarget
} from "../operationHubMutationTarget"

interface StepReviewCommandOptions {
  showMarkdownReport: (title: string, summary: string, lines: string[]) => Promise<void>
  acceptBobWorkflowGate: (workspaceRoot: string, runId: string, stepId: string) => BobWorkflowGateAcceptResult
  acceptBobWorkflowGateWithMetadata?: (workspaceRoot: string, runId: string, stepId: string) => BobWorkflowGateAcceptance
  coordinateReviewAcceptance: <T>(workspaceRoot: string, runId: string, operation: () => Promise<T>) => Promise<T>
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

interface AcceptedStepResult {
  run: WorkflowRunState
  message: string
  completedViaBobTask: boolean
  continuationOwnedByBob: boolean
  workspaceRoot: string
  revision: string
}

type ReviewRunArg = string | OperationHubRunMutationTarget | undefined

const RUN_NEXT_STEP_LABEL = "次のステップを実行"
const OPEN_OPERATION_HUB_LABEL = "Operation Hub を開く"

export async function acceptCurrentStep(options: StepReviewCommandOptions, runArg?: ReviewRunArg, acceptOptions: AcceptOptions = {}): Promise<WorkflowRunState | string> {
  const accepted = await acceptReviewedStep(options, runArg)
  if (typeof accepted === "string") return accepted
  if (!acceptOptions.silent) {
    await showAcceptedStepMessage(
      accepted.run,
      accepted.message,
      accepted.completedViaBobTask,
      accepted.continuationOwnedByBob,
      accepted.workspaceRoot,
      accepted.revision
    )
  }
  return accepted.run
}

export async function acceptAndRunNextStep(options: StepReviewCommandOptions, runArg?: ReviewRunArg): Promise<unknown> {
  const accepted = await acceptReviewedStep(options, runArg)
  if (typeof accepted === "string") {
    await vscode.window.showWarningMessage(accepted)
    return accepted
  }
  if (accepted.run.status === "completed") {
    const message = `Workflow run completed: ${accepted.run.runId}`
    await vscode.window.showInformationMessage(message)
    return accepted.run
  }
  if (accepted.continuationOwnedByBob) return accepted.run
  return vscode.commands.executeCommand("workflowRegister.runNextStep", operationHubTargetForAcceptedStep(accepted))
}

async function acceptReviewedStep(options: StepReviewCommandOptions, runArg?: ReviewRunArg): Promise<AcceptedStepResult | string> {
  const runId = typeof runArg === "string" ? runArg : runArg?.runId
  const selection = isOperationHubRunMutationTarget(runArg)
    ? await validateReviewRunTarget(runArg)
    : runId
      ? await findRunSelection(runId)
      : await pickRunSelection("Accept reviewed workflow step", (run) => run.status === "reviewing")
  if (!selection) return runId ? `Workflow run not found or not waiting for review: ${runId}` : "No reviewing workflow run selected."
  return options.coordinateReviewAcceptance(
    selection.root,
    selection.runId,
    () => acceptReviewedStepOnce(
      options,
      selection.root,
      selection.runId,
      isOperationHubRunMutationTarget(runArg) ? runArg.expectedRevision : undefined
    )
  )
}

async function acceptReviewedStepOnce(
  options: StepReviewCommandOptions,
  workspaceRoot: string,
  runId: string,
  expectedRevision?: string
): Promise<AcceptedStepResult | string> {
  if (expectedRevision) await assertOperationHubRunRevision(workspaceRoot, runId, expectedRevision)
  const runStore = new FileRunStateStore({ workspaceRoot })
  const run = await runStore.loadRun(runId)
  if (!run) return `Workflow run not found: ${runId}`
  const acceptedStepId = run.currentStep
  const accepted = acceptReviewingStep(run)
  await runStore.saveRun(accepted)
  const gateAcceptance: BobWorkflowGateAcceptance = acceptedStepId
    ? options.acceptBobWorkflowGateWithMetadata?.(workspaceRoot, accepted.runId, acceptedStepId)
      ?? { result: options.acceptBobWorkflowGate(workspaceRoot, accepted.runId, acceptedStepId) }
    : { result: "missing" }
  const gateDecision = gateAcceptance.result
  const acceptedViaLiveGate = gateDecision === "accepted" || gateDecision === "alreadyAccepted"
  const continuationOwnedByBob = acceptedViaLiveGate && gateAcceptance.gate?.executionMode === "full"
  let completedViaBobTask = acceptedViaLiveGate
  if (gateDecision === "missing" || gateDecision === "aborted") {
    const sync = await bobTaskSyncRegistry.reconcileRun(workspaceRoot, accepted, undefined, {
      reason: "review-accepted",
      task: reviewTaskRegistry.taskForStep(workspaceRoot, accepted.runId, acceptedStepId)
        ?? reviewTaskRegistry.taskForRun(workspaceRoot, accepted.runId)
    })
    await runStore.saveRun(accepted)
    completedViaBobTask = sync.status === "synced" && sync.appliedStepCount > 0
  }
  const message = pendingReviewTransitionStepId(accepted)
    ? `Accepted step; pending transition will run from ${accepted.currentStep}: ${accepted.runId}`
    : accepted.status === "completed"
    ? `Accepted final step and completed workflow run: ${accepted.runId}`
    : `Accepted step; next step is ${accepted.currentStep}: ${accepted.runId}`
  const snapshot = await readOperationHubRunSnapshot(workspaceRoot, accepted.runId)
  return { run: accepted, message, completedViaBobTask, continuationOwnedByBob, workspaceRoot, revision: snapshot.revision }
}

async function showAcceptedStepMessage(
  accepted: WorkflowRunState,
  message: string,
  completedViaBobTask: boolean,
  continuationOwnedByBob: boolean,
  workspaceRoot: string,
  revision: string
): Promise<void> {
  if (accepted.status !== "running" || !accepted.currentStep) {
    await vscode.window.showInformationMessage(message)
    return
  }
  if (continuationOwnedByBob) {
    await vscode.window.showInformationMessage(`${message}. Bob ワークフローが同じ run を続行します。`)
    return
  }
  if (completedViaBobTask) {
    await vscode.window.showInformationMessage(`${message}. Bob 側のステップ完了へ反映しました。`)
    return
  }
  const selected = await vscode.window.showInformationMessage(
    `${message}. 次のステップはまだ開始されていません。`,
    RUN_NEXT_STEP_LABEL,
    OPEN_OPERATION_HUB_LABEL
  )
  if (selected === RUN_NEXT_STEP_LABEL) {
    await vscode.commands.executeCommand("workflowRegister.runNextStep", {
      source: "operationHub",
      workspaceRoot,
      runId: accepted.runId,
      expectedRevision: revision
    } satisfies OperationHubRunMutationTarget)
  } else if (selected === OPEN_OPERATION_HUB_LABEL) {
    await vscode.commands.executeCommand("workflowRegister.openOperationHub", {
      workspaceRoot,
      runId: accepted.runId,
      stepId: accepted.currentStep,
      reason: "stepGate"
    })
  }
}

function operationHubTargetForAcceptedStep(accepted: AcceptedStepResult): OperationHubRunMutationTarget {
  return {
    source: "operationHub",
    workspaceRoot: accepted.workspaceRoot,
    runId: accepted.run.runId,
    expectedRevision: accepted.revision
  }
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
  linesForRun(run)
  const lines = [
    `- runId: ${run.runId}`,
    `- workflow: ${run.workflowId}`,
    `- status: ${run.status}`,
    `- currentStep: ${run.currentStep ?? "none"}`,
    `- root: ${selection.root}`,
    `- workflowFile: ${run.workflowFile ?? "none"}`,
    `- workflowDefinitionHash: ${run.workflowDefinitionHash ?? "none"}`,
    `- workflowDefinitionMismatch: ${run.state["workflow.definitionMismatch"] ?? "none"}`,
    `- bobTaskSync: ${run.bobTaskSync?.drift?.status ?? "unknown"}; completedThrough=${run.bobTaskSync?.completedThroughStepId ?? "none"}`
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

  if (pendingReviewTransitionStepId(run) === current.id) {
    run.status = "running"
    run.currentStep = current.id
    run.error = undefined
    return run
  }

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

async function validateReviewRunTarget(target: OperationHubRunMutationTarget): Promise<RunSelection> {
  const roots = await workflowRootCandidates()
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

function linesForRun(_run: WorkflowRunState): void {
  // Reserved for future run diagnostics injected by this command.
}
