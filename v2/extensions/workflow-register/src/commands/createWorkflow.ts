import * as vscode from "vscode"
import { createWorkflowMarkdown, normalizeWorkflowName, workflowTemplates, WorkflowTemplateKind } from "../core/workflowScaffold"
import { formatWorkflowDiagnostics, validateWorkflowText } from "../core/workflowValidator"

export interface CreateWorkflowCommandOptions {
  sourceId: string
  showMarkdownReport: (title: string, summary: string, lines: string[]) => Promise<void>
}

export async function createWorkflowFromTemplate(options: CreateWorkflowCommandOptions): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (!folder) {
    await vscode.window.showErrorMessage("No workspace folder is open.")
    return
  }
  const picked = await vscode.window.showQuickPick(workflowTemplates.map((template) => ({ label: template.label, description: template.id, detail: template.description, template })), { title: "Workflow Template" })
  if (!picked) return
  const rawName = await vscode.window.showInputBox({ title: "Workflow name", value: "new-workflow" })
  if (rawName === undefined) return
  const name = normalizeWorkflowName(rawName)
  const title = await vscode.window.showInputBox({ title: "Workflow title", value: titleFromName(name) })
  if (title === undefined) return
  const description = await vscode.window.showInputBox({ title: "Workflow description", value: `Run ${title}.` })
  if (description === undefined) return

  const markdown = createWorkflowMarkdown({ name, title, description, template: picked.template.id as WorkflowTemplateKind })
  const validation = validateWorkflowText({ sourceId: options.sourceId, filePath: `.bob/workflows/${name}/WORKFLOW.md`, text: markdown })
  if (!validation.ok) {
    await options.showMarkdownReport("Generated Workflow Validation", "Generated workflow is invalid.", formatWorkflowDiagnostics(validation))
    return
  }
  const dir = vscode.Uri.joinPath(folder.uri, ".bob", "workflows", name)
  const uri = vscode.Uri.joinPath(dir, "WORKFLOW.md")
  await vscode.workspace.fs.createDirectory(dir)
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(markdown))
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri))
}

function titleFromName(name: string): string {
  return name.split(/[._-]+/).filter(Boolean).map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ") || "New Workflow"
}
