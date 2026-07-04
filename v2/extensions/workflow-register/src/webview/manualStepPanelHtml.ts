import type { ManualStepActionViewModel } from "./manualStepViewModel"

interface RenderManualStepHtmlInput {
  cspSource: string
  nonce: string
  viewModel: ManualStepActionViewModel
}

export function renderManualStepHtml(input: RenderManualStepHtmlInput): string {
  const { cspSource, nonce, viewModel } = input
  const active = viewModel.status === "active" && viewModel.activeKey
  const script = active ? `
    <script nonce="${escapeHtml(nonce)}">
      const vscode = acquireVsCodeApi();
      const completion = ${safeJson({ activeKey: viewModel.activeKey })};
      const button = document.getElementById('completeButton');
      if (button) {
        button.addEventListener('click', () => {
          button.disabled = true;
          button.textContent = '処理中...';
          vscode.postMessage({
            type: 'completeManualStep',
            activeKey: completion.activeKey
          });
        });
      }
    </script>` : ""
  const actionArea = active
    ? `<button id="completeButton" type="button">${escapeHtml(viewModel.completeLabel)}</button>`
    : readonlyActionHtml(viewModel)
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${escapeHtml(cspSource)}; style-src 'nonce-${escapeHtml(nonce)}'; script-src 'nonce-${escapeHtml(nonce)}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bob Workflow Manual Step</title>
  <style nonce="${escapeHtml(nonce)}">
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; min-height: 100vh; display: flex; flex-direction: column; }
    header { border-bottom: 1px solid var(--vscode-panel-border); padding: 14px 18px; }
    main { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 16px 18px 96px; }
    footer { position: sticky; bottom: 0; border-top: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); padding: 12px 18px; }
    h1 { font-size: 18px; margin: 0; }
    h2 { font-size: 15px; margin: 18px 0 8px; }
    .metadata, .message, .readonly-message { border: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); padding: 12px; border-radius: 4px; }
    .metadata div { margin: 4px 0; }
    .message { white-space: pre-wrap; line-height: 1.55; }
    .muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
    button { border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-background); color: var(--vscode-button-foreground); padding: 7px 12px; margin-right: 8px; border-radius: 2px; cursor: pointer; }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
  </style>
</head>
<body>
  <header><h1>Bob Workflow Manual Step</h1></header>
  <main>
    <section class="metadata">
      <div><strong>Workflow:</strong> ${escapeHtml(viewModel.workflowLabel)}</div>
      <div><strong>Run ID:</strong> ${escapeHtml(viewModel.runId)}</div>
      <div><strong>Step:</strong> ${escapeHtml(viewModel.stepId)} / ${escapeHtml(viewModel.stepTitle)}</div>
      <div><strong>Status:</strong> ${escapeHtml(viewModel.status)}</div>
    </section>
    <h2>操作内容</h2>
    <section class="message">${escapeHtml(viewModel.message)}</section>
    <h2>参考情報</h2>
    <section class="metadata">
      <div><strong>workflowFile:</strong> ${escapeHtml(viewModel.workflowFile ?? "none")}</div>
      <div><strong>state keys:</strong> ${escapeHtml(viewModel.stateKeys.join(", ") || "none")}</div>
    </section>
  </main>
  <footer>${actionArea}</footer>
  ${script}
</body>
</html>`
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
}

function readonlyActionHtml(viewModel: ManualStepActionViewModel): string {
  if (viewModel.status === "completed") {
    return `<div class="readonly-message">${escapeHtml("この step は完了しました。Run Control View で workflow の次の状態を確認してください。")}</div>`
  }
  if (viewModel.status === "error") {
    return `<div class="readonly-message">${escapeHtml("完了処理に失敗しました。操作内容のエラー表示を確認してください。")}</div>`
  }
  return `<div class="readonly-message">${escapeHtml("この run は held ですが、現在の Bob task への接続がありません。VS Code の再起動などで active step handle が失われた可能性があります。Bob ワークフロー: 実行を再開 または Bob ワークフロー: 次のステップを実行 を使って復帰してください。")}</div>`
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
