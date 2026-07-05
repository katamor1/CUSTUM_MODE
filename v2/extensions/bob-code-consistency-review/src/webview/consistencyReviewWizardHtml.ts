import {
  CHANGE_TYPE_VALUES,
  REVIEW_FOCUS_VALUES,
  VCS_VALUES,
  type ChangeType,
  type ReviewFocus,
  type VcsKind
} from "../core/reviewInputBuilder"
import type { ReviewInputDocumentCandidate } from "../core/reviewInputDiscovery"

export interface ConsistencyWizardTraceabilitySummary {
  proposed: number
  accepted: number
  rejected: number
  deprecated: number
  errors: number
  warnings: number
}

export interface ConsistencyWizardPackageFile {
  label: string
  path: string
}

export interface ConsistencyReviewWizardModel {
  workspaceRoot: string
  base: string
  head: string
  vcs: VcsKind
  changeType: ChangeType
  focus: ReviewFocus[]
  documents: ReviewInputDocumentCandidate[]
  traceability: ConsistencyWizardTraceabilitySummary
  packagePreview: ConsistencyWizardPackageFile[]
  warnings: string[]
}

export interface RenderConsistencyReviewWizardHtmlInput {
  cspSource: string
  nonce: string
  model: ConsistencyReviewWizardModel
}

export function renderConsistencyReviewWizardHtml(input: RenderConsistencyReviewWizardHtmlInput): string {
  const { model } = input
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${escapeHtml(input.cspSource)} 'unsafe-inline'; script-src 'nonce-${escapeHtml(input.nonce)}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Consistency Review Wizard</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 18px; }
    h1 { font-size: 20px; margin: 0 0 12px; }
    h2 { font-size: 15px; margin: 18px 0 8px; }
    .card { border: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); border-radius: 6px; padding: 12px; margin-top: 12px; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; }
    .field { display: flex; flex-direction: column; gap: 4px; min-width: 180px; flex: 1 1 180px; }
    label, .muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
    input, select { color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); padding: 7px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    button { border: 0; padding: 7px 11px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; }
    .doc { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 8px; background: var(--vscode-editor-background); }
    .focus { display: inline-flex; align-items: center; gap: 4px; margin: 4px 10px 4px 0; }
    .status { white-space: pre-wrap; margin-top: 10px; }
    .warning { color: var(--vscode-editorWarning-foreground); }
    .ok { color: var(--vscode-testing-iconPassed); }
    code { font-family: var(--vscode-editor-font-family); }
  </style>
</head>
<body>
  <h1>Consistency Review Wizard</h1>
  <section class="card">
    <h2>VCS / Revision</h2>
    <div class="row">
      <div class="field"><label for="reviewId">review_id</label><input id="reviewId" value="code-consistency-review"></div>
      <div class="field"><label for="reviewTitle">title</label><input id="reviewTitle" value="コード整合プレレビュー"></div>
      <div class="field"><label for="vcs">VCS</label><select id="vcs">${VCS_VALUES.map((value) => option(value, model.vcs)).join("")}</select></div>
      <div class="field"><label for="changeType">change_type</label><select id="changeType">${CHANGE_TYPE_VALUES.map((value) => option(value, model.changeType)).join("")}</select></div>
      <div class="field"><label for="base">base</label><input id="base" value="${escapeHtml(model.base)}"></div>
      <div class="field"><label for="head">head</label><input id="head" value="${escapeHtml(model.head)}"></div>
    </div>
  </section>
  <section class="card">
    <h2>Evidence Picker</h2>
    <div class="grid">${model.documents.length === 0 ? `<div class="muted">文書候補はありません。</div>` : model.documents.map(renderDocument).join("")}</div>
  </section>
  <section class="card">
    <h2>Review Focus</h2>
    ${REVIEW_FOCUS_VALUES.map((focus) => `<label class="focus"><input type="checkbox" data-focus="${focus}"${model.focus.includes(focus) ? " checked" : ""}>${focus}</label>`).join("")}
  </section>
  <section class="card">
    <h2>Traceability</h2>
    <div class="muted">proposed ${model.traceability.proposed} / accepted ${model.traceability.accepted} / rejected ${model.traceability.rejected} / deprecated ${model.traceability.deprecated} / errors ${model.traceability.errors} / warnings ${model.traceability.warnings}</div>
    <div class="actions">
      <button type="button" data-action="openTraceabilityPrep">Traceability Prep を開く</button>
      <button type="button" class="secondary" data-action="createReviewInputFromTraceability">Traceability から review-input</button>
      <button type="button" class="secondary" data-action="validateTraceability">Traceability を検証</button>
    </div>
  </section>
  <section class="card">
    <h2>Package Preview</h2>
    ${model.packagePreview.length === 0 ? `<div class="muted">review-package はまだ生成されていません。</div>` : `<ul>${model.packagePreview.map((file) => `<li><code>${escapeHtml(file.path)}</code></li>`).join("")}</ul>`}
    <div class="actions">
      <button type="button" data-action="createReviewInput">選択内容から review-input を生成</button>
      <button type="button" data-action="preprocess">Bob 用パッケージを作成</button>
      <button type="button" class="secondary" data-action="openResultCapture">Result Capture へ進む</button>
      <button type="button" class="secondary" data-action="openHumanTriage">Human Triage へ進む</button>
    </div>
  </section>
  <section class="card">
    <h2>Status</h2>
    <div id="status" class="status ${model.warnings.length > 0 ? "warning" : "muted"}">${escapeHtml(model.warnings.join("\n") || "未実行")}</div>
  </section>
  <script nonce="${escapeHtml(input.nonce)}">
    const vscode = acquireVsCodeApi();
    document.addEventListener('click', (event) => {
      const button = event.target && event.target.closest ? event.target.closest('button[data-action]') : undefined;
      if (!button) return;
      button.disabled = true;
      vscode.postMessage({ type: 'consistencyWizard.action', action: button.dataset.action, draft: collectDraft() });
      setTimeout(() => { button.disabled = false; }, 1200);
    });
    function collectDraft() {
      return {
        reviewId: document.getElementById('reviewId').value,
        reviewTitle: document.getElementById('reviewTitle').value,
        vcs: document.getElementById('vcs').value,
        changeType: document.getElementById('changeType').value,
        base: document.getElementById('base').value,
        head: document.getElementById('head').value,
        documentPaths: Array.from(document.querySelectorAll('[data-document-path]:checked')).map((item) => item.dataset.documentPath),
        focus: Array.from(document.querySelectorAll('[data-focus]:checked')).map((item) => item.dataset.focus)
      };
    }
    window.addEventListener('message', (event) => {
      const message = event.data || {};
      const status = document.getElementById('status');
      status.className = 'status ' + (message.ok ? 'ok' : 'warning');
      status.textContent = message.message || '';
    });
  </script>
</body>
</html>`
}

function renderDocument(candidate: ReviewInputDocumentCandidate): string {
  return `<label class="doc">
    <input type="checkbox" data-document-path="${escapeHtml(candidate.path)}" checked>
    <strong>${escapeHtml(candidate.label)}</strong>
    <div class="muted">${escapeHtml(candidate.kind)} / ${escapeHtml(candidate.description ?? "")}</div>
  </label>`
}

function option(value: string, selected: string): string {
  return `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(value)}</option>`
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
