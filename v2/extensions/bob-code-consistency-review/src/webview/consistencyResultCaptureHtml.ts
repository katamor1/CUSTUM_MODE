export interface RenderConsistencyResultCaptureHtmlInput {
  cspSource: string
  nonce: string
}

export function renderConsistencyResultCaptureHtml(input: RenderConsistencyResultCaptureHtmlInput): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${escapeHtml(input.cspSource)} 'unsafe-inline'; script-src 'nonce-${escapeHtml(input.nonce)}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Code Consistency Result Capture</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 18px; }
    h1 { font-size: 20px; margin: 0 0 12px; }
    h2 { font-size: 15px; margin: 18px 0 8px; }
    .card { border: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); border-radius: 6px; padding: 12px; margin-top: 12px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    button { border: 0; padding: 7px 11px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    textarea { width: 100%; min-height: 240px; box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); font-family: var(--vscode-editor-font-family); }
    .muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .status { white-space: pre-wrap; margin-top: 10px; }
    .ok { color: var(--vscode-testing-iconPassed); }
    .error { color: var(--vscode-errorForeground); }
  </style>
</head>
<body>
  <h1>Result Capture</h1>
  <section class="card">
    <h2>Bob output YAML</h2>
    <div class="muted">保存前に bob-output schema と evidence-index 参照を検証します。</div>
    <textarea id="manualText" aria-label="Bob output YAML"></textarea>
    <div class="actions">
      <button type="button" data-action="captureManual">貼り付け内容を検証して保存</button>
      <button type="button" class="secondary" data-action="captureClipboard">clipboard から取り込む</button>
      <button type="button" class="secondary" data-action="validateOutput">保存済み YAML を検証</button>
      <button type="button" class="secondary" data-action="openHumanTriage">Human Triage へ進む</button>
    </div>
  </section>
  <section class="card">
    <h2>検証結果</h2>
    <div id="status" class="status muted">未実行</div>
  </section>
  <script nonce="${escapeHtml(input.nonce)}">
    const vscode = acquireVsCodeApi();
    document.addEventListener('click', (event) => {
      const button = event.target && event.target.closest ? event.target.closest('button[data-action]') : undefined;
      if (!button) return;
      button.disabled = true;
      vscode.postMessage({
        type: 'consistencyResultCapture.action',
        action: button.dataset.action,
        text: document.getElementById('manualText').value
      });
      setTimeout(() => { button.disabled = false; }, 1200);
    });
    window.addEventListener('message', (event) => {
      const message = event.data || {};
      const status = document.getElementById('status');
      status.className = 'status ' + (message.ok ? 'ok' : 'error');
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
