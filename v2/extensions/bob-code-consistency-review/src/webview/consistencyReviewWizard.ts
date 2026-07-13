import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as vscode from "vscode"
import { discoverReviewInputCandidates, type ReviewInputDocumentCandidate } from "../core/reviewInputDiscovery"
import {
  CHANGE_TYPE_VALUES,
  REVIEW_FOCUS_VALUES,
  type ChangeType,
  type ReviewFocus,
  type ReviewInputDraft,
  type VcsKind,
  VCS_VALUES,
  writeReviewInputFromDraft
} from "../core/reviewInputBuilder"
import { resolveWorkspacePathStrict } from "../core/fileSystem"
import { DEFAULT_TRACEABILITY_CATALOG_PATH, DEFAULT_TRACEABILITY_GATE_REPORT_PATH, readTraceabilityCatalog, validateAndWriteTraceabilityGateReport } from "../core/traceabilityCatalogStore"
import type { TraceabilityCatalog, TraceabilityStatus } from "../core/traceabilityCatalog"
import { resolveBobWorkspaceRoot } from "../workspaceResolver"
import { renderConsistencyReviewWizardHtml, type ConsistencyReviewWizardModel, type ConsistencyWizardPackageFile } from "./consistencyReviewWizardHtml"

type ConsistencyWizardAction =
  | "createReviewInput"
  | "openTraceabilityPrep"
  | "createReviewInputFromTraceability"
  | "validateTraceability"
  | "preprocess"
  | "openResultCapture"
  | "openHumanTriage"

interface ConsistencyWizardMessage {
  type: "consistencyWizard.action"
  action: ConsistencyWizardAction
  draft?: Record<string, unknown>
}

export function openConsistencyReviewWizard(context: vscode.ExtensionContext): void {
  const panel = vscode.window.createWebviewPanel("bobCodeConsistencyReviewWizard", "Consistency Review Wizard", vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true
  })
  const controller = new ConsistencyReviewWizardController(context, panel)
  context.subscriptions.push(panel.webview.onDidReceiveMessage((message) => controller.handleMessage(message)))
  void controller.initialize()
}

