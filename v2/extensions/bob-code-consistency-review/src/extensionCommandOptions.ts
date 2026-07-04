import * as vscode from "vscode"
import {
  CHANGE_TYPE_VALUES,
  REVIEW_FOCUS_VALUES,
  VCS_VALUES,
  type ChangeType,
  type ReviewFocus,
  type VcsKind
} from "./core/reviewInputBuilder"
import { resolveWorkspacePathStrict } from "./core/fileSystem"
import { resolveBobWorkspaceRoot } from "./workspaceResolver"

/** VS Code command / workflow provider で共有する option、prompt、path、通知 helper。 */
export function notifyInfo(message: string): void {
  console.info(message)
  vscode.window.setStatusBarMessage(message, 5000)
}

export function notifyInfoWithReport(message: string, reportPath: string): void {
  notifyInfo(message)
  void vscode.window.showInformationMessage(message, "Open Report").then((selection) => {
    if (selection !== "Open Report") return undefined
    return vscode.workspace.openTextDocument(reportPath)
      .then((document) => vscode.window.showTextDocument(document, { preview: false }))
      .then(undefined, (error) => console.warn(`Failed to open report: ${reportPath}`, error))
  })
}

export function notifyError(message: string): void {
  void vscode.window.showErrorMessage(message)
}

export async function requireBobWorkspaceRoot(record: Record<string, unknown>): Promise<string> {
  const root = await resolveBobWorkspaceRoot({
    explicitRoot: stringOption(record, "bobRoot") ?? stringOption(record, "workspaceRoot"),
    workflowRoot: stringOption(record, "workflowRoot"),
    allowPick: true,
    title: "Bob ワークスペースを選択"
  })
  if (!root) throw new Error("先にワークスペースフォルダーを開いてください。")
  return root
}

export async function pickValue<const T extends string>(values: readonly T[], placeHolder: string): Promise<T | undefined> {
  const picked = await vscode.window.showQuickPick(values.map((value) => ({ label: value })), { placeHolder })
  return picked?.label as T | undefined
}

export async function stringOrPrompt(record: Record<string, unknown>, key: string, prompt: string, value: string): Promise<string | undefined> {
  const existing = stringOption(record, key)
  if (existing) return existing
  return vscode.window.showInputBox({ prompt, value })
}

export async function vcsOrPrompt(record: Record<string, unknown>): Promise<VcsKind | undefined> {
  const existing = stringOption(record, "vcs")
  if (existing && (VCS_VALUES as readonly string[]).includes(existing)) return existing as VcsKind
  return pickValue(VCS_VALUES, "AI draft 用の VCS を選択")
}

export function changeTypeOption(record: Record<string, unknown>): ChangeType | undefined {
  const existing = stringOption(record, "changeType") ?? stringOption(record, "change_type")
  if (existing && (CHANGE_TYPE_VALUES as readonly string[]).includes(existing)) return existing as ChangeType
  return undefined
}

export function reviewFocusOption(record: Record<string, unknown>): ReviewFocus[] | undefined {
  const values = stringArrayOption(record, "reviewFocus") ?? stringArrayOption(record, "review_focus")
  if (!values) return undefined
  const result = values.filter((value): value is ReviewFocus => (REVIEW_FOCUS_VALUES as readonly string[]).includes(value))
  return result.length > 0 ? result : undefined
}

export function stringArrayOption(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key]
  if (Array.isArray(value)) {
    const result = value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean)
    return result.length > 0 ? result : undefined
  }
  if (typeof value === "string" && value.trim()) return splitCsv(value)
  return undefined
}

export function splitCsv(value: string): string[] | undefined {
  const result = value.split(",").map((item) => item.trim()).filter(Boolean)
  return result.length > 0 ? result : undefined
}

export function absolute(root: string, value: string): string {
  return resolveWorkspacePathStrict(root, value)
}

export function optionalAbsolute(root: string, value: string | undefined): string | undefined {
  return value ? absolute(root, value) : undefined
}

export function resolveTrustedBzrPath(record: Record<string, unknown>, configuredPath: string | undefined): string {
  if (stringOption(record, "bzrPath")) {
    throw new Error("bzrPath cannot be overridden by workflow args. Configure bobCodeConsistency.bzrPath in user or global settings.")
  }
  return configuredPath?.trim() || "bzr"
}

export function stringOption(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

export function booleanOption(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key]
  return typeof value === "boolean" ? value : undefined
}

export function numberOption(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return undefined
}

export function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item)
      if (found) return found
    }
  }
  return undefined
}
