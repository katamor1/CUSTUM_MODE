import * as vscode from "vscode"
import {
  CandidateText,
  CaptureReviewResultResult,
  captureReviewResultFromCandidates,
  extractJsonFromText
} from "./resultCaptureCore"

export { CaptureReviewResultResult, extractJsonFromText }

export async function captureReviewResult(inputText?: string): Promise<CaptureReviewResultResult> {
  const explicitInput = typeof inputText === "string" && inputText.trim().length > 0
  const candidates = explicitInput
    ? [{ source: "command argument", text: inputText }]
    : await buildDefaultCandidates()
  const result = await captureCandidatesWithWorkspace(candidates)
  if (!explicitInput) await presentCaptureResult(result)
  return result
}

export async function saveReviewResultFromClipboard(): Promise<CaptureReviewResultResult> {
  const result = await captureCandidatesWithWorkspace([{ source: "clipboard", text: await vscode.env.clipboard.readText() }])
  await presentCaptureResult(result)
  return result
}

async function captureCandidatesWithWorkspace(candidates: CandidateText[]): Promise<CaptureReviewResultResult> {
  const folder = await pickWorkspaceFolder()
  if (!folder) throw new Error("Open a workspace folder before saving review result artifacts.")
  return captureReviewResultFromCandidates(folder.uri.fsPath, candidates)
}

async function buildDefaultCandidates(): Promise<CandidateText[]> {
  const candidates: CandidateText[] = []
  const editor = vscode.window.activeTextEditor
  if (editor && !editor.selection.isEmpty) {
    candidates.push({ source: "active editor selection", text: editor.document.getText(editor.selection) })
  }
  if (editor) {
    candidates.push({ source: "active editor", text: editor.document.getText() })
  }
  candidates.push({ source: "clipboard", text: await vscode.env.clipboard.readText() })
  return candidates.filter((candidate) => candidate.text.trim().length > 0)
}

async function presentCaptureResult(result: CaptureReviewResultResult): Promise<void> {
  if (result.status !== "ok") {
    if (result.issues?.some((issue) => issue.message === "No review-result JSON was found.")) {
      await vscode.window.showWarningMessage("No review-result JSON was found in the active editor or clipboard.")
      return
    }
    await showValidationIssues(result.issues ?? [{ path: "$", message: "Review result validation failed." }])
    return
  }

  await vscode.window.showInformationMessage(`Review result captured: ${result.reviewId}`)
  if (result.markdownPath) await openMarkdownSummary(vscode.Uri.file(result.markdownPath))
}

async function openMarkdownSummary(markdownUri: vscode.Uri): Promise<void> {
  const document = await vscode.workspace.openTextDocument(markdownUri)
  await vscode.window.showTextDocument(document, { preview: false })
}

async function showValidationIssues(issues: Array<{ path: string; message: string }>): Promise<void> {
  const report = [
    "# Review Result JSON Validation Failed",
    "",
    ...issues.map((issue) => `- ${issue.path}: ${issue.message}`)
  ].join("\n")
  const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: report })
  await vscode.window.showTextDocument(doc, { preview: false })
}

async function pickWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? []
  if (folders.length === 0) {
    await vscode.window.showWarningMessage("Open a workspace folder first.")
    return undefined
  }
  if (folders.length === 1) return folders[0]
  const picked = await vscode.window.showQuickPick(
    folders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, folder })),
    { title: "Select workspace for review result artifacts" }
  )
  return picked?.folder
}
