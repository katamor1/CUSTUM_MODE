import * as vscode from "vscode"
import { BazaarClient, BazaarCommandResult } from "./bazaar"
import { isBobCodeExtensionAvailable } from "./bobCodeExtension"
import { addMarkdownPacketToBobContext } from "./bobContext"
import { buildReviewPacket } from "./reviewPacket"
import { buildProjectRulesSection } from "./projectRules/packet"
import { loadProjectChecklist, loadReviewResultSchema } from "./projectRules/io"
import {
  buildAddedFilesContentSection,
  loadBazaarRevisionPacketInput,
  parseChangedFileEntries,
  BazaarRevisionInfo,
  BazaarChangedFile
} from "./revisionInfo"
import { getBobWorkspaceStatus, initializeBobWorkspaceFromTemplates } from "./bobWorkspaceInit"
import { completeCurrentWorkflowStepAfterGuiAction } from "./workflowStepCompletion"
import { resolveBazaarWorkspaceFolder, resolveBobWorkspaceFolder } from "./workspaceResolver"
import { renderHtml } from "./reviewGuiHtml"
import type { BazaarReviewInitialTarget, TargetMode } from "./reviewGuiTypes"

interface TargetRequest {
  mode: TargetMode
  revision?: string
  baseRevision?: string
  targetRevision?: string
  withProjectRules?: boolean
}

interface TargetInfo {
  mode: TargetMode
  targetLabel: string
  revision?: string
  baseRevision?: string
  targetRevision?: string
  revno?: string
  author: string
  committer: string
  timestamp: string
  message: string
  changedFileCount: number
  changedFiles: string[]
  changedFileEntries: BazaarChangedFile[]
}

interface PreparedTarget {
  root: string
  info: TargetInfo
  log?: BazaarCommandResult
  diff: BazaarCommandResult
  addedFilesSection?: string
}

export function openBazaarReviewGui(context: vscode.ExtensionContext, initialTarget?: BazaarReviewInitialTarget): void {
  const panel = vscode.window.createWebviewPanel("bobBazaarReviewGui", "Bazaar レビュー", vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true
  })
  const controller = new BazaarReviewGuiController(context, panel, initialTarget)
  controller.initialize()
}

