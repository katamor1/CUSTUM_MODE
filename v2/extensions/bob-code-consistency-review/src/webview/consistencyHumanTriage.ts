import * as path from "node:path"
import * as vscode from "vscode"
import YAML from "yaml"
import { pathExists, readTextFile, resolveWorkspacePathForKind, writeTextFile } from "../core/fileSystem"
import { runTriage } from "../reviewExecutionCommands"
import { resolveBobWorkspaceRoot } from "../workspaceResolver"
import { renderConsistencyHumanTriageHtml, type ConsistencyHumanTriageItem, type ConsistencyHumanTriageModel } from "./consistencyHumanTriageHtml"

type HumanTriageAction = "generateTriage" | "saveDecisions" | "openResultCapture"

interface HumanTriageMessage {
  type: "consistencyHumanTriage.action"
  action: HumanTriageAction
  items?: unknown[]
}

export function openConsistencyHumanTriageGui(context: vscode.ExtensionContext): void {
  const panel = vscode.window.createWebviewPanel("bobCodeConsistencyHumanTriage", "Code Consistency Human Triage", vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true
  })
  const controller = new ConsistencyHumanTriageController(panel)
  context.subscriptions.push(panel.webview.onDidReceiveMessage((message) => controller.handleMessage(message)))
  void controller.initialize()
}

class ConsistencyHumanTriageController {
  private workspaceRoot = ""
  private model?: ConsistencyHumanTriageModel

  constructor(private readonly panel: vscode.WebviewPanel) {}

  async initialize(): Promise<void> {
    this.workspaceRoot = await requireWorkspaceRoot()
    this.model = await this.loadModel([])
    this.render()
  }

  async handleMessage(rawMessage: unknown): Promise<void> {
    const message = parseHumanTriageMessage(rawMessage)
    if (!message) {
      this.post({ error: true, message: "不正な画面操作を拒否しました。" })
      return
    }
    try {
      if (message.action === "generateTriage") {
        const result = await runTriage({ workspaceRoot: this.workspaceRoot })
        this.model = await this.loadModel([describeResult(result)])
        this.render()
      } else if (message.action === "saveDecisions") {
        await this.saveDecisions(message.items ?? [])
      } else if (message.action === "openResultCapture") {
        await vscode.commands.executeCommand("bobCodeConsistency.openResultCaptureGui")
        this.post({ ok: true, message: "Result Capture を開きました。" })
      }
    } catch (error) {
      this.post({ error: true, message: error instanceof Error ? error.message : String(error) })
    }
  }

  private render(): void {
    if (!this.model) return
    this.panel.webview.html = renderConsistencyHumanTriageHtml({
      cspSource: this.panel.webview.cspSource,
      nonce: nonce(),
      model: this.model
    })
  }

  private async loadModel(issues: string[]): Promise<ConsistencyHumanTriageModel> {
    const config = vscode.workspace.getConfiguration("bobCodeConsistency")
    const outDirValue = config.get<string>("triagePath", ".bob-review/human-triage")
    const bobOutputPath = config.get<string>("bobOutputPath", ".bob-review/bob-output/bob-output.yaml")
    const outDir = resolveWorkspacePathForKind(this.workspaceRoot, outDirValue, "human-triage-output")
    const triagePath = path.join(outDir, "triage-result.yaml")
    const items = await readTriageItems(triagePath)
    return {
      outDir: outDirValue,
      bobOutputPath,
      items,
      issues
    }
  }

  private async saveDecisions(rawItems: unknown[]): Promise<void> {
    const config = vscode.workspace.getConfiguration("bobCodeConsistency")
    const outDir = resolveWorkspacePathForKind(this.workspaceRoot, config.get<string>("triagePath", ".bob-review/human-triage"), "human-triage-output")
    const triagePath = path.join(outDir, "triage-result.yaml")
    if (!(await pathExists(triagePath))) throw new Error("triage-result.yaml がありません。先に triage を生成してください。")
    const parsed = YAML.parse(await readTextFile(triagePath)) as Record<string, unknown>
    const items = rawItems.map(normalizePostedItem)
    parsed.items = items
    await writeTextFile(triagePath, YAML.stringify(parsed))
    this.model = await this.loadModel([`保存しました: ${triagePath}`])
    this.render()
  }

  private post(message: Record<string, unknown>): void {
    void this.panel.webview.postMessage(message)
  }
}

async function readTriageItems(triagePath: string): Promise<ConsistencyHumanTriageItem[]> {
  if (!(await pathExists(triagePath))) return []
  const parsed = YAML.parse(await readTextFile(triagePath)) as { items?: unknown[] }
  return Array.isArray(parsed.items) ? parsed.items.map(normalizePostedItem) : []
}

function parseHumanTriageMessage(message: unknown): HumanTriageMessage | undefined {
  if (!message || typeof message !== "object") return undefined
  const candidate = message as Partial<Record<keyof HumanTriageMessage, unknown>>
  if (candidate.type !== "consistencyHumanTriage.action") return undefined
  if (!isHumanTriageAction(candidate.action)) return undefined
  return {
    type: "consistencyHumanTriage.action",
    action: candidate.action,
    items: Array.isArray(candidate.items) ? candidate.items : undefined
  }
}

async function requireWorkspaceRoot(): Promise<string> {
  const root = await resolveBobWorkspaceRoot({ allowPick: true, title: "Bob コード整合 triage workspace を選択" })
  if (!root) throw new Error("先にワークスペースフォルダーを開いてください。")
  return root
}

function normalizePostedItem(value: unknown): ConsistencyHumanTriageItem {
  if (!value || typeof value !== "object") throw new Error("triage item が不正です。")
  const record = value as Record<string, unknown>
  return {
    source_id: stringOrUndefined(record.source_id),
    source_type: stringOrUndefined(record.source_type),
    decision: stringOrUndefined(record.decision),
    final_severity: stringOrUndefined(record.final_severity),
    owner: stringOrUndefined(record.owner),
    reason: stringOrUndefined(record.reason),
    review_comment: stringOrUndefined(record.review_comment),
    question: stringOrUndefined(record.question),
    follow_up: record.follow_up && typeof record.follow_up === "object" ? record.follow_up as Record<string, unknown> : undefined
  }
}

function isHumanTriageAction(value: unknown): value is HumanTriageAction {
  return value === "generateTriage" || value === "saveDecisions" || value === "openResultCapture"
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function describeResult(result: unknown): string {
  if (!result || typeof result !== "object") return String(result ?? "")
  const record = result as Record<string, unknown>
  if (typeof record.message === "string") return record.message
  if (typeof record.status === "string" && typeof record.outDir === "string") return `${record.status}: ${record.outDir}`
  return JSON.stringify(record)
}

function nonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  let value = ""
  for (let index = 0; index < 32; index += 1) value += chars.charAt(Math.floor(Math.random() * chars.length))
  return value
}
