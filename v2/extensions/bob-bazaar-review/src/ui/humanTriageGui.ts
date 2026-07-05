import { randomBytes } from "node:crypto"
import * as path from "node:path"
import * as vscode from "vscode"
import {
  createReviewRecord,
  createReviewTriage,
  generateReviewCampaignSummary,
  initReviewRecordCampaign,
  validateReviewTriageCommand
} from "../records/reviewRecordCommands"
import type { ReviewRecordCommandInput } from "../records/reviewRecordCommands"
import { readTriage, writeTriage } from "../records/reviewRecordStore"
import { summarizeTriageItems, validateTriage } from "../records/reviewTriage"
import type { ReviewTriage, TriageDecision, TriageItem } from "../records/reviewRecordTypes"
import { renderHumanTriageHtml, type HumanTriageGuiModel } from "./humanTriageGuiHtml"

type HumanTriageAction =
  | "initCampaign"
  | "createTriage"
  | "validateTriage"
  | "createRecord"
  | "generateSummary"
  | "saveDecisions"

interface HumanTriageMessage {
  type: "bazaarHumanTriage.action"
  action: HumanTriageAction
  campaignId?: string
  reviewId?: string
  reviewResultJsonPath?: string
  items?: unknown[]
}

export function openBazaarHumanTriageGui(context: vscode.ExtensionContext): void {
  const panel = vscode.window.createWebviewPanel("bobBazaarHumanTriage", "Bazaar Human Triage", vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true
  })
  const controller = new BazaarHumanTriageGuiController(context, panel)
  context.subscriptions.push(panel.webview.onDidReceiveMessage((message) => controller.handleMessage(message)))
  controller.render(defaultModel())
}

class BazaarHumanTriageGuiController {
  private model: HumanTriageGuiModel = defaultModel()

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel
  ) {}

  render(model: HumanTriageGuiModel = this.model): void {
    this.model = model
    this.panel.webview.html = renderHumanTriageHtml({
      cspSource: this.panel.webview.cspSource,
      nonce: randomBytes(16).toString("base64"),
      model
    })
  }

  async handleMessage(rawMessage: unknown): Promise<void> {
    const message = parseHumanTriageMessage(rawMessage)
    if (!message) {
      this.post({ error: true, message: "不正な画面操作を拒否しました。" })
      return
    }
    try {
      const input = await this.commandInput(message)
      if (message.action === "initCampaign") {
        const result = await initReviewRecordCampaign(this.context, input)
        this.post({ ok: true, message: `campaign を初期化しました: ${result.targetRoot}` })
      } else if (message.action === "createTriage") {
        const result = await createReviewTriage(input)
        await this.reloadTriage(input, result.path, result.issues)
      } else if (message.action === "validateTriage") {
        const result = await validateReviewTriageCommand(input)
        this.post({ ok: result.status === "ok", message: result.issues.join("\n") || "triage は検証に通りました。" })
      } else if (message.action === "createRecord") {
        const result = await createReviewRecord(input)
        this.post({ ok: result.issues.length === 0, message: [`record を作成しました: ${result.path}`, ...result.issues].join("\n") })
      } else if (message.action === "generateSummary") {
        const result = await generateReviewCampaignSummary(input)
        this.post({ ok: true, message: `summary を生成しました:\n${result.markdownPath}` })
      } else if (message.action === "saveDecisions") {
        await this.saveDecisions(input, message.items ?? [])
      }
    } catch (error) {
      this.post({ error: true, message: error instanceof Error ? error.message : String(error) })
    }
  }

  private async commandInput(message: HumanTriageMessage): Promise<ReviewRecordCommandInput> {
    const workspaceRoot = await resolveWorkspaceRoot()
    const campaignId = textOrDefault(message.campaignId, this.model.campaignId)
    const reviewId = textOrDefault(message.reviewId, this.model.reviewId)
    const reviewResultJsonPath = textOrDefault(message.reviewResultJsonPath, `.bob/review/results/${reviewId}.json`)
    return { workspaceRoot, campaignId, reviewId, reviewResultJsonPath }
  }

  private async reloadTriage(input: ReviewRecordCommandInput, triagePath: string, issues: string[]): Promise<void> {
    const triage = await readTriage(required(input.workspaceRoot, "workspaceRoot"), required(input.campaignId, "campaignId"), required(input.reviewId, "reviewId"))
    this.render({
      campaignId: required(input.campaignId, "campaignId"),
      reviewId: required(input.reviewId, "reviewId"),
      reviewResultJsonPath: input.reviewResultJsonPath ?? `.bob/review/results/${input.reviewId}.json`,
      triagePath,
      issues,
      items: triage.items
    })
  }

  private async saveDecisions(input: ReviewRecordCommandInput, rawItems: unknown[]): Promise<void> {
    const workspaceRoot = required(input.workspaceRoot, "workspaceRoot")
    const campaignId = required(input.campaignId, "campaignId")
    const reviewId = required(input.reviewId, "reviewId")
    const current = await readTriage(workspaceRoot, campaignId, reviewId)
    const items = rawItems.map(normalizePostedItem)
    const next: ReviewTriage = {
      ...current,
      items,
      summary: summarizeTriageItems(items)
    }
    const issues = validateTriage(next)
    if (issues.length > 0) {
      this.render({
        campaignId,
        reviewId,
        reviewResultJsonPath: input.reviewResultJsonPath ?? `.bob/review/results/${reviewId}.json`,
        triagePath: path.join(workspaceRoot, ".bob-review-records", "campaigns", campaignId, "records", reviewId, "triage.yaml"),
        issues,
        items
      })
      return
    }
    const triagePath = await writeTriage(workspaceRoot, campaignId, reviewId, next)
    this.render({
      campaignId,
      reviewId,
      reviewResultJsonPath: input.reviewResultJsonPath ?? `.bob/review/results/${reviewId}.json`,
      triagePath,
      issues: [],
      items: next.items
    })
  }

  private post(message: Record<string, unknown>): void {
    void this.panel.webview.postMessage(message)
  }
}

