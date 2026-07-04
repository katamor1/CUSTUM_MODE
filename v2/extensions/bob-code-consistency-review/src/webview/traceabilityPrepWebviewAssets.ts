export function renderTraceabilityPrepStyles(): string {
  return `
body {
  font-family: var(--vscode-font-family);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  margin: 0;
  padding: 16px;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--vscode-panel-border);
  padding-bottom: 10px;
}
h1 {
  font-size: 20px;
  margin: 0;
}
.summary {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.pill {
  border: 1px solid var(--vscode-panel-border);
  padding: 4px 8px;
  border-radius: 6px;
}
button {
  padding: 6px 10px;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  border: 0;
  cursor: pointer;
}
button.secondary {
  color: var(--vscode-button-secondaryForeground);
  background: var(--vscode-button-secondaryBackground);
}
select {
  padding: 6px;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border);
}
.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--vscode-panel-border);
  margin: 14px 0;
}
.tab {
  padding: 8px 10px;
  cursor: pointer;
}
.tab.active {
  background: var(--vscode-tab-activeBackground);
  border-bottom: 2px solid var(--vscode-focusBorder);
}
.toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.table {
  display: grid;
  gap: 6px;
}
.row {
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  padding: 8px;
  background: var(--vscode-sideBar-background);
}
.rowHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.meta {
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}
.actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.error {
  color: var(--vscode-errorForeground);
}
.warning {
  color: var(--vscode-editorWarning-foreground);
}
pre {
  white-space: pre-wrap;
  background: var(--vscode-textCodeBlock-background);
  padding: 10px;
}
`
}

