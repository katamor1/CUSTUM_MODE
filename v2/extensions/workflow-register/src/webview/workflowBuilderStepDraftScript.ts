export function renderWorkflowBuilderStepDraftScript(): string {
  return String.raw`
const stepDraftOriginalHandleFieldEvent = handleFieldEvent;
document.removeEventListener('input', handleFieldEvent);
document.removeEventListener('change', handleFieldEvent);
let stepDraftIndex = -1;
let stepDraft = undefined;
let stepDraftOriginalJson = '';
let latestStepDraftHostValidation = undefined;
function cloneStepDraft(value) { return JSON.parse(JSON.stringify(value)); }
function clearStepDraft() { stepDraftIndex = -1; stepDraft = undefined; stepDraftOriginalJson = ''; latestStepDraftHostValidation = undefined; }
function ensureStepDraft() { const step = model.steps[selectedStepIndex]; if (!step) { clearStepDraft(); return undefined; } if (stepDraftIndex !== selectedStepIndex || !stepDraft) { stepDraftIndex = selectedStepIndex; stepDraft = cloneStepDraft(step); stepDraftOriginalJson = JSON.stringify(stepDraft); latestStepDraftHostValidation = undefined; } return stepDraft; }
function isStepDraftDirty() { return Boolean(stepDraft) && JSON.stringify(stepDraft) !== stepDraftOriginalJson; }
function requestStepDraftHostValidation() { const step = ensureStepDraft(); if (!step) return; vscode.postMessage({ type: 'validateStepDraft', model: model, draftStep: cloneStepDraft(step), stepIndex: selectedStepIndex }); }
function validateStepDraftInWebview() {
  const step = ensureStepDraft();
  const diagnostics = [];
  const impacts = [];
  function add(severity, message) { diagnostics.push({ severity: severity, message: message }); }
  if (!step) return { status: 'error', diagnostics: [{ severity: 'error', message: 'step が選択されていません。' }], impacts: [] };
  if (!String(step.id || '').trim()) add('error', 'step id は必須です。');
  else if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(step.id).trim())) add('error', 'step id は英数字で始め、英数字・ドット・アンダースコア・ハイフンだけを使用してください。');
  if (!String(step.title || '').trim()) add('error', 'step title は必須です。');
  if (!['agent', 'command', 'manual', 'result'].includes(step.type)) add('error', '未対応の step type です: ' + step.type);
  if (step.maxResultBytes !== undefined && (!Number.isFinite(Number(step.maxResultBytes)) || Number(step.maxResultBytes) <= 0)) add('error', 'maxResultBytes は正の数を指定してください。');
  if (step.stateRequired === true && (!Array.isArray(step.includeState) || step.includeState.length === 0)) add('error', 'stateRequired が true の場合は includeState を1件以上指定してください。');
  if ((step.type === 'agent' || step.type === 'manual') && !String(step.prompt || '').trim()) add('error', step.type + ' step では prompt が必須です。');
  if (step.type === 'command') {
    const provider = step.action && step.action.provider;
    const args = step.action && Array.isArray(step.action.args) ? step.action.args : [];
    if (!String(provider || '').trim()) add('error', 'command step では action.provider が必須です。');
    if (provider === 'vscode.executeCommand' && !String(args[0] || '').trim()) add('error', 'provider が vscode.executeCommand の場合は args[0] に command id が必要です。');
    if (step.sendResult === true && !String(step.resultKey || '').trim()) add('warning', 'sendResult が true ですが resultKey が未設定です。');
    if (step.sendResult === true && step.maxResultBytes === undefined) add('warning', 'sendResult が true の command step では maxResultBytes の指定を推奨します。');
  }
  if (step.type === 'result') {
    const result = step.result || {};
    const sink = Array.isArray(result.sinks) ? result.sinks[0] : undefined;
    if (result.source === 'state' && !String(result.stateKey || '').trim()) add('error', 'result.source が state の場合は result.stateKey が必須です。');
    if (result.source === 'literal' && !String(result.text || '').trim()) add('error', 'result.source が literal の場合は literal text が必須です。');
    if (!sink || !String(sink.path || '').trim()) add('error', 'file sink path は必須です。');
    if (result.source === 'state' && step.resultKey && result.stateKey === step.resultKey) add('error', 'result.stateKey が同一 step の resultKey を参照しています。');
  }
  const original = model.steps[selectedStepIndex];
  if (original) {
    if (original.type !== step.type) impacts.push({ severity: 'warning', message: 'step type を ' + original.type + ' から ' + step.type + ' へ変更します。' });
    if (original.id && step.id && original.id !== step.id) model.artifacts.forEach(function(artifact) { if (artifact.producedBy === original.id) impacts.push({ severity: 'error', message: "artifact '" + artifact.id + "' の producedBy が孤立します。" }); });
    if (original.resultKey && original.resultKey !== step.resultKey) model.steps.forEach(function(candidate, index) { if (index > selectedStepIndex && (candidate.includeState || []).includes(original.resultKey)) impacts.push({ severity: 'error', message: "step '" + candidate.id + "' の includeState が孤立します: " + original.resultKey }); });
  }
  const nextSteps = model.steps.map(function(candidate, index) { return index === selectedStepIndex ? step : candidate; });
  analyzeReferences(nextSteps).forEach(function(issue) { if (issue.stepIndex === selectedStepIndex || issue.stepId === step.id || issue.artifactId) impacts.push({ severity: 'error', message: issue.message }); });
  const all = diagnostics.concat(impacts);
  const status = all.some(function(item) { return item.severity === 'error'; }) ? 'error' : all.some(function(item) { return item.severity === 'warning'; }) ? 'warning' : 'ok';
  return { status: status, diagnostics: diagnostics, impacts: impacts };
}
function renderHostStepDraftValidation() { const host = latestStepDraftHostValidation; if (!host || host.stepIndex !== selectedStepIndex) return '<div class="muted">Host validation はまだ実行されていません。Validate step を押すと、保存時 validator 相当の workflow-level check を確認できます。</div>'; const local = host.stepValidation || {}; const workflow = host.workflowValidation || {}; const workflowItems = Array.isArray(workflow.diagnostics) ? workflow.diagnostics : []; const localItems = (local.diagnostics || []).concat(local.affectedReferences || []); const workflowList = workflowItems.length === 0 ? '<li>workflow diagnostics なし</li>' : workflowItems.map(function(line) { return '<li>' + escapeHtml(line) + '</li>'; }).join(''); const localList = localItems.length === 0 ? '<li>host step diagnostics なし</li>' : localItems.map(function(item) { return '<li><strong>' + escapeHtml(item.severity || 'info') + '</strong>: ' + escapeHtml(item.message) + '</li>'; }).join(''); return '<details class="step-draft-host"><summary>Host validation: ' + escapeHtml(local.status || 'unknown') + ' / workflow ' + (workflow.ok ? 'OK' : 'NG') + '</summary><div class="muted">target: ' + escapeHtml(workflow.filePath || '') + '</div><h4>Step draft</h4><ul class="issue-list">' + localList + '</ul><h4>Workflow-level</h4><ul class="issue-list">' + workflowList + '</ul></details>'; }
function renderStepDraftPanel(result) { const items = result.diagnostics.concat(result.impacts || []); const list = items.length === 0 ? '<div class="muted">この step draft に確定前の問題は見つかっていません。</div>' : '<ul class="issue-list">' + items.map(function(item) { return '<li><strong>' + escapeHtml(item.severity) + '</strong>: ' + escapeHtml(item.message) + '</li>'; }).join('') + '</ul>'; const dirty = isStepDraftDirty(); const applyDisabled = !dirty || result.status === 'error' ? ' disabled' : ''; const discardDisabled = !dirty ? ' disabled' : ''; return '<div class="card step-draft-check step-draft-' + escapeHtml(result.status) + '"><strong>確定前チェック: ' + escapeHtml(result.status) + '</strong>' + list + renderHostStepDraftValidation() + '<div class="step-draft-actions"><button class="secondary" data-action="validate-step-draft">Validate step</button><button data-action="apply-step-draft"' + applyDisabled + '>Apply changes</button><button class="secondary" data-action="discard-step-draft"' + discardDisabled + '>Discard</button><span class="muted">' + (dirty ? '未確定の変更があります。' : '未確定の変更はありません。') + '</span></div></div>'; }
const stepDraftOriginalRenderStepDetail = renderStepDetail;
renderStepDetail = function() { const original = model.steps[selectedStepIndex]; const draft = ensureStepDraft(); if (draft) model.steps[selectedStepIndex] = draft; stepDraftOriginalRenderStepDetail(); if (draft) model.steps[selectedStepIndex] = original; document.getElementById('content').insertAdjacentHTML('afterbegin', renderStepDraftPanel(validateStepDraftInWebview())); };
const stepDraftOriginalRenderStepsList = renderStepsList;
renderStepsList = function() { stepDraftOriginalRenderStepsList(); if (isStepDraftDirty()) { const card = document.querySelector('.step-card.selected'); if (card) card.insertAdjacentHTML('beforeend', '<span class="badge warning">未確定</span>'); } };
function mutateStepDraftFromEvent(target, value) { const step = ensureStepDraft(); if (!step) return false; latestStepDraftHostValidation = undefined; if (target.dataset.stepField) { const field = target.dataset.stepField; if (field === 'type') { const replacement = makeStep(value); replacement.id = step.id; replacement.title = step.title; replacement.prompt = step.prompt; replacement.resultKey = step.resultKey; replacement.includeState = Array.isArray(step.includeState) ? step.includeState.slice() : undefined; replacement.required = step.required; replacement.stateRequired = step.stateRequired; replacement.maxResultBytes = step.maxResultBytes; stepDraft = replacement; return true; } if (field === 'maxResultBytes') step[field] = value ? Number(value) : undefined; else if (['required', 'stateRequired', 'sendResult', 'completeOnSuccess'].includes(field)) step[field] = Boolean(value); else step[field] = value || undefined; return true; } if (target.dataset.commandField && step.type === 'command') { if (!step.action) step.action = { provider: 'vscode.executeCommand', args: [] }; const args = Array.isArray(step.action.args) ? step.action.args.slice() : []; if (target.dataset.commandField === 'provider') step.action.provider = value; if (target.dataset.commandField === 'commandId') step.action.args = [value].concat(args.slice(1)); if (target.dataset.commandField === 'extraArgs') { try { const extra = JSON.parse(value || '[]'); step.action.args = [args[0] || ''].concat(Array.isArray(extra) ? extra : [extra]); } catch (error) {} } return true; } if (target.dataset.resultField && (step.type === 'result' || step.type === 'agent')) { const result = ensureResult(step); const field = target.dataset.resultField; if (field === 'source') { const sinks = result.sinks; if (value === 'literal') step.result = { source: 'literal', text: result.text || '', sinks: sinks }; else if (value === 'agent') step.result = { source: 'agent', sinks: sinks }; else step.result = { source: 'state', stateKey: result.stateKey || '', sinks: sinks }; return true; } if (field === 'stateKey' && result.source === 'state') result.stateKey = value; if (field === 'text' && result.source === 'literal') result.text = value; if (field === 'path') result.sinks[0] = { type: 'file', path: value }; return true; } if (target.dataset.stateKey) { step.includeState = Array.isArray(step.includeState) ? step.includeState : []; if (target.checked && !step.includeState.includes(target.dataset.stateKey)) step.includeState.push(target.dataset.stateKey); if (!target.checked) step.includeState = step.includeState.filter(function(key) { return key !== target.dataset.stateKey; }); return true; } return false; }
handleFieldEvent = function(event) { const target = event.target; if (!target || !target.dataset) return; const value = target.type === 'checkbox' ? target.checked : target.value; if (activeTab === 'step' && mutateStepDraftFromEvent(target, value)) { renderStepsList(); renderTabs(); return; } stepDraftOriginalHandleFieldEvent(event); };
document.addEventListener('input', handleFieldEvent);
document.addEventListener('change', handleFieldEvent);
document.addEventListener('click', function(event) { const target = event.target.closest('[data-action], .tab'); if (!target) return; const action = target.dataset.action; const leaving = Boolean(target.dataset.tab && target.dataset.tab !== 'step') || ['select-step', 'add-step', 'delete-step', 'duplicate-step', 'move-step-up', 'move-step-down', 'apply-template'].includes(action); if (leaving && isStepDraftDirty()) { if (!confirm('未確定の Step 編集があります。破棄して移動しますか？')) { event.preventDefault(); event.stopImmediatePropagation(); return; } clearStepDraft(); } if (action === 'validate-step-draft') { event.preventDefault(); event.stopImmediatePropagation(); requestStepDraftHostValidation(); renderTabs(); return; } if (action === 'discard-step-draft') { event.preventDefault(); event.stopImmediatePropagation(); clearStepDraft(); renderTabs(); renderStepsList(); return; } if (action === 'apply-step-draft') { event.preventDefault(); event.stopImmediatePropagation(); const result = validateStepDraftInWebview(); if (result.status === 'error') { renderTabs(); return; } if (result.status === 'warning' && !confirm('warning があります。理解した上で確定しますか？')) return; model.steps[selectedStepIndex] = cloneStepDraft(stepDraft); clearStepDraft(); render(); return; } }, true);
window.addEventListener('message', function(event) { const message = event.data; if (message.type === 'model' || message.type === 'saved') clearStepDraft(); if (message.type === 'stepDraftValidationResult') { latestStepDraftHostValidation = message; if (activeTab === 'step') renderTabs(); } });
`
}
