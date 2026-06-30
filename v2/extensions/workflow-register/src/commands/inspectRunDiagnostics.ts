import * as vscode from "vscode"
import { buildWorkflowRunDiagnosticReport } from "../core/runDiagnostics"
import { FileRunStateStore } from "../core/runStateStore"
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
  const report = buildWorkflowRunDiagnosticReport(runs, { snapshotsByRunId })
  await options.showMarkdownReport(report.title, report.summary, report.lines)
}