class ConsistencyReviewWizardController {
  private workspaceRoot = ""
  private documents: ReviewInputDocumentCandidate[] = []
  private model?: ConsistencyReviewWizardModel

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel
  ) {}

  async initialize(): Promise<void> {
    this.workspaceRoot = await requireWorkspaceRoot()
    this.model = await this.buildModel([])
    this.render()
  }

  async handleMessage(rawMessage: unknown): Promise<void> {
    const message = parseConsistencyWizardMessage(rawMessage)
    if (!message) {
      this.post({ error: true, message: "不正な画面操作を拒否しました。" })
      return
    }
    try {
      if (message.action === "createReviewInput") {
        await this.createReviewInput(message.draft ?? {})
      } else if (message.action === "openTraceabilityPrep") {
        await vscode.commands.executeCommand("bobCodeConsistency.openTraceabilityPrep", { workspaceRoot: this.workspaceRoot })
      } else if (message.action === "createReviewInputFromTraceability") {
        await vscode.commands.executeCommand("bobCodeConsistency.createReviewInputFromTraceability", { workspaceRoot: this.workspaceRoot })
      } else if (message.action === "validateTraceability") {
        await vscode.commands.executeCommand("bobCodeConsistency.validateTraceabilityCatalog", { workspaceRoot: this.workspaceRoot })
      } else if (message.action === "preprocess") {
        await vscode.commands.executeCommand("bobCodeConsistency.preprocess", { workspaceRoot: this.workspaceRoot })
        this.model = await this.buildModel(["review-package を更新しました。"])
        this.render()
      } else if (message.action === "openResultCapture") {
        await vscode.commands.executeCommand("bobCodeConsistency.openResultCaptureGui")
      } else if (message.action === "openHumanTriage") {
        await vscode.commands.executeCommand("bobCodeConsistency.openHumanTriageGui")
      }
      this.post({ ok: true, message: "操作を実行しました。" })
    } catch (error) {
      this.post({ error: true, message: error instanceof Error ? error.message : String(error) })
    }
  }

  private render(): void {
    if (!this.model) return
    this.panel.webview.html = renderConsistencyReviewWizardHtml({
      cspSource: this.panel.webview.cspSource,
      nonce: nonce(),
      model: this.model
    })
  }

  private async buildModel(extraWarnings: string[]): Promise<ConsistencyReviewWizardModel> {
    const config = vscode.workspace.getConfiguration("bobCodeConsistency")
    const textEncoding = config.get<string>("textEncoding", "auto")
    const discovery = await discoverReviewInputCandidates(this.workspaceRoot, { textEncoding })
    this.documents = discovery.documents
    const traceability = await traceabilitySummary({
      workspaceRoot: this.workspaceRoot,
      catalogPath: config.get<string>("traceabilityCatalogPath", DEFAULT_TRACEABILITY_CATALOG_PATH),
      reportPath: config.get<string>("traceabilityGateReportPath", DEFAULT_TRACEABILITY_GATE_REPORT_PATH),
      textEncoding
    })
    return {
      workspaceRoot: this.workspaceRoot,
      base: "HEAD~1",
      head: "HEAD",
      vcs: "git",
      changeType: "maintenance",
      focus: ["requirement-code-consistency", "design-code-consistency", "test-gap"],
      documents: this.documents,
      traceability,
      packagePreview: await listPackagePreview(this.workspaceRoot, config.get<string>("reviewPackagePath", ".bob-review/review-package")),
      warnings: [...discovery.warnings, ...extraWarnings]
    }
  }

  private async createReviewInput(rawDraft: Record<string, unknown>): Promise<void> {
    const selectedPaths = stringArray(rawDraft.documentPaths)
    const selectedDocuments = selectedPaths.length > 0
      ? this.documents.filter((candidate) => selectedPaths.includes(candidate.path))
      : this.documents
    if (selectedDocuments.length === 0) throw new Error("関連文書候補を選択してください。")
    const draft: ReviewInputDraft = {
      review: {
        id: stringValue(rawDraft.reviewId) || "code-consistency-review",
        title: stringValue(rawDraft.reviewTitle) || "コード整合プレレビュー",
        purpose: "要求・設計・テスト仕様とコード変更の整合性を確認する",
        change_type: changeTypeValue(rawDraft.changeType),
        vcs: vcsValue(rawDraft.vcs),
        base: stringValue(rawDraft.base) || "HEAD~1",
        head: stringValue(rawDraft.head) || "HEAD"
      },
      artifact_candidates: selectedDocuments.map(stripCandidateUiFields),
      review_focus: focusValues(rawDraft.focus)
    }
    const config = vscode.workspace.getConfiguration("bobCodeConsistency")
    const outputPath = resolveWorkspacePathStrict(this.workspaceRoot, config.get<string>("reviewInputPath", "review-input.yaml"), "reviewInputPath")
    const result = await writeReviewInputFromDraft({
      draft,
      workspaceRoot: this.workspaceRoot,
      outputPath,
      overwrite: true,
      backupExisting: true,
      strictPaths: true
    })
    if (result.status === "error") throw new Error(result.errors.join("; "))
    const document = await vscode.workspace.openTextDocument(result.outputPath)
    await vscode.window.showTextDocument(document, { preview: false })
    this.post({ ok: true, message: `review-input.yaml を生成しました: ${result.outputPath}` })
  }

  private post(message: Record<string, unknown>): void {
    void this.panel.webview.postMessage(message)
  }
}