class BazaarReviewGuiController {
  private bazaarWorkspaceFolder?: vscode.WorkspaceFolder
  private bobWorkspaceFolder?: vscode.WorkspaceFolder

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel,
    private readonly initialTarget?: BazaarReviewInitialTarget
  ) {}

  initialize(): void {
    this.panel.webview.html = renderHtml(this.panel.webview.cspSource, this.initialTarget)
    this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message), undefined, this.context.subscriptions)
  }

  private async handleMessage(message: any): Promise<void> {
    try {
      if (message?.type === "ready") await this.postWorkspaceState()
      else if (message?.type === "selectWorkspace") await this.selectWorkspace()
      else if (message?.type === "initializeBobWorkspace") await this.initializeBobWorkspace()
      else if (message?.type === "loadTarget") await this.loadTarget(parseTargetRequest(message))
      else if (message?.type === "reviewTarget") await this.reviewTarget(parseTargetRequest(message))
    } catch (error: any) {
      this.post({ type: "error", message: error?.message ?? String(error) })
    }
  }

  private async postWorkspaceState(): Promise<void> {
    if (!this.bazaarWorkspaceFolder) {
      this.bazaarWorkspaceFolder = await resolveBazaarWorkspaceFolder({
        explicitRoot: this.initialTarget?.bazaarRoot ?? this.initialTarget?.repositoryRoot,
        workflowRoot: this.initialTarget?.workflowRoot,
        allowPick: false
      })
    }
    if (!this.bobWorkspaceFolder) {
      this.bobWorkspaceFolder = await resolveBobWorkspaceFolder({
        workflowRoot: this.initialTarget?.workflowRoot,
        allowPick: false
      })
    }
    this.post({
      type: "workspaceState",
      workspace: this.bazaarWorkspaceFolder ? this.bazaarWorkspaceFolder.uri.fsPath : undefined,
      bobWorkspace: this.bobWorkspaceFolder ? this.bobWorkspaceFolder.uri.fsPath : undefined
    })
    await this.postBobWorkspaceStatus()
  }

  private async postBobWorkspaceStatus(): Promise<void> {
    if (!this.bobWorkspaceFolder) {
      this.post({ type: "bobWorkspaceStatus", initialized: false, missing: ["Bob ワークスペース未選択"], present: [] })
      return
    }
    const serverName = vscode.workspace.getConfiguration("bobBazaar").get<string>("mcpServerName", "bazaar")
    this.post({ type: "bobWorkspaceStatus", ...(await getBobWorkspaceStatus(this.bobWorkspaceFolder, serverName)) })
  }

  private async selectWorkspace(): Promise<void> {
    const folder = await resolveBazaarWorkspaceFolder({
      explicitRoot: this.initialTarget?.bazaarRoot ?? this.initialTarget?.repositoryRoot,
      workflowRoot: this.initialTarget?.workflowRoot,
      allowPick: true,
      title: "Bazaar ワークスペースを選択"
    })
    if (!folder) throw new Error("先に Bazaar ワークスペースフォルダーを開いてください。")
    this.bazaarWorkspaceFolder = folder
    if (!this.bobWorkspaceFolder) {
      this.bobWorkspaceFolder = await resolveBobWorkspaceFolder({ workflowRoot: this.initialTarget?.workflowRoot, allowPick: false })
    }
    await this.postWorkspaceState()
  }

  private async initializeBobWorkspace(): Promise<void> {
    const folder = await this.requireBobWorkspaceFolder()
    const config = vscode.workspace.getConfiguration("bobBazaar")
    this.post({ type: "loading", message: ".bob を初期化しています..." })
    const status = await initializeBobWorkspaceFromTemplates({
      context: this.context,
      workspaceFolder: folder,
      bzrPath: config.get<string>("bzrPath", "bzr"),
      serverName: config.get<string>("mcpServerName", "bazaar")
    })
    this.post({ type: "bobWorkspaceStatus", ...status })
    this.post({ type: "initialized", message: ".bob 初期化が完了しました。Bob MCP サーバーを Refresh / Restart してください。" })
  }

  private async loadTarget(request: TargetRequest): Promise<void> {
    const folder = await this.requireBazaarWorkspaceFolder()
    validateTargetRequest(request)
    this.post({ type: "loading", message: "対象情報を取得しています..." })
    const prepared = await prepareTarget(makeBazaarClient(), folder.uri.fsPath, request, false)
    this.post({ type: "targetInfo", info: prepared.info })
  }

  private async reviewTarget(request: TargetRequest): Promise<void> {
    const bazaarFolder = await this.requireBazaarWorkspaceFolder()
    const bobFolder = request.withProjectRules ? await this.requireBobWorkspaceFolder() : undefined
    validateTargetRequest(request)
    if (request.withProjectRules && bobFolder) {
      const serverName = vscode.workspace.getConfiguration("bobBazaar").get<string>("mcpServerName", "bazaar")
      const status = await getBobWorkspaceStatus(bobFolder, serverName)
      if (!status.initialized) {
        this.post({ type: "bobWorkspaceStatus", ...status })
        throw new Error(".bob が未初期化です。先に『.bob を初期化』ボタンを押してください。")
      }
    }

    this.post({ type: "loading", message: "レビュー packet を作成して Bob コンテキストへ追加しています..." })
    const prepared = await prepareTarget(makeBazaarClient(), bazaarFolder.uri.fsPath, request, true)
    const projectRulesSection = request.withProjectRules && bobFolder ? await buildProjectRulesSectionForWorkspace(bobFolder.uri.fsPath) : undefined
    const extraSections = [
      buildTargetMetadataSection(prepared.info),
      prepared.addedFilesSection,
      projectRulesSection
    ].filter((section): section is string => Boolean(section))
    const packet = buildReviewPacket({
      repositoryRoot: prepared.root,
      mode: request.mode,
      revision: request.revision,
      baseRevision: prepared.info.baseRevision,
      targetRevision: prepared.info.targetRevision,
      log: prepared.log,
      diff: prepared.diff,
      maxDiffBytes: getMaxDiffBytes(),
      extraSections
    })

    const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: packet })
    await vscode.window.showTextDocument(doc, { preview: false })
    let addResult: "added" | "clipboardFallback" | "skipped" = "skipped"
    let workflowStepCompleted = false
    if (isBobCodeExtensionAvailable()) {
      addResult = await addPacketToBobContext(doc.uri, packet)
      if (addResult === "added") {
        workflowStepCompleted = await completeCurrentWorkflowStepAfterGuiAction({
          executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args),
          showWarningMessage: (message) => vscode.window.showWarningMessage(message)
        })
      }
    } else {
      await vscode.window.showInformationMessage("IBM Bob 拡張機能が見つからないため、Bazaar Revision Review Request の Markdown を作成しました。Bob コンテキスト追加は行いません。")
    }
    this.post({
      type: "reviewAdded",
      info: prepared.info,
      packetBytes: Buffer.byteLength(packet, "utf8"),
      bobContextAvailable: addResult !== "skipped",
      bobContextAdded: addResult === "added",
      workflowStepCompleted
    })
  }

  private async requireBazaarWorkspaceFolder(): Promise<vscode.WorkspaceFolder> {
    if (!this.bazaarWorkspaceFolder) await this.selectWorkspace()
    if (!this.bazaarWorkspaceFolder) throw new Error("Bazaar ワークスペースフォルダーが選択されていません。")
    return this.bazaarWorkspaceFolder
  }

  private async requireBobWorkspaceFolder(): Promise<vscode.WorkspaceFolder> {
    if (!this.bobWorkspaceFolder) {
      this.bobWorkspaceFolder = await resolveBobWorkspaceFolder({
        workflowRoot: this.initialTarget?.workflowRoot,
        allowPick: true,
        title: "Bob ワークスペースを選択"
      })
    }
    if (!this.bobWorkspaceFolder) throw new Error("Bob ワークスペースフォルダーが選択されていません。")
    return this.bobWorkspaceFolder
  }

  private post(message: any): void {
    void this.panel.webview.postMessage(message)
  }
}

