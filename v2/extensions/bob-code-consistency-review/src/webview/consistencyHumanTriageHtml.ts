export interface ConsistencyHumanTriageItem {
  source_id?: string
  source_type?: string
  decision?: string
  final_severity?: string
  owner?: string
  reason?: string
  review_comment?: string
  question?: string
  follow_up?: Record<string, unknown>
}

export interface ConsistencyHumanTriageModel {
  outDir: string
  bobOutputPath: string
  items: ConsistencyHumanTriageItem[]
  issues: string[]
}

export interface RenderConsistencyHumanTriageHtmlInput {
  cspSource: string
  nonce: string
  model: ConsistencyHumanTriageModel
}

const DECISIONS = ["accepted", "rejected", "needs_investigation", "deferred", "question"] as const

export function renderConsistencyHumanTriageHtml(input: RenderConsistencyHumanTriageHtmlInput): string {
  const { model } = input
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${escapeHtml(input.cspSource)} 'unsafe-inline'; script-src 'nonce-${escapeHtml(input.nonce)}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Code Consistency Human Triage</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 18px; }
    h1 { font-size: 20px; margin: 0 0 12px; }
    h2 { font-size: 15px; margin: 18px 0 8px; }
    .card { border: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); border-radius: 6px; padding: 12px; margin-top: 12px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    button { border: 0; padding: 7px 11px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border: 1px solid var(--vscode-panel-border); padding: 6px; text-align: left; vertical-align: top; }
    th { color: var(--vscode-descriptionForeground); font-weight: 500; }
    input, select, textarea { color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); padding: 6px; }
    textarea { min-height: 54px; min-width: 220px; }
    .muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .status { white-space: pre-wrap; margin-top: 10px; }
    .error { color: var(--vscode-errorForeground); }
    .ok { color: var(--vscode-testing-iconPassed); }
    code { font-family: var(--vscode-editor-font-family); }
  </style>
</head>
<body>
  <h1>Human Triage</h1>
  <section class="card">
    <h2>対象</h2>
    <div class="muted">bob-output: ${escapeHtml(model.bobOutputPath)} / triage: ${escapeHtml(model.outDir)}</div>
    <div class="actions">
      <button type="button" data-action="generateTriage">triage を生成</button>
      <button type="button" data-action="saveDecisions">すべて保存</button>
      <button type="button" class="secondary" data-action="openResultCapture">Result Capture へ戻る</button>
    </div>
  </section>
  <section class="card">
    <h2>Finding / Question 採否判断</h2>
    ${model.items.length === 0 ? `<div class="muted">triage を生成すると item が表示されます。</div>` : renderItemsTable(model.items)}
  </section>
  <section class="card">
    <h2>検証結果</h2>
    <div id="status" class="status ${model.issues.length > 0 ? "error" : "muted"}">${escapeHtml(model.issues.join("\n") || "未実行")}</div>
  </section>
  <script nonce="${escapeHtml(input.nonce)}">
    const vscode = acquireVsCodeApi();
    document.addEventListener('click', (event) => {
      const button = event.target && event.target.closest ? event.target.closest('button[data-action]') : undefined;
      if (!button) return;
      button.disabled = true;
      vscode.postMessage({ type: 'consistencyHumanTriage.action', action: button.dataset.action, items: collectItems() });
      setTimeout(() => { button.disabled = false; }, 1200);
    });
    function collectItems() {
      return Array.from(document.querySelectorAll('[data-triage-row]')).map((row) => ({
        source_id: row.dataset.sourceId,
        source_type: row.dataset.sourceType,
        decision: row.querySelector('[data-field="decision"]').value,
        final_severity: row.querySelector('[data-field="final_severity"]').value,
        owner: row.querySelector('[data-field="owner"]').value,
        reason: row.querySelector('[data-field="reason"]').value,
        review_comment: row.querySelector('[data-field="review_comment"]').value,
        question: row.dataset.question || ''
      }));
    }
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

function renderItemsTable(items: ConsistencyHumanTriageItem[]): string {
  return `<table>
    <thead>
      <tr>
        <th>source</th>
        <th>decision</th>
        <th>severity</th>
        <th>owner</th>
        <th>reason</th>
        <th>comment</th>
      </tr>
    </thead>
    <tbody>${items.map(renderItemRow).join("")}</tbody>
  </table>`
}

function renderItemRow(item: ConsistencyHumanTriageItem): string {
  return `<tr data-triage-row data-source-id="${escapeHtml(item.source_id ?? "")}" data-source-type="${escapeHtml(item.source_type ?? "")}" data-question="${escapeHtml(item.question ?? "")}">
    <td><code>${escapeHtml(item.source_id ?? "")}</code><div class="muted">${escapeHtml(item.source_type ?? "")}</div></td>
    <td><select data-field="decision">${DECISIONS.map((decision) => `<option value="${decision}"${decision === item.decision ? " selected" : ""}>${decision}</option>`).join("")}</select></td>
    <td><input data-field="final_severity" value="${escapeHtml(item.final_severity ?? "")}"></td>
    <td><input data-field="owner" value="${escapeHtml(item.owner ?? "")}"></td>
    <td><textarea data-field="reason">${escapeHtml(item.reason ?? "")}</textarea></td>
    <td><textarea data-field="review_comment">${escapeHtml(item.review_comment ?? "")}</textarea></td>
  </tr>`
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
