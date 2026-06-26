import * as vscode from "vscode"
import { BazaarClient } from "./bazaar"
import { buildReviewPacket } from "./reviewPacket"
import { buildProjectRulesSection } from "./projectRules/packet"
import { loadProjectChecklist, loadReviewResultSchema } from "./projectRules/io"
import { buildAddedFilesContentSection, loadBazaarRevisionPacketInput, BazaarRevisionInfo } from "./revisionInfo"
import { getBobWorkspaceStatus, initializeBobWorkspaceFromTemplates } from "./bobWorkspaceInit"

export function openBazaarReviewGui(context: vscode.ExtensionContext): void {
  const panel = vscode.window.createWebviewPanel(
    "bobBazaarReviewGui",
    "Bob Bazaar Review",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true
    }
  )

  const controller = new BazaarReviewGuiController(context, panel)
  controller.initialize()
}

class BazaarReviewGuiController {
  private workspaceFolder?: vscode.WorkspaceFolder
  private lastRevisionInfo?: BazaarRevisionInfo
  private lastRevision?: string

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel
  ) {}

  initialize(): void {
    this.panel.webview.html = renderHtml(this.panel.webview.cspSource)
    this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message), undefined, this.context.subscriptions)
  }

  private async handleMessage(message: any): Promise<void> {
    try {
      switch (message?.type) {
        case "ready":
          await this.postWorkspaceState()
          return
        case "selectWorkspace":
          await this.selectWorkspace()
          return
        case "initializeBobWorkspace":
          await this.initializeBobWorkspace()
          return
        case "loadRevision":
          await this.loadRevision(String(message.revision ?? ""))
          return
        case "reviewRevision":
          await this.reviewRevision(String(message.revision ?? ""), Boolean(message.withProjectRules))
          return
      }
    } catch (error: any) {
      this.post({ type: "error", message: error?.message ?? String(error) })
    }
  }

  private async postWorkspaceState(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? []
    if (folders.length === 1 && !this.workspaceFolder) {
      this.workspaceFolder = folders[0]
    }
    this.post({
      type: "workspaceState",
      workspace: this.workspaceFolder ? this.workspaceFolder.uri.fsPath : undefined,
      hasWorkspace: Boolean(this.workspaceFolder),
      folders: folders.map((folder) => ({ name: folder.name, path: folder.uri.fsPath }))
    })
    await this.postBobWorkspaceStatus()
  }

  private async postBobWorkspaceStatus(): Promise<void> {
    if (!this.workspaceFolder) {
      this.post({ type: "bobWorkspaceStatus", initialized: false, missing: ["workspace未選択"], present: [] })
      return
    }
    const config = vscode.workspace.getConfiguration("bobBazaar")
    const serverName = config.get<string>("mcpServerName", "bazaar")
    const status = await getBobWorkspaceStatus(this.workspaceFolder, serverName)
    this.post({ type: "bobWorkspaceStatus", ...status })
  }

  private async selectWorkspace(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? []
    if (folders.length === 0) {
      throw new Error("Open a Bazaar workspace folder first.")
    }
    if (folders.length === 1) {
      this.workspaceFolder = folders[0]
    } else {
      const picked = await vscode.window.showQuickPick(
        folders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, folder })),
        { title: "Select Bazaar workspace" }
      )
      this.workspaceFolder = picked?.folder
    }
    await this.postWorkspaceState()
  }

  private async initializeBobWorkspace(): Promise<void> {
    const folder = await this.requireWorkspaceFolder()
    const config = vscode.workspace.getConfiguration("bobBazaar")
    const bzrPath = config.get<string>("bzrPath", "bzr")
    const serverName = config.get<string>("mcpServerName", "bazaar")

    this.post({ type: "loading", message: ".bobテンプレートとMCP設定を初期化しています..." })
    const status = await initializeBobWorkspaceFromTemplates({
      context: this.context,
      workspaceFolder: folder,
      bzrPath,
      serverName
    })
    this.post({ type: "bobWorkspaceStatus", ...status })
    this.post({ type: "initialized", message: ".bob 初期化が完了しました。Bob MCP serverをRefresh/Restartしてください。" })
  }

  private async loadRevision(revisionRaw: string): Promise<void> {
    const revision = revisionRaw.trim()
    if (!revision) throw new Error("Revision is required.")
    const folder = await this.requireWorkspaceFolder()

    this.post({ type: "loading", message: "Loading Bazaar revision metadata..." })
    const input = await loadBazaarRevisionPacketInput(makeBazaarClient(), folder.uri.fsPath, revision)
    this.lastRevision = revision
    this.lastRevisionInfo = input.info
    this.post({ type: "revisionInfo", info: input.info })
  }

  private async reviewRevision(revisionRaw: string, withProjectRules: boolean): Promise<void> {
    const revision = revisionRaw.trim()
    if (!revision) throw new Error("Revision is required.")
    const folder = await this.requireWorkspaceFolder()

    if (withProjectRules) {
      const config = vscode.workspace.getConfiguration("bobBazaar")
      const serverName = config.get<string>("mcpServerName", "bazaar")
      const status = await getBobWorkspaceStatus(folder, serverName)
      if (!status.initialized) {
        this.post({ type: "bobWorkspaceStatus", ...status })
        throw new Error(".bob が未初期化です。先に『.bobを初期化』ボタンを押してください。")
      }
    }

    this.post({ type: "loading", message: "Building review packet and adding it to Bob context..." })
    const client = makeBazaarClient()
    const input = await loadBazaarRevisionPacketInput(client, folder.uri.fsPath, revision)
    const [addedFilesSection, projectRulesSection] = await Promise.all([
      buildAddedFilesContentSection(client, input.root, revision, input.info, getMaxAddedFileContentBytes()),
      withProjectRules ? buildProjectRulesSectionForWorkspace(input.root) : Promise.resolve(undefined)
    ])

    const metadataSection = buildRevisionMetadataSection(input.info)
    const extraSections = [metadataSection, addedFilesSection, projectRulesSection].filter((section): section is string => Boolean(section))
    const packet = buildReviewPacket({
      repositoryRoot: input.root,
      mode: "singleRevision",
      revision,
      log: input.log,
      diff: input.diff,
      maxDiffBytes: getMaxDiffBytes(),
      extraSections
    })

    const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: packet })
    await vscode.window.showTextDocument(doc, { preview: false })
    await addToBobContext(doc.uri, packet)

    this.lastRevision = revision
    this.lastRevisionInfo = input.info
    this.post({ type: "reviewAdded", info: input.info, packetBytes: Buffer.byteLength(packet, "utf8") })
  }

  private async requireWorkspaceFolder(): Promise<vscode.WorkspaceFolder> {
    if (!this.workspaceFolder) {
      await this.selectWorkspace()
    }
    if (!this.workspaceFolder) {
      throw new Error("Workspace folder is not selected.")
    }
    return this.workspaceFolder
  }

  private post(message: any): void {
    void this.panel.webview.postMessage(message)
  }
}

