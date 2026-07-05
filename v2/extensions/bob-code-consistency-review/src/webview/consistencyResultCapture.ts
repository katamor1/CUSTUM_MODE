import * as vscode from "vscode"
import { runCaptureBobOutput, runValidateOutput } from "../reviewExecutionCommands"
import { renderConsistencyResultCaptureHtml } from "./consistencyResultCaptureHtml"

type ResultCaptureAction = "captureManual" | "captureClipboard" | "validateOutput" | "openHumanTriage"

interface ResultCaptureMessage {
  type: "consistencyResultCapture.action"
  action: ResultCaptureAction
  text?: string
}

export function openConsistencyResultCaptureGui(context: vscode.ExtensionContext): void {
  const panel = vscode.window.createWebviewPanel("bobCodeConsistencyResultCapture", "Code Consistency Result Capture", vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true
  })
  const controller = new ConsistencyResultCaptureController(panel)
  context.subscriptions.push(panel.webview.onDidReceiveMessage((message) => controller.handleMessage(message)))
  panel.webview.html = renderConsistencyResultCaptureHtml({
    cspSource: panel.webview.cspSource,
    nonce: nonce()
  })
}

class ConsistencyResultCaptureController {
  constructor(private readonly panel: vscode.WebviewPanel) {}

  async handleMessage(rawMessage: unknown): Promise<void> {
    const message = parseResultCaptureMessage(rawMessage)
    if (!message) {
      this.post({ error: true, message: "不正な画面操作を拒否しました。" })
      return
    }
    try {
      if (message.action === "captureManual") {
        if (!message.text?.trim()) throw new Error("Bob output YAML を貼り付けてください。")
        const result = await runCaptureBobOutput({ text: message.text })
        this.post({ ok: true, message: describeResult(result) })
      } else if (message.action === "captureClipboard") {
        const result = await runCaptureBobOutput()
        this.post({ ok: true, message: describeResult(result) })
      } else if (message.action === "validateOutput") {
        const result = await runValidateOutput()
        this.post({ ok: resultStatus(result) !== "error", message: describeResult(result) })
      } else if (message.action === "openHumanTriage") {
        await vscode.commands.executeCommand("bobCodeConsistency.openHumanTriageGui")
        this.post({ ok: true, message: "Human Triage を開きました。" })
      }
    } catch (error) {
      this.post({ error: true, message: error instanceof Error ? error.message : String(error) })
    }
  }

  private post(message: Record<string, unknown>): void {
    void this.panel.webview.postMessage(message)
  }
}

function parseResultCaptureMessage(message: unknown): ResultCaptureMessage | undefined {
  if (!message || typeof message !== "object") return undefined
  const candidate = message as Partial<Record<keyof ResultCaptureMessage, unknown>>
  if (candidate.type !== "consistencyResultCapture.action") return undefined
  if (!isResultCaptureAction(candidate.action)) return undefined
  return {
    type: "consistencyResultCapture.action",
    action: candidate.action,
    text: typeof candidate.text === "string" ? candidate.text : undefined
  }
}

function isResultCaptureAction(value: unknown): value is ResultCaptureAction {
  return value === "captureManual" || value === "captureClipboard" || value === "validateOutput" || value === "openHumanTriage"
}

function describeResult(result: unknown): string {
  if (!result || typeof result !== "object") return String(result ?? "")
  const record = result as Record<string, unknown>
  if (typeof record.message === "string") return record.message
  const status = typeof record.status === "string" ? record.status : "ok"
  const errors = Array.isArray(record.errors) ? record.errors.length : 0
  const warnings = Array.isArray(record.warnings) ? record.warnings.length : 0
  return `status: ${status}; errors: ${errors}; warnings: ${warnings}`
}

function resultStatus(result: unknown): string {
  return result && typeof result === "object" && typeof (result as Record<string, unknown>).status === "string"
    ? String((result as Record<string, unknown>).status)
    : "ok"
}

function nonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  let value = ""
  for (let index = 0; index < 32; index += 1) value += chars.charAt(Math.floor(Math.random() * chars.length))
  return value
}
