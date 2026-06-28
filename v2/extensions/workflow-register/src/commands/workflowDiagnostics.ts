import * as vscode from "vscode"
import { ValidateWorkflowResult, WorkflowDiagnostic, WorkflowDiagnosticSeverity } from "../core/workflowValidator"

export class WorkflowDiagnosticsReporter implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection

  constructor(name = "bob-workflow-register") {
    this.collection = vscode.languages.createDiagnosticCollection(name)
  }

  set(uri: vscode.Uri, result: ValidateWorkflowResult): void {
    const diagnostics = result.diagnostics
      .filter((item) => item.severity !== "info")
      .map((item) => toVscodeDiagnostic(item))
    this.collection.set(uri, diagnostics)
  }

  clear(uri?: vscode.Uri): void {
    if (uri) this.collection.delete(uri)
    else this.collection.clear()
  }

  dispose(): void {
    this.collection.dispose()
  }
}

function toVscodeDiagnostic(item: WorkflowDiagnostic): vscode.Diagnostic {
  const diagnostic = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), item.message, toSeverity(item.severity))
  diagnostic.source = "Bob Workflow Register"
  return diagnostic
}

function toSeverity(severity: WorkflowDiagnosticSeverity): vscode.DiagnosticSeverity {
  if (severity === "error") return vscode.DiagnosticSeverity.Error
  if (severity === "warning") return vscode.DiagnosticSeverity.Warning
  return vscode.DiagnosticSeverity.Information
}
