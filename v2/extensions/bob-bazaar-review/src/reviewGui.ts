import * as vscode from "vscode"
import { BazaarClient, BazaarCommandResult } from "./bazaar"
import { buildReviewPacket } from "./reviewPacket"
import { buildProjectRulesSection } from "./projectRules/packet"
import { loadProjectChecklist, loadReviewResultSchema } from "./projectRules/io"
import { buildAddedFilesContentSection, loadBazaarRevisionPacketInput, parseChangedFileEntries, BazaarRevisionInfo, BazaarChangedFile } from "./revisionInfo"
import { getBobWorkspaceStatus, initializeBobWorkspaceFromTemplates } from "./bobWorkspaceInit"
import { completeCurrentWorkflowStepAfterGuiAction } from "./workflowStepCompletion"
import { resolveBazaarWorkspaceFolder, resolveBobWorkspaceFolder } from "./workspaceResolver"

type TargetMode = "singleRevision" | "revisionRange" | "workingTreeSinceRevision"

export interface BazaarReviewInitialTarget {
  revisionMode?: TargetMode
  revision?: string
  baseRevision?: string
  targetRevision?: string
  bazaarRoot?: string
  repositoryRoot?: string
  workflowRoot?: string
}

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

type AddToBobContextResult = "added" | "clipboardFallback"

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

  constructor(private readonly context: vscode.ExtensionContext, private readonly panel: vscode.WebviewPanel, private readonly initialTarget?: BazaarReviewInitialTarget) {}

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
    const extraSections = [buildTargetMetadataSection(prepared.info), prepared.addedFilesSection, projectRulesSection].filter((section): section is string => Boolean(section))
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
    const addResult = await addToBobContext(doc.uri, packet)
    let workflowStepCompleted = false
    if (addResult === "added") {
      workflowStepCompleted = await completeCurrentWorkflowStepAfterGuiAction({
        executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args),
        showWarningMessage: (message) => vscode.window.showWarningMessage(message)
      })
    }
    this.post({
      type: "reviewAdded",
      info: prepared.info,
      packetBytes: Buffer.byteLength(packet, "utf8"),
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
      addedFilesSection: includeAddedFiles ? await buildAddedFilesContentSection(client, root, targetRevision, syntheticInfo, getMaxAddedFileContentBytes()) : undefined
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
  return { revision, revno: info.revno, author: info.author, committer: info.committer, timestamp: info.timestamp, message: info.message, changedFileCount: info.changedFileCount, changedFiles: info.changedFiles, changedFileEntries: info.changedFileEntries, logText: "" }
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

async function addToBobContext(uri: vscode.Uri, packet: string): Promise<AddToBobContextResult> {
  try {
    await vscode.commands.executeCommand("bob-code.addToContext", uri, packet, 1, packet.split(/\r?\n/).length)
    return "added"
  } catch (error: any) {
    await vscode.env.clipboard.writeText(packet)
    await vscode.window.showWarningMessage(`Bob コンテキスト追加コマンドを呼び出せませんでした。代わりにレビュー packet をクリップボードへコピーしました。${error?.message ? ` ${error.message}` : ""}`)
    return "clipboardFallback"
  }
}

function renderHtml(cspSource: string, initialTarget?: BazaarReviewInitialTarget): string {
  const nonce = String(Date.now())
  const initialTargetJson = JSON.stringify(initialTarget ?? {}).replace(/</g, "\\u003c")
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Bob Bazaar レビュー</title><style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:20px}.row{display:flex;gap:8px;align-items:center;margin-bottom:12px}.field{display:flex;flex-direction:column;gap:4px;flex:1}.small{color:var(--vscode-descriptionForeground);font-size:12px}input,select{padding:8px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border)}button{padding:8px 12px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;cursor:pointer}.secondary{color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground)}button:disabled{opacity:.5}.card{border:1px solid var(--vscode-panel-border);padding:14px;margin-top:12px;border-radius:6px;background:var(--vscode-sideBar-background)}.warning{border-color:var(--vscode-editorWarning-foreground)}.grid{display:grid;grid-template-columns:140px 1fr;gap:6px 12px}.label{color:var(--vscode-descriptionForeground)}pre{white-space:pre-wrap;background:var(--vscode-textCodeBlock-background);padding:10px}.files,.missing{max-height:220px;overflow:auto}.status{margin-top:12px;color:var(--vscode-descriptionForeground)}.error{color:var(--vscode-errorForeground)}.ok{color:var(--vscode-testing-iconPassed)}.hidden{display:none}</style></head><body>
<h1>Bob Bazaar レビュー</h1>
<div class="row"><button class="secondary" id="selectWorkspace">Bazaar ワークスペースを選択</button><span id="workspace">ワークスペース未選択</span></div>
<div id="initCard" class="card warning hidden"><h2>.bob 初期化状態: 未初期化</h2><button id="initializeBob">.bob を初期化</button><ul id="missingFiles" class="missing"></ul></div>
<div class="row"><div class="field"><label class="small">レビュー対象</label><select id="mode"><option value="singleRevision">1リビジョン</option><option value="revisionRange">リビジョン範囲</option><option value="workingTreeSinceRevision">TOPリビジョンと未コミット差分</option></select></div></div>
<div class="row" id="singleFields"><div class="field"><label class="small">リビジョン</label><input id="revision" type="text" placeholder="例: 1234" /></div></div>
<div class="row hidden" id="rangeFields"><div class="field"><label class="small">基準リビジョン</label><input id="baseRevision" type="text" placeholder="例: 1200" /></div><div class="field"><label class="small">比較先リビジョン</label><input id="targetRevision" type="text" placeholder="例: 1234" /></div></div>
<div class="row hidden" id="workingTreeFields"><div class="field"><label class="small">基準リビジョン（省略時は現在の TOP リビジョン）</label><input id="workingBaseRevision" type="text" placeholder="空欄なら bzr revno を使用" /></div></div>
<div class="row"><button id="load">対象情報を取得</button><button id="review" disabled>レビューして Bob に追加</button></div><label><input id="withProjectRules" type="checkbox" checked /> プロジェクト規約を含める</label><div id="status" class="status"></div>
<div id="info" class="card hidden"><h2>対象情報</h2><div class="grid"><div class="label">モード</div><div id="infoMode"></div><div class="label">対象</div><div id="infoTarget"></div><div class="label">リビジョン</div><div id="infoRevision"></div><div class="label">Revno</div><div id="infoRevno"></div><div class="label">作者</div><div id="infoAuthor"></div><div class="label">Committer</div><div id="infoCommitter"></div><div class="label">日時</div><div id="infoTimestamp"></div><div class="label">変更ファイル数</div><div id="infoChangedCount"></div></div><h3>メッセージ / status</h3><pre id="infoMessage"></pre><h3>変更ファイル</h3><ul id="infoFiles" class="files"></ul></div>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi();const $=(id)=>document.getElementById(id);const initialTarget=${initialTargetJson};let loaded=false;let bobInitialized=false;
$('selectWorkspace').onclick=()=>vscode.postMessage({type:'selectWorkspace'});$('initializeBob').onclick=()=>vscode.postMessage({type:'initializeBobWorkspace'});$('mode').onchange=()=>{updateMode();clearLoaded()};$('load').onclick=()=>loadTarget();$('review').onclick=()=>vscode.postMessage({type:'reviewTarget',...collectTarget(),withProjectRules:$('withProjectRules').checked});$('withProjectRules').onchange=()=>updateReviewButton();['revision','baseRevision','targetRevision','workingBaseRevision'].forEach(id=>{$(id).oninput=()=>clearLoaded();$(id).onkeydown=(e)=>{if(e.key==='Enter')loadTarget()}});
function collectTarget(){const mode=$('mode').value;return{mode,revision:$('revision').value.trim(),baseRevision:mode==='workingTreeSinceRevision'?$('workingBaseRevision').value.trim():$('baseRevision').value.trim(),targetRevision:$('targetRevision').value.trim()}}
function updateMode(){const mode=$('mode').value;$('singleFields').classList.toggle('hidden',mode!=='singleRevision');$('rangeFields').classList.toggle('hidden',mode!=='revisionRange');$('workingTreeFields').classList.toggle('hidden',mode!=='workingTreeSinceRevision')}
function applyInitialTarget(initialTarget){if(!initialTarget)return;const mode=initialTarget.revisionMode||'singleRevision';$('mode').value=mode;$('revision').value=initialTarget.revision||'';$('baseRevision').value=initialTarget.baseRevision||'';$('targetRevision').value=initialTarget.targetRevision||'';$('workingBaseRevision').value=mode==='workingTreeSinceRevision'?(initialTarget.baseRevision||''):'';updateMode()}
function clearLoaded(){loaded=false;updateReviewButton()}function updateReviewButton(){$('review').disabled=!loaded||($('withProjectRules').checked&&!bobInitialized)}function setStatus(text,error=false,ok=false){$('status').textContent=text||'';$('status').className=error?'status error':ok?'status ok':'status'}
function loadTarget(){const t=collectTarget();if(t.mode==='singleRevision'&&!t.revision){setStatus('リビジョンを入力してください',true);return}if(t.mode==='revisionRange'&&(!t.baseRevision||!t.targetRevision)){setStatus('基準リビジョンと比較先リビジョンを入力してください',true);return}clearLoaded();vscode.postMessage({type:'loadTarget',...t})}
function renderBobStatus(s){bobInitialized=!!s.initialized;$('initCard').classList.toggle('hidden',bobInitialized);$('missingFiles').innerHTML='';(s.missing||[]).forEach(f=>{const li=document.createElement('li');li.textContent=f;$('missingFiles').appendChild(li)});updateReviewButton()}
function renderInfo(info){loaded=true;$('info').classList.remove('hidden');updateReviewButton();$('infoMode').textContent=info.mode||'';$('infoTarget').textContent=info.targetLabel||'';$('infoRevision').textContent=info.revision||info.targetRevision||'';$('infoRevno').textContent=info.revno||'';$('infoAuthor').textContent=info.author||'';$('infoCommitter').textContent=info.committer||'';$('infoTimestamp').textContent=info.timestamp||'';$('infoChangedCount').textContent=String(info.changedFileCount??0);$('infoMessage').textContent=info.message||'(メッセージなし)';$('infoFiles').innerHTML='';(info.changedFileEntries||[]).forEach(e=>{const li=document.createElement('li');li.textContent=e.status+': '+e.path;$('infoFiles').appendChild(li)})}
function renderWorkspaceState(m){const parts=[];if(m.workspace)parts.push('Bazaar: '+m.workspace);if(m.bobWorkspace)parts.push('Bob: '+m.bobWorkspace);$('workspace').textContent=parts.join(' / ')||'ワークスペース未選択'}
window.addEventListener('message',(event)=>{const m=event.data;if(m.type==='workspaceState')renderWorkspaceState(m);else if(m.type==='bobWorkspaceStatus')renderBobStatus(m);else if(m.type==='initialized')setStatus(m.message,false,true);else if(m.type==='loading')setStatus(m.message);else if(m.type==='targetInfo'){renderInfo(m.info);setStatus('対象情報を取得しました',false,true)}else if(m.type==='reviewAdded'){renderInfo(m.info);const contextText=m.bobContextAdded?'Bob コンテキストへ追加しました':'Bob コンテキスト追加に失敗したためクリップボードへコピーしました';const stepText=m.workflowStepCompleted?' 現在のワークフローステップも完了しました。':'';setStatus('レビュー packet を作成し、'+contextText+'。packet bytes: '+m.packetBytes+stepText,false,true)}else if(m.type==='error')setStatus(m.message||'エラー',true)});
updateMode();applyInitialTarget(initialTarget);vscode.postMessage({type:'ready'});
</script></body></html>`
}