function makeBazaarClient(): BazaarClient {
  const config = vscode.workspace.getConfiguration("bobBazaar")
  return new BazaarClient({
    bzrPath: config.get<string>("bzrPath", "bzr"),
    maxBuffer: Math.max(getMaxDiffBytes() * 2, 2 * 1024 * 1024)
  })
}

function getMaxDiffBytes(): number {
  const config = vscode.workspace.getConfiguration("bobBazaar")
  return config.get<number>("maxDiffBytes", 1024 * 1024)
}

function getMaxAddedFileContentBytes(): number {
  const config = vscode.workspace.getConfiguration("bobBazaar")
  return config.get<number>("maxAddedFileContentBytes", 256 * 1024)
}

async function buildProjectRulesSectionForWorkspace(workspaceRoot: string): Promise<string> {
  const config = vscode.workspace.getConfiguration("bobBazaar")
  const checklistPath = config.get<string>("projectRules.checklistPath", ".bob/review/checklist.json")
  const schemaPath = config.get<string>("projectRules.schemaPath", ".bob/review/review-result.schema.json")
  const [checklist, schema] = await Promise.all([
    loadProjectChecklist(workspaceRoot, checklistPath),
    loadReviewResultSchema(workspaceRoot, schemaPath)
  ])
  return buildProjectRulesSection({ checklist, schema })
}

