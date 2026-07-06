import type {
  OperationHubAction,
  OperationHubArtifactSummary,
  OperationHubModel,
  OperationHubRunSummary,
  OperationHubSetupItem,
  OperationHubWorkflowSummary
} from "./operationHubModel"

export interface RenderOperationHubHtmlInput {
  cspSource: string
  nonce: string
  model: OperationHubModel
}

export function renderOperationHubHtml(input: RenderOperationHubHtmlInput): string {
  const { cspSource, nonce, model } = input
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${escapeHtml(cspSource)}; style-src 'nonce-${escapeHtml(nonce)}'; script-src 'nonce-${escapeHtml(nonce)}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bob Operation Hub</title>
  <style nonce="${escapeHtml(nonce)}">
    body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
    main { padding: 12px; display: flex; flex-direction: column; gap: 14px; }
    h1 { font-size: 17px; margin: 0 0 4px; }
    h2 { font-size: 14px; margin: 0 0 8px; }
    h3 { font-size: 13px; margin: 0 0 4px; }
    .muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .section { border-top: 1px solid var(--vscode-panel-border); padding-top: 12px; }
    .grid { display: grid; grid-template-columns: 1fr; gap: 8px; }
    .card { border: 1px solid var(--vscode-panel-border); border-radius: 4px; background: var(--vscode-editor-background); padding: 10px; }
    .card.focused-run { border-color: var(--vscode-focusBorder); box-shadow: inset 3px 0 0 var(--vscode-focusBorder); }
    .card-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .title-badges { display: flex; align-items: center; gap: 4px; }
    .badge { border-radius: 3px; border: 1px solid var(--vscode-panel-border); padding: 1px 5px; font-size: 11px; white-space: nowrap; }
    .ok { color: var(--vscode-testing-iconPassed); }
    .warning { color: var(--vscode-editorWarning-foreground); }
    .error { color: var(--vscode-editorError-foreground); }
    .info { color: var(--vscode-descriptionForeground); }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    button { border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); padding: 5px 8px; cursor: pointer; }
    button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    button.danger { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-foreground); }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    .progress { margin-top: 6px; height: 6px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); }
    .progress span { display: block; height: 100%; background: var(--vscode-progressBar-background); }
    .artifact { display: flex; justify-content: space-between; align-items: center; gap: 6px; border-top: 1px solid var(--vscode-panel-border); padding-top: 6px; margin-top: 6px; }
    code { font-family: var(--vscode-editor-font-family); font-size: 11px; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Bob Operation Hub</h1>
      <div class="muted">${escapeHtml(model.home.workspaceName)} / workflow ${model.home.workflowCount} / active run ${model.home.activeRunCount}</div>
      <div class="actions">${model.home.recommendedActions.map(renderActionButton).join("")}</div>
    </header>
    <section class="section" id="setup">
      <h2>セットアップ</h2>
      <div class="grid">${model.setupChecklist.map(renderSetupItem).join("")}</div>
    </section>
    <section class="section" id="catalog">
      <h2>ワークフロー一覧</h2>
      ${model.workflowCatalog.length === 0 ? `<div class="card muted">ワークフロー定義はまだありません。</div>` : `<div class="grid">${model.workflowCatalog.map(renderWorkflow).join("")}</div>`}
    </section>
    <section class="section" id="runs">
      <h2>Run Monitor</h2>
      ${model.runMonitor.length === 0 ? `<div class="card muted">実行中または直近の run はありません。</div>` : `<div class="grid">${model.runMonitor.map(renderRun).join("")}</div>`}
    </section>
  </main>
  <script nonce="${escapeHtml(nonce)}">
    const vscode = acquireVsCodeApi();
    document.addEventListener('click', (event) => {
      const button = event.target && event.target.closest ? event.target.closest('button[data-action]') : undefined;
      if (!button) return;
      button.disabled = true;
      vscode.postMessage({
        type: 'operationHub.action',
        action: button.dataset.action,
        workflowId: button.dataset.workflowId,
        runId: button.dataset.runId,
        artifactPath: button.dataset.artifactPath
      });
      setTimeout(() => { button.disabled = false; }, 1200);
    });
  </script>
</body>
</html>`
}

function renderSetupItem(item: OperationHubSetupItem): string {
  return `<article class="card">
    <div class="card-title"><h3>${escapeHtml(item.label)}</h3><span class="badge ${escapeHtml(item.status)}">${escapeHtml(statusText(item.status))}</span></div>
    <div class="muted">${escapeHtml(item.message)}</div>
    ${item.action ? `<div class="actions">${renderActionButton(item.action)}</div>` : ""}
  </article>`
}

function renderWorkflow(workflow: OperationHubWorkflowSummary): string {
  return `<article class="card">
    <div class="card-title"><h3>${escapeHtml(workflow.label)}</h3><span class="badge info">${escapeHtml(workflow.category)}</span></div>
    <div class="muted">${escapeHtml(workflow.description || "説明なし")}</div>
    <div class="muted">必須入力 ${workflow.requiredInputCount} / 成果物 ${workflow.artifactCount}</div>
    <div class="actions">${workflow.primaryActions.map(renderActionButton).join("")}</div>
  </article>`
}

function renderRun(run: OperationHubRunSummary): string {
  const percent = run.totalStepCount === 0 ? 0 : Math.round((run.completedStepCount / run.totalStepCount) * 100)
  const cardClass = run.focused ? "card focused-run" : "card"
  const focusBadge = run.focused ? `<span class="badge warning">操作対象</span>` : ""
  const statusKind = run.status === "failed" ? "error" : "info"
  const statusBadge = `<span class="badge ${statusKind}">${escapeHtml(run.statusLabel)}</span>`
  return `<article class="${cardClass}">
    <div class="card-title"><h3>${escapeHtml(run.workflowName)}</h3><span class="title-badges">${focusBadge}${statusBadge}</span></div>
    <div class="muted"><code>${escapeHtml(run.runId)}</code> / ${escapeHtml(run.currentStepLabel)}</div>
    <div class="progress" aria-label="progress"><span style="width:${percent}%"></span></div>
    <div class="muted">${run.completedStepCount}/${run.totalStepCount} step / updated ${escapeHtml(run.updatedAt)}</div>
    <div class="actions">${run.primaryActions.map(renderActionButton).join("")}</div>
    ${run.artifacts.map(renderArtifact).join("")}
  </article>`
}

function renderArtifact(artifact: OperationHubArtifactSummary): string {
  return `<div class="artifact"><code>${escapeHtml(artifact.displayPath)}</code>${renderActionButton(artifact.action)}</div>`
}

function renderActionButton(action: OperationHubAction): string {
  const classes = action.variant ? ` class="${escapeHtml(action.variant)}"` : ""
  const workflowId = action.workflowId ? ` data-workflow-id="${escapeHtml(action.workflowId)}"` : ""
  const runId = action.runId ? ` data-run-id="${escapeHtml(action.runId)}"` : ""
  const artifactPath = action.artifactPath ? ` data-artifact-path="${escapeHtml(action.artifactPath)}"` : ""
  return `<button type="button"${classes} data-action="${escapeHtml(action.id)}"${workflowId}${runId}${artifactPath}>${escapeHtml(action.label)}</button>`
}

function statusText(status: OperationHubSetupItem["status"]): string {
  switch (status) {
    case "ok": return "OK"
    case "warning": return "確認"
    case "error": return "エラー"
    case "info": return "情報"
    default: return status
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
