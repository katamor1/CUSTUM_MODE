import * as vscode from "vscode"
import { renderReviewResultMarkdown } from "./markdown"
import { ReviewResult } from "./types"
import { validateReviewResultJson } from "./validator"

export async function validateActiveReviewResultJson(): Promise<void> {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    await vscode.window.showWarningMessage("先にレビュー結果 JSON ドキュメントを開いてください。")
    return
  }

  const raw = editor.document.getText(editor.selection.isEmpty ? undefined : editor.selection)
  const validation = validateReviewResultJson(raw)
  if (!validation.valid) {
    const report = [
      "# レビュー結果 JSON 検証エラー",
      "",
      ...validation.issues.map((issue) => `- ${issue.path}: ${issue.message}`)
    ].join("\n")
    const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: report })
    await vscode.window.showTextDocument(doc, { preview: false })
    return
  }

  const action = await vscode.window.showInformationMessage("レビュー結果 JSON は有効です。", "Markdown サマリを表示")
  if (action === "Markdown サマリを表示") {
    const result = JSON.parse(raw) as ReviewResult
    const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: renderReviewResultMarkdown(result) })
    await vscode.window.showTextDocument(doc, { preview: false })
  }
}
