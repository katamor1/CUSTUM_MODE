import * as vscode from "vscode"
import { buildWorkflowRunDiagnosticReport } from "../core/runDiagnostics"
import { FileRunStateStore } from "../core/runStateStore"

export interface InspectRunDiagnosticsOptions {
  showMarkdownReport: (title: string, summary: string, lines: string[]) => Promise<void>
}

export async function inspectRunDiagnostics(options: InspectRunDiagnosticsOptions): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!workspaceRoot) {
    await vscode.window.showErrorMessage("No workspace folder is open.")
    return
  }
  const store = new FileRunStateStore({ workspaceRoot })
  const runs = await store.listRuns()
  const report = buildWorkflowRunDiagnosticReport(runs)
  await options.showMarkdownReport(report.title, report.summary, report.lines)
}