export function renderTraceabilityPrepClientScript(initialJson: string): string {
  return String.raw`
const vscode = acquireVsCodeApi();
let model = ` + initialJson + String.raw`;
let activeTab = 'domains';
let typeFilter = 'all';
const content = document.getElementById('content');
const status = document.getElementById('status');

document.getElementById('save').onclick = function() {
  vscode.postMessage({ type: 'save' });
};

document.querySelectorAll('.tab').forEach(function(tab) {
  tab.onclick = function() {
    document.querySelectorAll('.tab').forEach(function(item) {
      item.classList.remove('active');
    });
    tab.classList.add('active');
    activeTab = tab.dataset.tab;
    render();
  };
});

content.addEventListener('click', function(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  event.preventDefault();
  invokeAction(button.dataset.action, readActionArgs(button));
});

content.addEventListener('change', function(event) {
  const target = event.target;
  if (!target || target.dataset.action !== 'typeFilter') return;
  typeFilter = target.value;
  renderItems();
});

window.addEventListener('message', function(event) {
  const message = event.data;
  if (message.type === 'model') {
    model = message.model;
    render();
  } else if (message.type === 'saved') {
    status.textContent = [
      'Saved: ' + message.catalogPath,
      message.backupPath ? ' / backup: ' + message.backupPath : '',
      message.reportPath ? ' / report: ' + message.reportPath : ''
    ].join('');
  } else if (message.type === 'error') {
    status.textContent = message.message;
    status.className = 'error';
  }
});

function send(action) {
  vscode.postMessage({ type: 'action', action: action });
}

function invokeAction(action, args) {
  if (action === 'approveItem') approveItem(args[0]);
  else if (action === 'rejectItem') rejectItem(args[0]);
  else if (action === 'deprecateItem') deprecateItem(args[0]);
  else if (action === 'approveLink') approveLink(args[0], args[1], args[2]);
  else if (action === 'rejectLink') rejectLink(args[0], args[1], args[2]);
  else if (action === 'approveDecision') approveDecision(args[0], args[1]);
  else if (action === 'rejectDecision') rejectDecision(args[0], args[1]);
  else if (action === 'approveDomain') approveDomain(args[0]);
  else if (action === 'rejectDomain') rejectDomain(args[0]);
}

function readActionArgs(button) {
  try {
    return JSON.parse(button.dataset.args || '[]');
  } catch {
    return [];
  }
}

function approveItem(id) {
  send({ type: 'approveItem', proposed_id: id });
}

function rejectItem(id) {
  send({ type: 'rejectItem', proposed_id: id });
}

function deprecateItem(id) {
  send({ type: 'deprecateItem', id: id });
}

function approveLink(from, to, linkType) {
  send({ type: 'approveLink', proposed_from: from, proposed_to: to, link_type: linkType });
}

function rejectLink(from, to, linkType) {
  send({ type: 'rejectLink', proposed_from: from, proposed_to: to, link_type: linkType });
}

function approveDecision(subject, gate) {
  send({ type: 'approveDecision', subject: subject, gate: gate });
}

function rejectDecision(subject, gate) {
  send({ type: 'rejectDecision', subject: subject, gate: gate });
}

function approveDomain(code) {
  send({ type: 'approveDomain', code: code });
}

function rejectDomain(code) {
  send({ type: 'rejectDomain', code: code });
}

function render() {
  renderSummary();
  if (activeTab === 'domains') renderDomains();
  else if (activeTab === 'items') renderItems();
  else if (activeTab === 'links') renderLinks();
  else if (activeTab === 'decisions') renderDecisions();
  else if (activeTab === 'gate') renderGate();
  else renderPreview();
}

function renderSummary() {
  const items = [
    'status: ' + model.report.status,
    'errors: ' + model.report.errors.length,
    'warnings: ' + model.report.warnings.length,
    'proposed items: ' + model.counts.proposedItems
  ];
  document.getElementById('summary').innerHTML = items.map(function(item) {
    return '<span class="pill">' + escapeHtml(item) + '</span>';
  }).join('');
}

function renderDomains() {
  content.innerHTML = '<div class="table">' + model.catalog.domains.map(function(domain) {
    const actions = domain.status === 'proposed'
      ? actionButton('approveDomain', [domain.code], 'Approve')
        + actionButton('rejectDomain', [domain.code], 'Reject', true)
      : '';
    return row(domain.code, domain.status, escapeHtml(domain.label || ''), actions);
  }).join('') + '</div>';
}

function renderItems() {
  const types = ['all', 'requirement', 'basic_design', 'detailed_design', 'test_spec', 'qa_item', 'review_finding'];
  const selector = [
    '<div class="toolbar"><select data-action="typeFilter">',
    types.map(function(type) {
      const selected = type === typeFilter ? 'selected' : '';
      return '<option ' + selected + ' value="' + escapeHtml(type) + '">' + escapeHtml(type) + '</option>';
    }).join(''),
    '</select></div>'
  ].join('');
  const items = model.catalog.items.filter(function(item) {
    return typeFilter === 'all' || item.type === typeFilter;
  });
  content.innerHTML = selector + '<div class="table">' + items.map(renderItemRow).join('') + '</div>';
}

function renderItemRow(item) {
  const id = item.id || item.proposed_id || '';
  let actions = '';
  if (item.status === 'proposed') {
    actions = actionButton('approveItem', [item.proposed_id], 'Approve')
      + actionButton('rejectItem', [item.proposed_id], 'Reject', true);
  } else if (item.status === 'accepted') {
    actions = actionButton('deprecateItem', [item.id], 'Deprecate', true);
  }
  const body = [
    item.type,
    item.source_document_id,
    item.domain,
    item.text_summary || ''
  ].join(' / ');
  return row(id, item.status, escapeHtml(body), actions);
}

function renderLinks() {
  content.innerHTML = '<div class="table">' + (model.catalog.links || []).map(function(link) {
    const from = link.from || link.proposed_from || '';
    const to = link.to || link.proposed_to || '';
    const actions = link.status === 'proposed'
      ? actionButton('approveLink', [link.proposed_from, link.proposed_to, link.link_type], 'Approve')
        + actionButton('rejectLink', [link.proposed_from, link.proposed_to, link.link_type], 'Reject', true)
      : '';
    return row(from + ' -> ' + to, link.status, escapeHtml(link.link_type), actions);
  }).join('') + '</div>';
}

function renderDecisions() {
  content.innerHTML = '<div class="table">' + (model.catalog.decisions || []).map(function(decision) {
    const actions = decision.status === 'proposed'
      ? actionButton('approveDecision', [decision.subject, decision.gate], 'Approve')
        + actionButton('rejectDecision', [decision.subject, decision.gate], 'Reject', true)
      : '';
    return row(decision.subject, decision.status, escapeHtml(decision.gate + ' / ' + (decision.reason || '')), actions);
  }).join('') + '</div>';
}

function renderGate() {
  content.innerHTML = [
    '<h2>Gate Report</h2><h3>Errors</h3>',
    issues(model.report.errors, 'error'),
    '<h3>Warnings</h3>',
    issues(model.report.warnings, 'warning')
  ].join('');
}

function renderPreview() {
  const accepted = model.catalog.items.filter(function(item) {
    return item.status === 'accepted';
  }).map(function(item) {
    return {
      id: item.id,
      type: item.type,
      path: item.source_path,
      document: item.source_document_id
    };
  });
  content.innerHTML = [
    '<h2>Review Input Preview</h2><pre>',
    escapeHtml(JSON.stringify(accepted, null, 2)),
    '</pre>'
  ].join('');
}

function issues(items, cls) {
  if (!items.length) return '<div class="meta">none</div>';
  return '<div class="table">' + items.map(function(item) {
    return [
      '<div class="row ',
      cls,
      '"><b>',
      escapeHtml(item.code),
      '</b><div>',
      escapeHtml(item.message),
      '</div><div class="meta">',
      escapeHtml(item.subject || ''),
      '</div></div>'
    ].join('');
  }).join('') + '</div>';
}

function row(title, state, body, actions) {
  return [
    '<div class="row"><div class="rowHead"><div><b>',
    escapeHtml(title),
    '</b><div class="meta">',
    escapeHtml(state),
    '</div></div><div class="actions">',
    actions,
    '</div></div><div>',
    body,
    '</div></div>'
  ].join('');
}

function actionButton(action, args, label, secondary) {
  const classAttr = secondary ? ' class="secondary"' : '';
  return '<button' + classAttr + ' data-action="' + escapeHtml(action) + '" data-args="' + escapeHtml(JSON.stringify(args)) + '">' + escapeHtml(label) + '</button>';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, function(character) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;'
    }[character];
  });
}

render();
vscode.postMessage({ type: 'ready' });
`
}
