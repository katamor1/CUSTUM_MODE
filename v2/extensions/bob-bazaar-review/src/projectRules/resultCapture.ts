import * as vscode from "vscode"
import {
  CandidateText,
  CaptureReviewResultOptions,
  CaptureReviewResultResult,
  captureReviewResultFromCandidates,
  extractJsonFromText
} from "./resultCaptureCore"
import { resolveBobWorkspaceFolder } from "../workspaceResolver"

export { CaptureReviewResultResult, extractJsonFromText }

export async function captureReviewResult(inputText?: string, options: CaptureReviewResultOptions = {}): Promise<CaptureReviewResultResult> {
  const explicitInput = typeof inputText === "string" && inputText.trim().length > 0
  const candidates = explicitInput
    ? [{ source: "command argument", text: inputText }]
    : await buildDefaultCandidates()
  const result = await captureCandidatesWithWorkspace(candidates, options)
  if (!explicitInput) await presentCaptureResult(result)
  return result
}

export async function saveReviewResultFromClipboard(): Promise<CaptureReviewResultResult> {
  const result = await captureCandidatesWithWorkspace([{ source: "clipboard", text: await vscode.env.clipboard.readText() }])
  await presentCaptureResult(result)
  return result
}

async function captureCandidatesWithWorkspace(candidates: CandidateText[], options: CaptureReviewResultOptions = {}): Promise<CaptureReviewResultResult> {
  const workspaceRoot = options.workspaceRoot ?? (await pickWorkspaceFolder())?.uri.fsPath
  if (!workspaceRoot) throw new Error("レビュー結果 artifact を保存する前に Bob ワークスペースフォルダーを開いてください。")
  return captureReviewResultFromCandidates(workspaceRoot, candidates, options)
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
      await vscode.window.showWarningMessage("アクティブエディターまたはクリップボードに review-result JSON が見つかりませんでした。")
      return
    }
    await showValidationIssues(result.issues ?? [{ path: "$", message: "Review result validation failed." }])
    return
  }

  await vscode.window.showInformationMessage(`レビュー結果を保存しました: ${result.reviewId}`)
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
  return resolveBobWorkspaceFolder({ allowPick: true, title: "レビュー結果 artifact の保存先 Bob ワークスペースを選択" })
}
