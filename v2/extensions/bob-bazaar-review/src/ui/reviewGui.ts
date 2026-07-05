import * as vscode from "vscode"
import { BazaarClient } from "../bazaar/bazaar"
import { isBobCodeExtensionAvailable } from "../bob/bobCodeExtension"
import { addMarkdownPacketToBobContext } from "../bob/bobContext"
import { getBobWorkspaceStatus, initializeBobWorkspaceFromTemplates } from "../workspace/bobWorkspaceInit"
import { resolveBzrPath } from "../bazaar/bzrPathTrust"
import { buildProjectRulesSection } from "../projectRules/packet"
import { loadProjectChecklistRequired, loadReviewResultSchemaRequired } from "../projectRules/io"
import { buildReviewPacket } from "../bazaar/reviewPacket"
import { buildReviewPacketState, REVIEW_PACKET_STATE_KEY } from "../bazaar/reviewPacketSelection"
import { clampMaxAddedFileContentBytes, clampMaxDiffBytes, maxBufferForDiffBytes } from "../bazaar/reviewLimits"
import {
  buildTargetMetadataSection,
  parseTargetRequest,
  prepareTarget,
  validateTargetRequest
} from "../bazaar/reviewTarget"
import type { TargetRequest } from "../bazaar/reviewTarget"
import { completeCurrentWorkflowStepAfterGuiAction } from "../workflow/workflowStepCompletion"
import { resolveBazaarWorkspaceFolder, resolveBobWorkspaceFolder } from "../workspace/workspaceResolver"
import { renderHtml } from "./reviewGuiHtml"
import type { BazaarReviewInitialTarget } from "./reviewGuiTypes"

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
      // Webview message は UI 入力として扱い、ホスト側で対象解析と workspace 解決をやり直してから副作用を起こす。
      if (message?.type === "ready") await this.postWorkspaceState()
      else if (message?.type === "selectWorkspace") await this.selectWorkspace()
      else if (message?.type === "initializeBobWorkspace") await this.initializeBobWorkspace()
      else if (message?.type === "loadTarget") await this.loadTarget(parseTargetRequest(message))
      else if (message?.type === "reviewTarget") await this.reviewTarget(parseTargetRequest(message))
      else if (message?.type === "openResultCapture") await vscode.commands.executeCommand("bobBazaar.openResultCaptureGui")
      else if (message?.type === "openHumanTriage") await vscode.commands.executeCommand("bobBazaar.openHumanTriageGui")
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
      allowedRoots: this.bazaarWorkspaceFolder ? [this.bazaarWorkspaceFolder.uri.fsPath] : undefined,
      bzrPath: resolveBzrPath(config, vscode.workspace.isTrusted),
      serverName: config.get<string>("mcpServerName", "bazaar"),
      textEncoding: config.get<string>("textEncoding", "auto")
    })
    this.post({ type: "bobWorkspaceStatus", ...status })
    this.post({ type: "initialized", message: ".bob 初期化が完了しました。Bob MCP サーバーを Refresh / Restart してください。" })
  }

  private async loadTarget(request: TargetRequest): Promise<void> {
    const folder = await this.requireBazaarWorkspaceFolder()
    validateTargetRequest(request)
    this.post({ type: "loading", message: "対象情報を取得しています..." })
    const prepared = await prepareTarget(makeBazaarClient(), folder.uri.fsPath, request, {
      includeAddedFiles: false,
      maxAddedFileContentBytes: getMaxAddedFileContentBytes()
    })
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
    const prepared = await prepareTarget(makeBazaarClient(), bazaarFolder.uri.fsPath, request, {
      includeAddedFiles: true,
      maxAddedFileContentBytes: getMaxAddedFileContentBytes()
    })
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
        }, {
          runId: this.initialTarget?.runId,
          stepId: this.initialTarget?.stepId,
          stateUpdates: {
            [REVIEW_PACKET_STATE_KEY]: JSON.stringify(buildReviewPacketState({
              packetUri: doc.uri.toString(),
              runId: this.initialTarget?.runId,
              stepId: this.initialTarget?.stepId,
              target: prepared.info.targetRevision ?? prepared.info.revision,
              repositoryRoot: prepared.root
            }))
          }
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

function makeBazaarClient(): BazaarClient {
  const config = vscode.workspace.getConfiguration("bobBazaar")
  return new BazaarClient({
    bzrPath: resolveBzrPath(config, vscode.workspace.isTrusted),
    maxBuffer: maxBufferForDiffBytes(getMaxDiffBytes()),
    textEncoding: config.get<string>("textEncoding", "auto")
  })
}

function getMaxDiffBytes(): number {
  return clampMaxDiffBytes(vscode.workspace.getConfiguration("bobBazaar").get<number>("maxDiffBytes", 1024 * 1024))
}

function getMaxAddedFileContentBytes(): number {
  return clampMaxAddedFileContentBytes(vscode.workspace.getConfiguration("bobBazaar").get<number>("maxAddedFileContentBytes", 256 * 1024))
}

async function buildProjectRulesSectionForWorkspace(workspaceRoot: string): Promise<string> {
  const config = vscode.workspace.getConfiguration("bobBazaar")
  const [checklist, schema] = await Promise.all([
    loadProjectChecklistRequired(workspaceRoot, config.get<string>("projectRules.checklistPath", ".bob/review/checklist.json")),
    loadReviewResultSchemaRequired(workspaceRoot, config.get<string>("projectRules.schemaPath", ".bob/review/review-result.schema.json"))
  ])
  return buildProjectRulesSection({ checklist, schema })
}

async function addPacketToBobContext(uri: vscode.Uri, packet: string) {
  return addMarkdownPacketToBobContext({
    executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args),
    writeClipboard: (text) => vscode.env.clipboard.writeText(text),
    showWarningMessage: (message) => vscode.window.showWarningMessage(message)
  }, uri, packet)
}
