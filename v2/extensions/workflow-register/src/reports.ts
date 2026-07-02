import * as vscode from "vscode"

export interface AttemptResult {
  label: string
  ok: boolean
  message: string
  value?: unknown
}

export async function runAttempt(label: string, run: () => unknown): Promise<AttemptResult> {
  try {
    const value = await Promise.resolve(run())
    return { label, ok: value !== false, message: describeReturn(value), value }
  } catch (error) {
    return { label, ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export function formatAttempt(attempt: { label: string; ok: boolean; message: string }): string {
  return `- ${attempt.ok ? "ok" : "fail"}: ${attempt.label} -> ${attempt.message}`
}

export function describeReturn(value: unknown): string {
  if (value === undefined) return "undefined"
  if (value === null) return "null"
  if (typeof value === "object") return `object(${Object.keys(value as Record<string, unknown>).slice(0, 20).join(",")})`
  return String(value)
}

export async function showMarkdownReport(title: string, summary: string, lines: string[]): Promise<void> {
  const report = [`# ${title}`, "", summary, "", ...lines].join("\n")
  const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: report })
  await vscode.window.showTextDocument(doc, { preview: false })
}
