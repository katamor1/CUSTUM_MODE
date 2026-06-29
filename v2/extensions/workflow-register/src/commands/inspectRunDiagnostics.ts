import * as vscode from "vscode"
import { buildWorkflowRunDiagnosticReport } from "../core/runDiagnostics"
import { FileRunStateStore } from "../core/runStateStore"
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
  const report = buildWorkflowRunDiagnosticReport(runs)
  await options.showMarkdownReport(report.title, report.summary, report.lines)
}