function defaultModel(): HumanTriageGuiModel {
  return {
    campaignId: "phase1-bazaar-review-uat-001",
    reviewId: "",
    reviewResultJsonPath: ".bob/review/results/<review_id>.json",
    issues: [],
    items: []
  }
}

function parseHumanTriageMessage(message: unknown): HumanTriageMessage | undefined {
  if (!message || typeof message !== "object") return undefined
  const candidate = message as Partial<Record<keyof HumanTriageMessage, unknown>>
  if (candidate.type !== "bazaarHumanTriage.action") return undefined
  if (!isHumanTriageAction(candidate.action)) return undefined
  return {
    type: "bazaarHumanTriage.action",
    action: candidate.action,
    campaignId: typeof candidate.campaignId === "string" ? candidate.campaignId : undefined,
    reviewId: typeof candidate.reviewId === "string" ? candidate.reviewId : undefined,
    reviewResultJsonPath: typeof candidate.reviewResultJsonPath === "string" ? candidate.reviewResultJsonPath : undefined,
    items: Array.isArray(candidate.items) ? candidate.items : undefined
  }
}

function normalizePostedItem(value: unknown): TriageItem {
  if (!value || typeof value !== "object") throw new Error("triage item が不正です。")
  const item = value as Record<string, unknown>
  const findingId = requiredString(item.finding_id, "finding_id")
  const decision = requiredDecision(item.decision)
  return {
    finding_id: findingId,
    rule_id: typeof item.rule_id === "string" && item.rule_id.trim() ? item.rule_id.trim() : undefined,
    decision,
    action: stringOrUndefined(item.action),
    owner: stringOrUndefined(item.owner),
    reason: stringOrUndefined(item.reason)
  }
}

function isHumanTriageAction(value: unknown): value is HumanTriageAction {
  return value === "initCampaign" ||
    value === "createTriage" ||
    value === "validateTriage" ||
    value === "createRecord" ||
    value === "generateSummary" ||
    value === "saveDecisions"
}

async function resolveWorkspaceRoot(): Promise<string> {
  const folders = vscode.workspace.workspaceFolders ?? []
  if (folders.length === 1) return folders[0].uri.fsPath
  const picked = await vscode.window.showWorkspaceFolderPick({ placeHolder: "Bazaar human triage の workspace を選択" })
  if (!picked) throw new Error("workspaceRoot is required")
  return picked.uri.fsPath
}

function textOrDefault(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  return trimmed || fallback
}

function required(value: string | undefined, fieldName: string): string {
  if (!value?.trim()) throw new Error(`${fieldName} is required`)
  return value
}

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${fieldName} is required`)
  return value.trim()
}

function requiredDecision(value: unknown): TriageDecision {
  if (value === "accepted" || value === "rejected" || value === "needs_investigation" || value === "deferred") return value
  throw new Error(`invalid triage decision: ${String(value)}`)
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}