function parseConsistencyWizardMessage(message: unknown): ConsistencyWizardMessage | undefined {
  if (!message || typeof message !== "object") return undefined
  const candidate = message as Partial<Record<keyof ConsistencyWizardMessage, unknown>>
  if (candidate.type !== "consistencyWizard.action") return undefined
  if (!isConsistencyWizardAction(candidate.action)) return undefined
  return {
    type: "consistencyWizard.action",
    action: candidate.action,
    draft: candidate.draft && typeof candidate.draft === "object" ? candidate.draft as Record<string, unknown> : undefined
  }
}

async function requireWorkspaceRoot(): Promise<string> {
  const root = await resolveBobWorkspaceRoot({ allowPick: true, title: "Bob コード整合レビュー workspace を選択" })
  if (!root) throw new Error("先にワークスペースフォルダーを開いてください。")
  return root
}

async function traceabilitySummary(input: {
  workspaceRoot: string
  catalogPath: string
  reportPath: string
  textEncoding: string
}): Promise<ConsistencyReviewWizardModel["traceability"]> {
  const read = await readTraceabilityCatalog(input)
  if (read.status === "error") return { proposed: 0, accepted: 0, rejected: 0, deprecated: 0, errors: read.errors.length, warnings: 0 }
  const gate = await validateAndWriteTraceabilityGateReport({ ...input, expectedRevision: read.revision })
  const counts = countStatuses(read.catalog)
  return {
    ...counts,
    errors: gate.status === "ok" ? gate.report.errors.length : gate.errors.length,
    warnings: gate.status === "ok" ? gate.report.warnings.length : 0
  }
}

function countStatuses(catalog: TraceabilityCatalog): Record<TraceabilityStatus, number> {
  const counts: Record<TraceabilityStatus, number> = { proposed: 0, accepted: 0, rejected: 0, deprecated: 0 }
  for (const item of [...(catalog.domains ?? []), ...(catalog.items ?? []), ...(catalog.links ?? []), ...(catalog.decisions ?? [])]) {
    if (isTraceabilityStatus(item.status)) counts[item.status] += 1
  }
  return counts
}

function isTraceabilityStatus(value: unknown): value is TraceabilityStatus {
  return value === "proposed" || value === "accepted" || value === "rejected" || value === "deprecated"
}

async function listPackagePreview(workspaceRoot: string, packageDir: string): Promise<ConsistencyWizardPackageFile[]> {
  const root = resolveWorkspacePathStrict(workspaceRoot, packageDir, "reviewPackagePath")
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => ({
        label: entry.name,
        path: path.relative(workspaceRoot, path.join(root, entry.name)).replace(/\\/g, "/")
      }))
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, 20)
  } catch {
    return []
  }
}

function stripCandidateUiFields(candidate: ReviewInputDocumentCandidate) {
  const { label: _label, description: _description, ...artifact } = candidate
  return artifact
}

function isConsistencyWizardAction(value: unknown): value is ConsistencyWizardAction {
  return value === "createReviewInput" ||
    value === "openTraceabilityPrep" ||
    value === "createReviewInputFromTraceability" ||
    value === "validateTraceability" ||
    value === "preprocess" ||
    value === "openResultCapture" ||
    value === "openHumanTriage"
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => stringValue(item)).filter((item): item is string => Boolean(item)) : []
}

function vcsValue(value: unknown): VcsKind {
  const text = stringValue(value)
  return text && (VCS_VALUES as readonly string[]).includes(text) ? text as VcsKind : "git"
}

function changeTypeValue(value: unknown): ChangeType {
  const text = stringValue(value)
  return text && (CHANGE_TYPE_VALUES as readonly string[]).includes(text) ? text as ChangeType : "maintenance"
}

function focusValues(value: unknown): ReviewFocus[] {
  const values = stringArray(value).filter((item): item is ReviewFocus => (REVIEW_FOCUS_VALUES as readonly string[]).includes(item))
  return values.length > 0 ? values : ["requirement-code-consistency", "design-code-consistency", "test-gap"]
}

function nonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  let value = ""
  for (let index = 0; index < 32; index += 1) value += chars.charAt(Math.floor(Math.random() * chars.length))
  return value
}