function parseTargetRequest(message: any): TargetRequest {
  return {
    mode: String(message.mode ?? "singleRevision") as TargetMode,
    revision: trimOrUndefined(message.revision),
    baseRevision: trimOrUndefined(message.baseRevision),
    targetRevision: trimOrUndefined(message.targetRevision),
    withProjectRules: Boolean(message.withProjectRules)
  }
}

function trimOrUndefined(value: unknown): string | undefined {
  const text = String(value ?? "").trim()
  return text ? text : undefined
}

function validateTargetRequest(request: TargetRequest): void {
  if (request.mode === "singleRevision" && !request.revision) throw new Error("リビジョンは必須です。")
  if (request.mode === "revisionRange" && (!request.baseRevision || !request.targetRevision)) throw new Error("基準リビジョンと比較先リビジョンは必須です。")
}

async function prepareTarget(client: BazaarClient, workspacePath: string, request: TargetRequest, includeAddedFiles: boolean): Promise<PreparedTarget> {
  const root = await client.root(workspacePath)

  if (request.mode === "singleRevision") {
    const revision = request.revision ?? ""
    const input = await loadBazaarRevisionPacketInput(client, root, revision)
    return {
      root,
      log: input.log,
      diff: input.diff,
      info: revisionInfoToTargetInfo(input.info),
      addedFilesSection: includeAddedFiles ? await buildAddedFilesContentSection(client, root, revision, input.info, getMaxAddedFileContentBytes()) : undefined
    }
  }

  if (request.mode === "revisionRange") {
    const baseRevision = request.baseRevision ?? ""
    const targetRevision = request.targetRevision ?? ""
    const [diff, log] = await Promise.all([
      client.diffRange(root, baseRevision, targetRevision),
      client.log(root, targetRevision).catch(() => undefined)
    ])
    const entries = parseChangedFileEntries(diff.stdout)
    const info = makeRangeTargetInfo(baseRevision, targetRevision, log?.stdout, entries)
    const syntheticInfo = targetInfoToSyntheticRevisionInfo(info, targetRevision)
    return {
      root,
      log,
      diff,
      info,
      addedFilesSection: includeAddedFiles
        ? await buildAddedFilesContentSection(
          client,
          root,
          targetRevision,
          syntheticInfo,
          getMaxAddedFileContentBytes()
        )
        : undefined
    }
  }

  const topRevision = request.baseRevision ?? await client.revno(root)
  const [diff, status] = await Promise.all([
    client.diffWorkingTree(root, topRevision),
    client.status(root).catch(() => undefined)
  ])
  const entries = parseChangedFileEntries(diff.stdout)
  return {
    root,
    diff,
    info: {
      mode: "workingTreeSinceRevision",
      targetLabel: `${topRevision}..作業ツリー`,
      baseRevision: topRevision,
      targetRevision: "作業ツリー",
      author: "作業ツリー",
      committer: "作業ツリー",
      timestamp: "未コミット",
      message: status?.stdout?.trim() || `リビジョン ${topRevision} 以降の未コミット変更`,
      changedFileCount: entries.length,
      changedFiles: entries.map((entry) => entry.path),
      changedFileEntries: entries
    }
  }
}

function revisionInfoToTargetInfo(info: BazaarRevisionInfo): TargetInfo {
  return {
    mode: "singleRevision",
    targetLabel: info.revision,
    revision: info.revision,
    targetRevision: info.revision,
    revno: info.revno,
    author: info.author,
    committer: info.committer,
    timestamp: info.timestamp,
    message: info.message,
    changedFileCount: info.changedFileCount,
    changedFiles: info.changedFiles,
    changedFileEntries: info.changedFileEntries
  }
}

function makeRangeTargetInfo(baseRevision: string, targetRevision: string, logText: string | undefined, entries: BazaarChangedFile[]): TargetInfo {
  const parsed = logText ? parseLogMetadataLike(logText) : {}
  return {
    mode: "revisionRange",
    targetLabel: `${baseRevision}..${targetRevision}`,
    baseRevision,
    targetRevision,
    revno: parsed.revno,
    author: parsed.author || parsed.committer || "range",
    committer: parsed.committer || parsed.author || "range",
    timestamp: parsed.timestamp || "unknown",
    message: parsed.message || `Bazaar リビジョン範囲 ${baseRevision}..${targetRevision}`,
    changedFileCount: entries.length,
    changedFiles: entries.map((entry) => entry.path),
    changedFileEntries: entries
  }
}

