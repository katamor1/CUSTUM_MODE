import * as vscode from "vscode"
import { buildWorkflowRunDiagnosticReport } from "../core/runDiagnostics"
import type { WorkflowRunDurabilitySummary } from "../core/runDiagnostics"
import { FileRunStateStore } from "../core/runStateStore"
import type { RunStateLoadDiagnostic } from "../core/runStateStore"
import { readRunDurabilityFile } from "../core/runtime/runDurabilityPath"
import { readWorkflowRunEventLog } from "../core/runtime/runEventLog"
import { FileTaskSnapshotStore } from "../core/taskSnapshots"
import { pickWorkflowRoot } from "./workspaceRootPicker"

export interface InspectRunDiagnosticsOptions {
  showMarkdownReport: (title: string, summary: string, lines: string[]) => Promise<void>
}

export async function inspectRunDiagnostics(options: InspectRunDiagnosticsOptions): Promise<void> {
  const workspaceRoot = await pickWorkflowRoot("Select workflow workspace")
  if (!workspaceRoot) {
    await vscode.window.showErrorMessage("No workspace folder is open.")
    return
  }
  const store = new FileRunStateStore({ workspaceRoot })
  const runs = await store.listRuns()
  const snapshotStore = new FileTaskSnapshotStore({ workspaceRoot })
  const snapshotsByRunId = Object.fromEntries(await Promise.all(runs.map(async (run) => [run.runId, await snapshotStore.listSnapshots(run.runId)] as const)))
  const durabilityInspections = await Promise.all(runs.map(async (run) => [run.runId, await inspectRunDurability(workspaceRoot, run.runId)] as const))
  const durabilityByRunId = Object.fromEntries(durabilityInspections.map(([runId, inspection]) => [runId, inspection.summary]))
  const durabilityDiagnostics = durabilityInspections.flatMap(([, inspection]) => inspection.diagnostics)
  const report = buildWorkflowRunDiagnosticReport(runs, {
    snapshotsByRunId,
    durabilityByRunId,
    runDocumentDiagnostics: sortDiagnostics([
      ...store.getLoadDiagnostics(),
      ...durabilityDiagnostics
    ])
  })
  await options.showMarkdownReport(report.title, report.summary, report.lines)
}

async function inspectRunDurability(
  workspaceRoot: string,
  runId: string
): Promise<{ summary: WorkflowRunDurabilitySummary; diagnostics: RunStateLoadDiagnostic[] }> {
  const diagnostics: RunStateLoadDiagnostic[] = []
  let eventCount = 0
  let eventHeadHash: string | undefined
  try {
    const eventState = await readWorkflowRunEventLog(workspaceRoot, runId)
    eventCount = eventState.events.length
    eventHeadHash = eventState.head?.hash
  } catch (error) {
    diagnostics.push({
      runId,
      severity: "error",
      code: "event-log-invalid",
      message: formatError(error)
    })
  }

  let journalPending = false
  let lockPresent = false
  try {
    const [journal, lock] = await Promise.all([
      readRunDurabilityFile(workspaceRoot, runId, "run-state.journal.json"),
      readRunDurabilityFile(workspaceRoot, runId, "run.lock.json")
    ])
    journalPending = Boolean(journal)
    lockPresent = Boolean(lock)
  } catch (error) {
    diagnostics.push({
      runId,
      severity: "error",
      code: "invalid",
      message: `Workflow run durability files could not be inspected: ${formatError(error)}`
    })
  }

  return {
    summary: { eventCount, eventHeadHash, journalPending, lockPresent },
    diagnostics
  }
}

function sortDiagnostics(values: RunStateLoadDiagnostic[]): RunStateLoadDiagnostic[] {
  const severity: Record<RunStateLoadDiagnostic["severity"], number> = { error: 0, warning: 1, info: 2 }
  return [...values].sort((left, right) => (
    compare(left.runId, right.runId)
    || severity[left.severity] - severity[right.severity]
    || compare(left.code, right.code)
    || compare(left.message, right.message)
  ))
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
