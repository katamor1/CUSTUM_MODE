import * as vscode from "vscode"
import { createMockWorkflowAiProvider } from "../core/mockWorkflowAiProvider"
import { formatWorkflowRepairProposal, WorkflowAiProvider } from "../core/workflowAiProvider"
import { createWorkflowReplacementCandidate, previewFileNameForWorkflow, WorkflowReplacementCandidate } from "../core/workflowReplacementPreview"
import { buildWorkflowRepairContext, formatWorkflowRepairContext } from "../core/workflowRepairContext"
import { formatWorkflowDiagnostics, validateWorkflowText } from "../core/workflowValidator"

export interface ImproveWorkflowWithAiOptions {
  sourceId: string
  showMarkdownReport: (title: string, summary: string, lines: string[]) => Promise<void>
  provider?: WorkflowAiProvider
}

export async function improveWorkflowWithAi(options: ImproveWorkflowWithAiOptions): Promise<void> {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    await vscode.window.showErrorMessage("No active editor is open.")
    return
  }
  const filePath = vscode.workspace.asRelativePath(editor.document.uri, false)
  const workflowText = editor.document.getText()
  const validation = validateWorkflowText({ sourceId: options.sourceId, filePath, text: workflowText })
  const context = buildWorkflowRepairContext(filePath, validation)
  const provider = options.provider ?? createMockWorkflowAiProvider()
  const proposal = await Promise.resolve(provider.improveWorkflow({ filePath, workflowText, repairContext: context }))
  const lines = [
    "## Current validation",
    "",
    ...formatWorkflowDiagnostics(validation),
    "",
    ...formatWorkflowRepairContext(context),
    "",
    ...formatWorkflowRepairProposal(proposal)
  ]
  let summary = proposal.replacementMarkdown
    ? "AI repair proposal includes replacement Markdown."
    : "AI repair proposal does not include replacement Markdown; no files were modified."
  if (proposal.replacementMarkdown) {
    const candidate = createWorkflowReplacementCandidate({ sourceId: options.sourceId, filePath, originalMarkdown: workflowText, replacementMarkdown: proposal.replacementMarkdown })
    lines.push("", "## Replacement validation", "", ...formatWorkflowDiagnostics(candidate.validation), "", "## Replacement apply plan", "", `- canApply: ${candidate.canApply}`, `- backup: ${candidate.backupRelativePath}`)
    if (candidate.canApply) {
      const outcome = await previewAndMaybeApplyReplacement(editor.document.uri, candidate)
      summary = outcome
    } else {
      summary = "AI repair proposal includes replacement Markdown, but it is invalid and was not previewed or applied."
    }
  }
  await options.showMarkdownReport("Improve Workflow With AI", `${summary} Provider: ${provider.id}.`, lines)
}

async function previewAndMaybeApplyReplacement(originalUri: vscode.Uri, candidate: WorkflowReplacementCandidate): Promise<string> {
  const preview = await vscode.workspace.openTextDocument({ language: "markdown", content: candidate.replacementMarkdown })
  await vscode.window.showTextDocument(preview, { preview: false })
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (folder) {
    const previewDir = vscode.Uri.joinPath(folder.uri, ".bob", "workflows", ".previews", candidate.workflowName)
    const previewUri = vscode.Uri.joinPath(previewDir, previewFileNameForWorkflow(candidate.filePath, new Date()))
    await vscode.workspace.fs.createDirectory(previewDir)
    await vscode.workspace.fs.writeFile(previewUri, new TextEncoder().encode(candidate.replacementMarkdown))
    await vscode.commands.executeCommand("vscode.diff", originalUri, previewUri, `Workflow replacement: ${candidate.workflowName}`)
  }
  const picked = await vscode.window.showQuickPick([
    { label: "Apply Replacement", description: "Create a backup, then overwrite WORKFLOW.md" },
    { label: "Cancel", description: "Leave the current workflow unchanged" }
  ], { title: "AI Workflow Replacement" })
  if (picked?.label !== "Apply Replacement") return "AI repair replacement was previewed but not applied."
  const confirmed = await vscode.window.showWarningMessage(`Apply AI replacement to ${candidate.filePath}? A backup will be written to ${candidate.backupRelativePath}.`, { modal: true }, "Apply Replacement")
  if (confirmed !== "Apply Replacement") return "AI repair replacement was cancelled before apply."
  await writeBackupAndReplacement(originalUri, candidate)
  return `AI repair replacement was applied. Backup: ${candidate.backupRelativePath}.`
}

async function writeBackupAndReplacement(originalUri: vscode.Uri, candidate: WorkflowReplacementCandidate): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (!folder) throw new Error("No workspace folder is open.")
  const parts = candidate.backupRelativePath.split("/").filter(Boolean)
  const backupUri = vscode.Uri.joinPath(folder.uri, ...parts)
  const backupDir = vscode.Uri.joinPath(folder.uri, ...parts.slice(0, -1))
  await vscode.workspace.fs.createDirectory(backupDir)
  await vscode.workspace.fs.writeFile(backupUri, new TextEncoder().encode(candidate.originalMarkdown))
  await vscode.workspace.fs.writeFile(originalUri, new TextEncoder().encode(candidate.replacementMarkdown))
}
