export interface RenderResultCaptureHtmlInput {
  cspSource: string
  nonce: string
}

export function renderResultCaptureHtml(input: RenderResultCaptureHtmlInput): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${escapeHtml(input.cspSource)} 'unsafe-inline'; script-src 'nonce-${escapeHtml(input.nonce)}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bob Bazaar Result Capture</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 18px; }
    h1 { font-size: 20px; margin: 0 0 12px; }
    h2 { font-size: 15px; margin: 18px 0 8px; }
    .card { border: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); border-radius: 6px; padding: 12px; margin-top: 12px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    button { border: 0; padding: 7px 11px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    textarea { width: 100%; min-height: 220px; box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); font-family: var(--vscode-editor-font-family); }
    .muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .status { white-space: pre-wrap; margin-top: 10px; }
    .ok { color: var(--vscode-testing-iconPassed); }
    .error { color: var(--vscode-errorForeground); }
  </style>
</head>
<body>
  <h1>Result Capture</h1>
  <section class="card">
    <h2>Bob 出力候補</h2>
    <div class="muted">active editor selection、active editor、clipboard の順で既存 capture helper に渡します。保存前に review-result JSON schema と checklist contract を検証します。</div>
    <div class="actions">
      <button type="button" data-action="captureCandidates">候補から取り込む</button>
      <button type="button" class="secondary" data-action="validateActive">開いている JSON を検証</button>
      <button type="button" class="secondary" data-action="openTriage">Human Triage へ進む</button>
    </div>
  </section>
  <section class="card">
    <h2>手動貼り付け</h2>
    <textarea id="manualText" aria-label="Bob review-result JSON"></textarea>
    <div class="actions">
      <button type="button" data-action="captureManual">貼り付け内容を検証して保存</button>
    </div>
  </section>
  <section class="card">
    <h2>検証結果</h2>
    <div id="status" class="status muted">未実行</div>
  </section>
  <script nonce="${escapeHtml(input.nonce)}">
    const vscode = acquireVsCodeApi();
    const status = document.getElementById('status');
    document.addEventListener('click', (event) => {
      const button = event.target && event.target.closest ? event.target.closest('button[data-action]') : undefined;
      if (!button) return;
      button.disabled = true;
      vscode.postMessage({
        type: 'bazaarResultCapture.action',
        action: button.dataset.action,
        text: document.getElementById('manualText').value
      });
      setTimeout(() => { button.disabled = false; }, 1200);
    });
    window.addEventListener('message', (event) => {
      const message = event.data || {};
      status.className = 'status ' + (message.ok ? 'ok' : message.error ? 'error' : 'muted');
      status.textContent = message.message || '';
    });
  </script>
</body>
</html>`
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