function buildRevisionMetadataSection(info: BazaarRevisionInfo): string {
  return [
    "## Bazaar revision metadata",
    "",
    `- revision: ${info.revision}`,
    info.revno ? `- revno: ${info.revno}` : undefined,
    `- author: ${info.author}`,
    `- committer: ${info.committer}`,
    `- timestamp: ${info.timestamp}`,
    `- changed_files: ${info.changedFileCount}`,
    "",
    "### Commit message",
    "",
    "```text",
    info.message || "(no message)",
    "```",
    "",
    "### Changed files",
    "",
    ...(info.changedFileEntries.length > 0 ? info.changedFileEntries.map((entry) => `- ${entry.status}: ${entry.path}`) : ["- (no changed file detected)"])
  ].filter((line): line is string => line !== undefined).join("\n")
}

async function addToBobContext(uri: vscode.Uri, packet: string): Promise<void> {
  try {
    const lineCount = packet.split(/\r?\n/).length
    await vscode.commands.executeCommand("bob-code.addToContext", uri, packet, 1, lineCount)
  } catch (error: any) {
    await vscode.env.clipboard.writeText(packet)
    await vscode.window.showWarningMessage(
      `Could not call Bob add-to-context command. The review packet was copied to the clipboard instead. ${error?.message ?? ""}`
    )
  }
}

function renderHtml(cspSource: string): string {
  const nonce = String(Date.now())
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bob Bazaar Review</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; }
    .row { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
    input[type="text"] { flex: 1; padding: 8px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); }
    button { padding: 8px 12px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; cursor: pointer; }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .card { border: 1px solid var(--vscode-panel-border); padding: 14px; margin-top: 12px; border-radius: 6px; background: var(--vscode-sideBar-background); }
    .warning { border-color: var(--vscode-editorWarning-foreground); }
    .grid { display: grid; grid-template-columns: 140px 1fr; gap: 6px 12px; }
    .label { color: var(--vscode-descriptionForeground); }
    pre { white-space: pre-wrap; background: var(--vscode-textCodeBlock-background); padding: 10px; overflow: auto; }
    .files, .missing { max-height: 220px; overflow: auto; margin: 8px 0 0 0; padding-left: 20px; }
    .status { margin-top: 12px; color: var(--vscode-descriptionForeground); }
    .error { color: var(--vscode-errorForeground); }
    .ok { color: var(--vscode-testing-iconPassed); }
    .badge { display:inline-block; padding:2px 6px; border-radius:4px; background:var(--vscode-badge-background); color:var(--vscode-badge-foreground); }
  </style>