function targetInfoToSyntheticRevisionInfo(info: TargetInfo, revision: string): BazaarRevisionInfo {
  return {
    revision,
    revno: info.revno,
    author: info.author,
    committer: info.committer,
    timestamp: info.timestamp,
    message: info.message,
    changedFileCount: info.changedFileCount,
    changedFiles: info.changedFiles,
    changedFileEntries: info.changedFileEntries,
    logText: ""
  }
}

function parseLogMetadataLike(logText: string): { revno?: string; author?: string; committer?: string; timestamp?: string; message?: string } {
  const result: { revno?: string; author?: string; committer?: string; timestamp?: string; message?: string } = {}
  const messageLines: string[] = []
  let inMessage = false
  for (const line of logText.split(/\r?\n/)) {
    const trimmed = line.trimEnd()
    if (/^revno:\s*/i.test(trimmed)) result.revno = trimmed.replace(/^revno:\s*/i, "").trim()
    else if (/^author:\s*/i.test(trimmed)) result.author = trimmed.replace(/^author:\s*/i, "").trim()
    else if (/^committer:\s*/i.test(trimmed)) result.committer = trimmed.replace(/^committer:\s*/i, "").trim()
    else if (/^timestamp:\s*/i.test(trimmed)) result.timestamp = trimmed.replace(/^timestamp:\s*/i, "").trim()
    else if (/^message:\s*$/i.test(trimmed)) inMessage = true
    else if (inMessage) {
      if (/^[-]{5,}$/.test(trimmed)) break
      messageLines.push(trimmed.replace(/^\s{2,}/, ""))
    }
  }
  result.message = messageLines.join("\n").trim()
  return result
}

function makeBazaarClient(): BazaarClient {
  const config = vscode.workspace.getConfiguration("bobBazaar")
  return new BazaarClient({
    bzrPath: config.get<string>("bzrPath", "bzr"),
    maxBuffer: Math.max(getMaxDiffBytes() * 2, 2 * 1024 * 1024),
    textEncoding: config.get<string>("textEncoding", "auto")
  })
}

function getMaxDiffBytes(): number {
  return vscode.workspace.getConfiguration("bobBazaar").get<number>("maxDiffBytes", 1024 * 1024)
}

function getMaxAddedFileContentBytes(): number {
  return vscode.workspace.getConfiguration("bobBazaar").get<number>("maxAddedFileContentBytes", 256 * 1024)
}

async function buildProjectRulesSectionForWorkspace(workspaceRoot: string): Promise<string> {
  const config = vscode.workspace.getConfiguration("bobBazaar")
  const [checklist, schema] = await Promise.all([
    loadProjectChecklist(workspaceRoot, config.get<string>("projectRules.checklistPath", ".bob/review/checklist.json")),
    loadReviewResultSchema(workspaceRoot, config.get<string>("projectRules.schemaPath", ".bob/review/review-result.schema.json"))
  ])
  return buildProjectRulesSection({ checklist, schema })
}

function buildTargetMetadataSection(info: TargetInfo): string {
  return [
    "## Bazaar レビュー対象メタデータ",
    "",
    `- mode: ${info.mode}`,
    `- target: ${info.targetLabel}`,
    info.revision ? `- revision: ${info.revision}` : undefined,
    info.baseRevision ? `- base_revision: ${info.baseRevision}` : undefined,
    info.targetRevision ? `- target_revision: ${info.targetRevision}` : undefined,
    info.revno ? `- revno: ${info.revno}` : undefined,
    `- author: ${info.author}`,
    `- committer: ${info.committer}`,
    `- timestamp: ${info.timestamp}`,
    `- changed_files: ${info.changedFileCount}`,
    "",
    "### メッセージ / status",
    "",
    "```text",
    info.message || "(メッセージなし)",
    "```",
    "",
    "### 変更ファイル",
    "",
    ...(info.changedFileEntries.length > 0 ? info.changedFileEntries.map((entry) => `- ${entry.status}: ${entry.path}`) : ["- (変更ファイルを検出できませんでした)"])
  ].filter((line): line is string => line !== undefined).join("\n")
}

async function addPacketToBobContext(uri: vscode.Uri, packet: string) {
  return addMarkdownPacketToBobContext({
    executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args),
    writeClipboard: (text) => vscode.env.clipboard.writeText(text),
    showWarningMessage: (message) => vscode.window.showWarningMessage(message)
  }, uri, packet)
}
