import * as vscode from "vscode"
import { createMockWorkflowAiProvider } from "../core/mockWorkflowAiProvider"
import { WorkflowAiProvider } from "../core/workflowAiProvider"
import { buildWorkflowFromDesignDraft } from "../core/workflowDesignBuilder"
import { WorkflowTemplateKind, workflowTemplates } from "../core/workflowScaffold"

export interface DesignWorkflowWithAiOptions {
  sourceId: string
  showMarkdownReport: (title: string, summary: string, lines: string[]) => Promise<void>
  provider?: WorkflowAiProvider
}

export async function designWorkflowWithAi(options: DesignWorkflowWithAiOptions): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (!folder) {
    await vscode.window.showErrorMessage("No workspace folder is open.")
    return
  }
  const input = await collectDesignInput()
  if (!input) return
  const provider = options.provider ?? createMockWorkflowAiProvider()
  const draft = await Promise.resolve(provider.designWorkflow(input))
  const result = buildWorkflowFromDesignDraft(draft, { sourceId: options.sourceId })
  if (!result.ok || !result.markdown) {
    await options.showMarkdownReport("Workflow Design with AI", `Provider '${provider.id}' returned an invalid workflow design; nothing was saved.`, result.reportLines)
    return
  }
  const dir = vscode.Uri.joinPath(folder.uri, ".bob", "workflows", result.name)
  const uri = vscode.Uri.joinPath(dir, "WORKFLOW.md")
  await vscode.workspace.fs.createDirectory(dir)
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(result.markdown))
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri))
  await options.showMarkdownReport("Workflow Design with AI", `Provider '${provider.id}' saved ${result.filePath}.`, result.reportLines)
}

async function collectDesignInput(): Promise<{ goal: string; preferredTemplate?: WorkflowTemplateKind } | undefined> {
  const goal = await vscode.window.showInputBox({ title: "Workflow goal", value: "Review the current workflow and produce a report." })
  if (goal === undefined) return undefined
  const picked = await vscode.window.showQuickPick([
    { label: "Let provider choose", description: "auto", template: undefined },
    ...workflowTemplates.map((template) => ({ label: template.label, description: template.id, detail: template.description, template: template.id }))
  ], { title: "Preferred workflow template" })
  if (!picked) return undefined
  return { goal, preferredTemplate: picked.template }
}
