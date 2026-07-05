import { randomBytes } from "node:crypto"
import * as vscode from "vscode"
import { captureReviewResult } from "../projectRules/resultCapture"
import type { CaptureReviewResultResult } from "../projectRules/resultCapture"
import { renderResultCaptureHtml } from "./resultCaptureGuiHtml"

type ResultCaptureAction = "captureCandidates" | "captureManual" | "validateActive" | "openTriage"

interface ResultCaptureMessage {
  type: "bazaarResultCapture.action"
  action: ResultCaptureAction
  text?: string
}

export function openBazaarResultCaptureGui(context: vscode.ExtensionContext): void {
  const panel = vscode.window.createWebviewPanel("bobBazaarResultCapture", "Bazaar Result Capture", vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true
  })
  const controller = new BazaarResultCaptureGuiController(panel)
  context.subscriptions.push(panel.webview.onDidReceiveMessage((message) => controller.handleMessage(message)))
  panel.webview.html = renderResultCaptureHtml({
    cspSource: panel.webview.cspSource,
    nonce: randomBytes(16).toString("base64")
  })
}

class BazaarResultCaptureGuiController {
  constructor(private readonly panel: vscode.WebviewPanel) {}

  async handleMessage(rawMessage: unknown): Promise<void> {
    const message = parseResultCaptureMessage(rawMessage)
    if (!message) {
      this.post({ error: true, message: "不正な画面操作を拒否しました。" })
      return
    }
    try {
      if (message.action === "captureCandidates") {
        this.postResult(await captureReviewResult())
      } else if (message.action === "captureManual") {
        if (!message.text?.trim()) throw new Error("Bob 出力 JSON を貼り付けてください。")
        this.postResult(await captureReviewResult(message.text))
      } else if (message.action === "validateActive") {
        await vscode.commands.executeCommand("bobBazaar.validateReviewResultJson")
        this.post({ ok: true, message: "開いている review-result JSON を検証しました。" })
      } else if (message.action === "openTriage") {
        await vscode.commands.executeCommand("bobBazaar.openHumanTriageGui")
        this.post({ ok: true, message: "Human Triage を開きました。" })
      }
    } catch (error) {
      this.post({ error: true, message: error instanceof Error ? error.message : String(error) })
    }
  }

  private postResult(result: CaptureReviewResultResult): void {
    if (result.status !== "ok") {
      this.post({
        error: true,
        message: [
          "保存できませんでした。",
          ...(result.issues ?? []).map((issue) => `${issue.path}: ${issue.message}`)
        ].join("\n")
      })
      return
    }
    this.post({
      ok: true,
      message: [
        `保存しました: ${result.reviewId}`,
        result.jsonPath ? `JSON: ${result.jsonPath}` : undefined,
        result.markdownPath ? `Markdown: ${result.markdownPath}` : undefined
      ].filter(Boolean).join("\n")
    })
  }

  private post(message: Record<string, unknown>): void {
    void this.panel.webview.postMessage(message)
  }
}

function parseResultCaptureMessage(message: unknown): ResultCaptureMessage | undefined {
  if (!message || typeof message !== "object") return undefined
  const candidate = message as Partial<Record<keyof ResultCaptureMessage, unknown>>
  if (candidate.type !== "bazaarResultCapture.action") return undefined
  if (!isResultCaptureAction(candidate.action)) return undefined
  return {
    type: "bazaarResultCapture.action",
    action: candidate.action,
    text: typeof candidate.text === "string" ? candidate.text : undefined
  }
}

function isResultCaptureAction(value: unknown): value is ResultCaptureAction {
  return value === "captureCandidates" || value === "captureManual" || value === "validateActive" || value === "openTriage"
}
