import { randomBytes } from "node:crypto"
import type { BazaarReviewInitialTarget } from "./reviewGuiTypes"

export function renderHtml(cspSource: string, initialTarget?: BazaarReviewInitialTarget): string {
  const nonce = createNonce()
  const initialTargetJson = JSON.stringify(initialTarget ?? {}).replace(/</g, "\\u003c")

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bob Bazaar レビュー</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 20px;
    }
    .row {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 12px;
    }
    .field {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 4px;
    }
    .small {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
    input,
    select {
      padding: 8px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
    }
    button {
      padding: 8px 12px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border: 0;
      cursor: pointer;
    }
    .secondary {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }
    button:disabled {
      opacity: 0.5;
    }
    .card {
      padding: 14px;
      margin-top: 12px;
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
    }
    .warning {
      border-color: var(--vscode-editorWarning-foreground);
    }
    .grid {
      display: grid;
      grid-template-columns: 140px 1fr;
      gap: 6px 12px;
    }
    .label {
      color: var(--vscode-descriptionForeground);
    }
    pre {
      padding: 10px;
      white-space: pre-wrap;
      background: var(--vscode-textCodeBlock-background);
    }
    .files,
    .missing {
      max-height: 220px;
      overflow: auto;
    }
    .status {
      margin-top: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .error {
      color: var(--vscode-errorForeground);
    }
    .ok {
      color: var(--vscode-testing-iconPassed);
    }
    .hidden {
      display: none;
    }
  </style>
</head>
<body>
  <h1>Bob Bazaar レビュー</h1>
  <div class="row">
    <button class="secondary" id="selectWorkspace">Bazaar ワークスペースを選択</button>
    <span id="workspace">ワークスペース未選択</span>
  </div>
  <div id="initCard" class="card warning hidden">
    <h2>.bob 初期化状態: 未初期化</h2>
    <button id="initializeBob">.bob を初期化</button>
    <ul id="missingFiles" class="missing"></ul>
  </div>
  <div class="row">
    <div class="field">
      <label class="small">レビュー対象</label>
      <select id="mode">
        <option value="singleRevision">1リビジョン</option>
        <option value="revisionRange">リビジョン範囲</option>
        <option value="workingTreeSinceRevision">TOPリビジョンと未コミット差分</option>
      </select>
    </div>
  </div>
  <div class="row" id="singleFields">
    <div class="field">
      <label class="small">リビジョン</label>
      <input id="revision" type="text" placeholder="例: 1234" />
    </div>
  </div>
  <div class="row hidden" id="rangeFields">
    <div class="field">
      <label class="small">基準リビジョン</label>
      <input id="baseRevision" type="text" placeholder="例: 1200" />
    </div>
    <div class="field">
      <label class="small">比較先リビジョン</label>
      <input id="targetRevision" type="text" placeholder="例: 1234" />
    </div>
  </div>
  <div class="row hidden" id="workingTreeFields">
    <div class="field">
      <label class="small">基準リビジョン（省略時は現在の TOP リビジョン）</label>
      <input id="workingBaseRevision" type="text" placeholder="空欄なら bzr revno を使用" />
    </div>
  </div>
  <div class="row">
    <button id="load">対象情報を取得</button>
    <button id="review" disabled>レビューして Bob に追加</button>
  </div>
  <label>
    <input id="withProjectRules" type="checkbox" checked />
    プロジェクト規約を含める
  </label>
  <div id="status" class="status"></div>
  <div id="info" class="card hidden">
    <h2>対象情報</h2>
    <div class="grid">
      <div class="label">モード</div>
      <div id="infoMode"></div>
      <div class="label">対象</div>
      <div id="infoTarget"></div>
      <div class="label">リビジョン</div>
      <div id="infoRevision"></div>
      <div class="label">Revno</div>
      <div id="infoRevno"></div>
      <div class="label">作者</div>
      <div id="infoAuthor"></div>
      <div class="label">Committer</div>
      <div id="infoCommitter"></div>
      <div class="label">日時</div>
      <div id="infoTimestamp"></div>
      <div class="label">変更ファイル数</div>
      <div id="infoChangedCount"></div>
    </div>
    <h3>メッセージ / status</h3>
    <pre id="infoMessage"></pre>
    <h3>変更ファイル</h3>
    <ul id="infoFiles" class="files"></ul>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi()
    const $ = (id) => document.getElementById(id)
    const initialTarget = ${initialTargetJson}
    let loaded = false
    let bobInitialized = false

    $("selectWorkspace").onclick = () => vscode.postMessage({ type: "selectWorkspace" })
    $("initializeBob").onclick = () => vscode.postMessage({ type: "initializeBobWorkspace" })
    $("mode").onchange = () => {
      updateMode()
      clearLoaded()
    }
    $("load").onclick = () => loadTarget()
    $("review").onclick = () => {
      vscode.postMessage({
        type: "reviewTarget",
        ...collectTarget(),
        withProjectRules: $("withProjectRules").checked
      })
    }
    $("withProjectRules").onchange = () => updateReviewButton()

    for (const id of ["revision", "baseRevision", "targetRevision", "workingBaseRevision"]) {
      $(id).oninput = () => clearLoaded()
      $(id).onkeydown = (event) => {
        if (event.key === "Enter") loadTarget()
      }
    }

    function collectTarget() {
      const mode = $("mode").value
      const baseRevision = mode === "workingTreeSinceRevision"
        ? $("workingBaseRevision").value.trim()
        : $("baseRevision").value.trim()
      return {
        mode,
        revision: $("revision").value.trim(),
        baseRevision,
        targetRevision: $("targetRevision").value.trim()
      }
    }

    function updateMode() {
      const mode = $("mode").value
      $("singleFields").classList.toggle("hidden", mode !== "singleRevision")
      $("rangeFields").classList.toggle("hidden", mode !== "revisionRange")
      $("workingTreeFields").classList.toggle("hidden", mode !== "workingTreeSinceRevision")
    }

    function applyInitialTarget(initialTarget) {
      if (!initialTarget) return
      const mode = initialTarget.revisionMode || "singleRevision"
      $("mode").value = mode
      $("revision").value = initialTarget.revision || ""
      $("baseRevision").value = initialTarget.baseRevision || ""
      $("targetRevision").value = initialTarget.targetRevision || ""
      $("workingBaseRevision").value = mode === "workingTreeSinceRevision"
        ? initialTarget.baseRevision || ""
        : ""
      updateMode()
    }

    function clearLoaded() {
      loaded = false
      updateReviewButton()
    }

    function updateReviewButton() {
      $("review").disabled = !loaded || ($("withProjectRules").checked && !bobInitialized)
    }

    function setStatus(text, error = false, ok = false) {
      $("status").textContent = text || ""
      $("status").className = error ? "status error" : ok ? "status ok" : "status"
    }

    function loadTarget() {
      const target = collectTarget()
      if (target.mode === "singleRevision" && !target.revision) {
        setStatus("リビジョンを入力してください", true)
        return
      }
      if (target.mode === "revisionRange" && (!target.baseRevision || !target.targetRevision)) {
        setStatus("基準リビジョンと比較先リビジョンを入力してください", true)
        return
      }
      clearLoaded()
      vscode.postMessage({ type: "loadTarget", ...target })
    }

    function renderBobStatus(status) {
      bobInitialized = Boolean(status.initialized)
      $("initCard").classList.toggle("hidden", bobInitialized)
      $("missingFiles").innerHTML = ""
      for (const file of status.missing || []) {
        const item = document.createElement("li")
        item.textContent = file
        $("missingFiles").appendChild(item)
      }
      updateReviewButton()
    }

    function renderInfo(info) {
      loaded = true
      $("info").classList.remove("hidden")
      updateReviewButton()
      $("infoMode").textContent = info.mode || ""
      $("infoTarget").textContent = info.targetLabel || ""
      $("infoRevision").textContent = info.revision || info.targetRevision || ""
      $("infoRevno").textContent = info.revno || ""
      $("infoAuthor").textContent = info.author || ""
      $("infoCommitter").textContent = info.committer || ""
      $("infoTimestamp").textContent = info.timestamp || ""
      $("infoChangedCount").textContent = String(info.changedFileCount ?? 0)
      $("infoMessage").textContent = info.message || "(メッセージなし)"
      $("infoFiles").innerHTML = ""
      for (const entry of info.changedFileEntries || []) {
        const item = document.createElement("li")
        item.textContent = entry.status + ": " + entry.path
        $("infoFiles").appendChild(item)
      }
    }

    function renderWorkspaceState(message) {
      const parts = []
      if (message.workspace) parts.push("Bazaar: " + message.workspace)
      if (message.bobWorkspace) parts.push("Bob: " + message.bobWorkspace)
      $("workspace").textContent = parts.join(" / ") || "ワークスペース未選択"
    }

    window.addEventListener("message", (event) => {
      const message = event.data
      if (message.type === "workspaceState") {
        renderWorkspaceState(message)
      } else if (message.type === "bobWorkspaceStatus") {
        renderBobStatus(message)
      } else if (message.type === "initialized") {
        setStatus(message.message, false, true)
      } else if (message.type === "loading") {
        setStatus(message.message)
      } else if (message.type === "targetInfo") {
        renderInfo(message.info)
        setStatus("対象情報を取得しました", false, true)
      } else if (message.type === "reviewAdded") {
        renderInfo(message.info)
        renderReviewAddedStatus(message)
      } else if (message.type === "error") {
        setStatus(message.message || "エラー", true)
      }
    })

    function renderReviewAddedStatus(message) {
      const contextText = message.bobContextAdded
        ? "Bob コンテキストへ追加しました"
        : message.bobContextAvailable === false
          ? "IBM Bob 拡張機能が見つからないため Markdown 作成のみで停止しました"
          : "Bob コンテキスト追加に失敗したためクリップボードへコピーしました"
      const stepText = message.workflowStepCompleted
        ? " 現在のワークフローステップも完了しました。"
        : ""
      setStatus(
        "レビュー packet を作成し、" + contextText + "。packet bytes: " + message.packetBytes + stepText,
        false,
        true
      )
    }

    updateMode()
    applyInitialTarget(initialTarget)
    vscode.postMessage({ type: "ready" })
  </script>
</body>
</html>`
}

export function createNonce(): string {
  return randomBytes(16).toString("base64")
}
