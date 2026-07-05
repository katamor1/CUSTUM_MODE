import type { TriageDecision, TriageItem } from "../records/reviewRecordTypes"

export interface HumanTriageGuiModel {
  campaignId: string
  reviewId: string
  reviewResultJsonPath: string
  triagePath?: string
  issues: string[]
  items: TriageItem[]
}

export interface RenderHumanTriageHtmlInput {
  cspSource: string
  nonce: string
  model: HumanTriageGuiModel
}

const DECISIONS: TriageDecision[] = ["accepted", "rejected", "needs_investigation", "deferred"]

export function renderHumanTriageHtml(input: RenderHumanTriageHtmlInput): string {
  const { model } = input
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${escapeHtml(input.cspSource)} 'unsafe-inline'; script-src 'nonce-${escapeHtml(input.nonce)}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bob Bazaar Human Triage</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 18px; }
    h1 { font-size: 20px; margin: 0 0 12px; }
    h2 { font-size: 15px; margin: 18px 0 8px; }
    .card { border: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); border-radius: 6px; padding: 12px; margin-top: 12px; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; }
    .field { display: flex; flex-direction: column; gap: 4px; min-width: 220px; flex: 1 1 220px; }
    label, .muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
    input, select, textarea { color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); padding: 7px; }
    textarea { min-height: 54px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    button { border: 0; padding: 7px 11px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border: 1px solid var(--vscode-panel-border); padding: 6px; text-align: left; vertical-align: top; }
    th { color: var(--vscode-descriptionForeground); font-weight: 500; }
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
    <div class="row">
      <div class="field">
        <label for="campaignId">campaign_id</label>
        <input id="campaignId" value="${escapeHtml(model.campaignId)}">
      </div>
      <div class="field">
        <label for="reviewId">review_id</label>
        <input id="reviewId" value="${escapeHtml(model.reviewId)}">
      </div>
      <div class="field">
        <label for="reviewResultJsonPath">review-result JSON</label>
        <input id="reviewResultJsonPath" value="${escapeHtml(model.reviewResultJsonPath)}">
      </div>
    </div>
    <div class="muted">triage: ${escapeHtml(model.triagePath ?? "未生成")}</div>
    <div class="actions">
      <button type="button" data-action="initCampaign">campaign を初期化</button>
      <button type="button" data-action="createTriage">triage 雛形を生成</button>
      <button type="button" class="secondary" data-action="validateTriage">triage を検証</button>
      <button type="button" class="secondary" data-action="createRecord">record を作成</button>
      <button type="button" class="secondary" data-action="generateSummary">summary 生成</button>
    </div>
  </section>
  <section class="card">
    <h2>Finding 採否判断</h2>
    ${model.items.length === 0 ? `<div class="muted">triage 雛形を生成すると finding が表示されます。</div>` : renderItemsTable(model.items)}
    <div class="actions">
      <button type="button" data-action="saveDecisions">すべて保存</button>
    </div>
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
      vscode.postMessage({
        type: 'bazaarHumanTriage.action',
        action: button.dataset.action,
        campaignId: document.getElementById('campaignId').value,
        reviewId: document.getElementById('reviewId').value,
        reviewResultJsonPath: document.getElementById('reviewResultJsonPath').value,
        items: collectItems()
      });
      setTimeout(() => { button.disabled = false; }, 1200);
    });
    function collectItems() {
      return Array.from(document.querySelectorAll('[data-triage-row]')).map((row) => ({
        finding_id: row.dataset.findingId,
        rule_id: row.dataset.ruleId || undefined,
        decision: row.querySelector('[data-field="decision"]').value,
        action: row.querySelector('[data-field="action"]').value,
        owner: row.querySelector('[data-field="owner"]').value,
        reason: row.querySelector('[data-field="reason"]').value
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

function renderItemsTable(items: TriageItem[]): string {
  return `<table>
    <thead>
      <tr>
        <th>finding</th>
        <th>rule_id</th>
        <th>decision</th>
        <th>owner</th>
        <th>action</th>
        <th>reason</th>
      </tr>
    </thead>
    <tbody>${items.map(renderItemRow).join("")}</tbody>
  </table>`
}

function renderItemRow(item: TriageItem): string {
  return `<tr data-triage-row data-finding-id="${escapeHtml(item.finding_id)}" data-rule-id="${escapeHtml(item.rule_id ?? "")}">
    <td><code>${escapeHtml(item.finding_id)}</code></td>
    <td><code>${escapeHtml(item.rule_id ?? "")}</code></td>
    <td><select data-field="decision">${DECISIONS.map((decision) => `<option value="${decision}"${decision === item.decision ? " selected" : ""}>${decision}</option>`).join("")}</select></td>
    <td><input data-field="owner" value="${escapeHtml(item.owner ?? "")}"></td>
    <td><input data-field="action" value="${escapeHtml(item.action ?? "")}"></td>
    <td><textarea data-field="reason">${escapeHtml(item.reason ?? "")}</textarea></td>
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