</head>
<body>
  <h1>Bob Bazaar Review</h1>
  <div class="row">
    <button class="secondary" id="selectWorkspace">Workspace選択</button>
    <span id="workspace">workspace未選択</span>
  </div>
  <div id="initCard" class="card warning" style="display:none">
    <h2>.bob 初期化状態: <span id="initState" class="badge">未初期化</span></h2>
    <p id="initMessage">必要なMCP設定・Skill・Workflow・Mode・テンプレートが不足しています。</p>
    <button id="initializeBob">.bobを初期化</button>
    <h3>不足ファイル</h3>
    <ul id="missingFiles" class="missing"></ul>
  </div>
  <div class="row">
    <input id="revision" type="text" placeholder="Bazaar revision, e.g. 1234 or revid:..." />
    <button id="load">取得</button>
    <button id="review" disabled>レビューしてBobにADD</button>
  </div>
  <label><input id="withProjectRules" type="checkbox" checked /> Project Rulesを含める</label>
  <div id="status" class="status"></div>
  <div id="info" class="card" style="display:none">
    <h2>Revision Information</h2>
    <div class="grid">
      <div class="label">Revision</div><div id="infoRevision"></div>
      <div class="label">Revno</div><div id="infoRevno"></div>
      <div class="label">作者</div><div id="infoAuthor"></div>
      <div class="label">Committer</div><div id="infoCommitter"></div>
      <div class="label">日時</div><div id="infoTimestamp"></div>
      <div class="label">変更ファイル数</div><div id="infoChangedCount"></div>
    </div>
    <h3>コミットメッセージ</h3>
    <pre id="infoMessage"></pre>
    <h3>変更ファイル</h3>
    <ul id="infoFiles" class="files"></ul>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const $ = (id) => document.getElementById(id);
    let loadedRevision = undefined;
    let bobInitialized = false;

    $('selectWorkspace').addEventListener('click', () => vscode.postMessage({ type: 'selectWorkspace' }));
    $('initializeBob').addEventListener('click', () => vscode.postMessage({ type: 'initializeBobWorkspace' }));
    $('load').addEventListener('click', () => loadRevision());
    $('review').addEventListener('click', () => {
      const revision = $('revision').value.trim();
      vscode.postMessage({ type: 'reviewRevision', revision, withProjectRules: $('withProjectRules').checked });
    });
    $('withProjectRules').addEventListener('change', () => updateReviewButton());
    $('revision').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') loadRevision();
    });

    function loadRevision() {
      const revision = $('revision').value.trim();
      if (!revision) {
        setStatus('revisionを入力してください', true);
        return;
      }
      loadedRevision = undefined;
      updateReviewButton();
      vscode.postMessage({ type: 'loadRevision', revision });
    }

    function updateReviewButton() {
      const needProjectRules = $('withProjectRules').checked;
      $('review').disabled = !loadedRevision || (needProjectRules && !bobInitialized);
    }

    function setStatus(text, error = false, ok = false) {
      $('status').textContent = text || '';
      $('status').className = error ? 'status error' : ok ? 'status ok' : 'status';
    }

    function renderBobStatus(status) {
      bobInitialized = Boolean(status.initialized);
      const initCard = $('initCard');
      const missing = status.missing || [];
      if (bobInitialized) {
        initCard.style.display = 'none';
      } else {
        initCard.style.display = 'block';
        $('initState').textContent = '未初期化';
        $('initMessage').textContent = '必要なMCP設定・Skill・Workflow・Mode・テンプレートが不足しています。初期化すると不足分だけ生成します。';
        $('missingFiles').innerHTML = '';
        for (const file of missing) {
          const li = document.createElement('li');
          li.textContent = file;
          $('missingFiles').appendChild(li);
        }
      }
      updateReviewButton();
    }

    function renderInfo(info) {
      loadedRevision = info.revision;
      $('info').style.display = 'block';
      updateReviewButton();
      $('infoRevision').textContent = info.revision || '';
      $('infoRevno').textContent = info.revno || '';
      $('infoAuthor').textContent = info.author || '';
      $('infoCommitter').textContent = info.committer || '';
      $('infoTimestamp').textContent = info.timestamp || '';
      $('infoChangedCount').textContent = String(info.changedFileCount ?? 0);
      $('infoMessage').textContent = info.message || '(no message)';
      $('infoFiles').innerHTML = '';
      const entries = info.changedFileEntries || (info.changedFiles || []).map((path) => ({ path, status: 'unknown' }));
      for (const entry of entries) {
        const li = document.createElement('li');
        li.textContent = entry.status + ': ' + entry.path;
        $('infoFiles').appendChild(li);
      }
    }

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'workspaceState') {
        $('workspace').textContent = message.workspace || 'workspace未選択';
      } else if (message.type === 'bobWorkspaceStatus') {
        renderBobStatus(message);
      } else if (message.type === 'initialized') {
        setStatus(message.message || '.bob初期化が完了しました', false, true);
      } else if (message.type === 'loading') {
        setStatus(message.message || 'Loading...');
      } else if (message.type === 'revisionInfo') {
        renderInfo(message.info);
        setStatus('revision情報を取得しました', false, true);
      } else if (message.type === 'reviewAdded') {
        renderInfo(message.info);
        setStatus('レビューpacketを作成し、Bob contextへADDしました。packet bytes: ' + message.packetBytes, false, true);
      } else if (message.type === 'error') {
        setStatus(message.message || 'Error', true);
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`
}
