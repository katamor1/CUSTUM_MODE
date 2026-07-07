import { renderWorkflowBuilderStepDraftValidationScript } from "./workflowBuilderStepDraftValidationScript"

export function renderWorkflowBuilderStepDraftScript(): string {
  return String.raw`
const stepDraftOriginalHandleFieldEvent = handleFieldEvent;
document.removeEventListener('input', handleFieldEvent);
document.removeEventListener('change', handleFieldEvent);
let stepDraftIndex = -1;
let stepDraft = undefined;
let stepDraftOriginalJson = '';
let latestStepDraftHostValidation = undefined;

function cloneStepDraft(value) {
  return JSON.parse(JSON.stringify(value));
}

function clearStepDraft() {
  stepDraftIndex = -1;
  stepDraft = undefined;
  stepDraftOriginalJson = '';
  latestStepDraftHostValidation = undefined;
}

function ensureStepDraft() {
  const step = model.steps[selectedStepIndex];
  if (!step) {
    clearStepDraft();
    return undefined;
  }
  if (stepDraftIndex !== selectedStepIndex || !stepDraft) {
    stepDraftIndex = selectedStepIndex;
    stepDraft = cloneStepDraft(step);
    stepDraftOriginalJson = JSON.stringify(stepDraft);
    latestStepDraftHostValidation = undefined;
  }
  return stepDraft;
}

function isStepDraftDirty() {
  return Boolean(stepDraft) && JSON.stringify(stepDraft) !== stepDraftOriginalJson;
}

function requestStepDraftHostValidation() {
  const step = ensureStepDraft();
  if (!step) return;
  vscode.postMessage({
    type: 'validateStepDraft',
    model: model,
    draftStep: cloneStepDraft(step),
    stepIndex: selectedStepIndex
  });
}

${renderWorkflowBuilderStepDraftValidationScript()}

function renderHostStepDraftValidation() {
  const host = latestStepDraftHostValidation;
  if (!host || host.stepIndex !== selectedStepIndex) {
    return [
      '<div class="muted">',
      'Host validation はまだ実行されていません。',
      'Validate step を押すと、保存時 validator 相当の workflow-level check を確認できます。',
      '</div>'
    ].join('');
  }
  const local = host.stepValidation || {};
  const workflow = host.workflowValidation || {};
  const workflowItems = Array.isArray(workflow.diagnostics) ? workflow.diagnostics : [];
  const localItems = (local.diagnostics || []).concat(local.affectedReferences || []);
  const workflowList = workflowItems.length === 0
    ? '<li>workflow diagnostics なし</li>'
    : workflowItems.map(function(line) {
      return '<li>' + escapeHtml(line) + '</li>';
    }).join('');
  const localList = localItems.length === 0
    ? '<li>host step diagnostics なし</li>'
    : localItems.map(function(item) {
      return [
        '<li><strong>',
        escapeHtml(item.severity || 'info'),
        '</strong>: ',
        escapeHtml(item.message),
        '</li>'
      ].join('');
    }).join('');
  return [
    '<details class="step-draft-host">',
    '<summary>Host validation: ',
    escapeHtml(local.status || 'unknown'),
    ' / workflow ',
    workflow.ok ? 'OK' : 'NG',
    '</summary>',
    '<div class="muted">target: ',
    escapeHtml(workflow.filePath || ''),
    '</div>',
    '<h4>Step draft</h4><ul class="issue-list">',
    localList,
    '</ul><h4>Workflow-level</h4><ul class="issue-list">',
    workflowList,
    '</ul></details>'
  ].join('');
}

function renderStepDraftPanel(result) {
  const items = result.diagnostics.concat(result.impacts || []);
  const list = items.length === 0
    ? '<div class="muted">この step draft に確定前の問題は見つかっていません。</div>'
    : '<ul class="issue-list">' + items.map(function(item) {
      return [
        '<li><strong>',
        escapeHtml(item.severity),
        '</strong>: ',
        escapeHtml(item.message),
        '</li>'
      ].join('');
    }).join('') + '</ul>';
  const dirty = isStepDraftDirty();
  const applyDisabled = !dirty || result.status === 'error' ? ' disabled' : '';
  const discardDisabled = !dirty ? ' disabled' : '';
  return [
    '<div class="card step-draft-check step-draft-',
    escapeHtml(result.status),
    '"><strong>確定前チェック: ',
    escapeHtml(result.status),
    '</strong>',
    list,
    renderHostStepDraftValidation(),
    '<div class="step-draft-actions">',
    '<button class="secondary" data-action="validate-step-draft">Validate step</button>',
    '<button data-action="apply-step-draft"',
    applyDisabled,
    '>Apply changes</button>',
    '<button class="secondary" data-action="discard-step-draft"',
    discardDisabled,
    '>Discard</button><span class="muted">',
    dirty ? '未確定の変更があります。' : '未確定の変更はありません。',
    '</span></div></div>'
  ].join('');
}

const stepDraftOriginalRenderStepDetail = renderStepDetail;
renderStepDetail = function() {
  const original = model.steps[selectedStepIndex];
  const draft = ensureStepDraft();
  if (draft) model.steps[selectedStepIndex] = draft;
  stepDraftOriginalRenderStepDetail();
  if (draft) model.steps[selectedStepIndex] = original;
  document
    .getElementById('content')
    .insertAdjacentHTML('afterbegin', renderStepDraftPanel(validateStepDraftInWebview()));
};

const stepDraftOriginalRenderStepsList = renderStepsList;
renderStepsList = function() {
  stepDraftOriginalRenderStepsList();
  if (!isStepDraftDirty()) return;
  const card = document.querySelector('.step-card.selected');
  if (card) card.insertAdjacentHTML('beforeend', '<span class="badge warning">未確定</span>');
};

function mutateStepDraftFromEvent(target, value) {
  const step = ensureStepDraft();
  if (!step) return false;
  latestStepDraftHostValidation = undefined;
  if (target.dataset.stepField) return mutateStepField(step, target.dataset.stepField, value);
  if (target.dataset.commandField && step.type === 'command') {
    return mutateCommandField(step, target.dataset.commandField, value);
  }
  if (target.dataset.resultField && (step.type === 'result' || step.type === 'agent')) {
    return mutateResultField(step, target.dataset.resultField, value);
  }
  if (target.dataset.resultSinkIndex && (step.type === 'result' || step.type === 'agent')) {
    return mutateResultSinkField(step, Number(target.dataset.resultSinkIndex), target.dataset.resultSinkField, value);
  }
  if (target.dataset.stateKey) return mutateStateKey(step, target);
  return false;
}

function mutateStepField(step, field, value) {
  if (field === 'type') {
    const replacement = makeStep(value);
    replacement.id = step.id;
    replacement.title = step.title;
    replacement.prompt = step.prompt;
    replacement.resultKey = step.resultKey;
    replacement.includeState = Array.isArray(step.includeState) ? step.includeState.slice() : undefined;
    replacement.required = step.required;
    replacement.stateRequired = step.stateRequired;
    replacement.maxResultBytes = step.maxResultBytes;
    stepDraft = replacement;
    return true;
  }
  if (field === 'maxResultBytes') {
    step[field] = value ? Number(value) : undefined;
  } else if (['required', 'stateRequired', 'sendResult', 'completeOnSuccess'].includes(field)) {
    step[field] = Boolean(value);
  } else {
    step[field] = value || undefined;
  }
  return true;
}

function mutateCommandField(step, field, value) {
  if (!step.action) step.action = { provider: 'vscode.executeCommand', args: [] };
  const args = Array.isArray(step.action.args) ? step.action.args.slice() : [];
  if (field === 'provider') step.action.provider = value;
  if (field === 'commandId') step.action.args = [value].concat(args.slice(1));
  if (field === 'extraArgs') {
    try {
      const extra = JSON.parse(value || '[]');
      step.action.args = [args[0] || ''].concat(Array.isArray(extra) ? extra : [extra]);
    } catch (error) {}
  }
  return true;
}

function mutateResultField(step, field, value) {
  const result = ensureResult(step);
  if (field === 'source') {
    const sinks = result.sinks;
    if (value === 'literal') step.result = { source: 'literal', text: result.text || '', sinks: sinks };
    else if (value === 'agent') step.result = { source: 'agent', sinks: sinks };
    else step.result = { source: 'state', stateKey: result.stateKey || '', sinks: sinks };
    return true;
  }
  if (field === 'stateKey' && result.source === 'state') result.stateKey = value;
  if (field === 'text' && result.source === 'literal') result.text = value;
  return true;
}

function mutateResultSinkField(step, index, field, value) {
  const result = ensureResult(step);
  const sink = result.sinks[index];
  if (!sink) return false;
  if (field === 'type') {
    result.sinks[index] = value === 'command'
      ? { type: 'command', command: '', args: [] }
      : { type: 'file', path: '' };
    return true;
  }
  if (field === 'argsJson') {
    try {
      const args = JSON.parse(value || '[]');
      sink.args = Array.isArray(args) ? args : [args];
      clearEditorDiagnostic('resultSinkArgs:' + step.id + ':' + index);
    } catch (error) {
      setEditorDiagnostic('resultSinkArgs:' + step.id + ':' + index, "Result sink args JSON parse error for step '" + step.id + "': " + error.message);
    }
    return true;
  }
  sink[field] = value || undefined;
  return true;
}

function mutateStateKey(step, target) {
  step.includeState = Array.isArray(step.includeState) ? step.includeState : [];
  if (target.checked && !step.includeState.includes(target.dataset.stateKey)) {
    step.includeState.push(target.dataset.stateKey);
  }
  if (!target.checked) {
    step.includeState = step.includeState.filter(function(key) {
      return key !== target.dataset.stateKey;
    });
  }
  return true;
}

handleFieldEvent = function(event) {
  const target = event.target;
  if (!target || !target.dataset) return;
  const value = target.type === 'checkbox' ? target.checked : target.value;
  if (activeTab === 'step' && mutateStepDraftFromEvent(target, value)) {
    renderStepsList();
    renderTabs();
    return;
  }
  stepDraftOriginalHandleFieldEvent(event);
};

document.addEventListener('input', handleFieldEvent);
document.addEventListener('change', handleFieldEvent);

document.addEventListener('click', function(event) {
  const target = event.target.closest('[data-action], .tab');
  if (!target) return;
  const action = target.dataset.action;
  if (action === 'add-result-sink') {
    event.preventDefault();
    event.stopImmediatePropagation();
    const step = ensureStepDraft();
    if (!step) return;
    const result = ensureResult(step);
    result.sinks.push({ type: 'file', path: '' });
    latestStepDraftHostValidation = undefined;
    renderTabs();
    return;
  }
  if (action === 'delete-result-sink') {
    event.preventDefault();
    event.stopImmediatePropagation();
    const step = ensureStepDraft();
    if (!step) return;
    const result = ensureResult(step);
    result.sinks.splice(Number(target.dataset.index), 1);
    if (result.sinks.length === 0) result.sinks.push({ type: 'file', path: '' });
    latestStepDraftHostValidation = undefined;
    renderTabs();
    return;
  }
  const leaving = Boolean(target.dataset.tab && target.dataset.tab !== 'step')
    || [
      'select-step',
      'add-step',
      'delete-step',
      'duplicate-step',
      'move-step-up',
      'move-step-down',
      'apply-template'
    ].includes(action);
  if (leaving && isStepDraftDirty()) {
    if (!confirm('未確定の Step 編集があります。破棄して移動しますか？')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    clearStepDraft();
  }
  if (action === 'validate-step-draft') {
    event.preventDefault();
    event.stopImmediatePropagation();
    requestStepDraftHostValidation();
    renderTabs();
    return;
  }
  if (action === 'discard-step-draft') {
    event.preventDefault();
    event.stopImmediatePropagation();
    clearStepDraft();
    renderTabs();
    renderStepsList();
    return;
  }
  if (action === 'apply-step-draft') {
    event.preventDefault();
    event.stopImmediatePropagation();
    const result = validateStepDraftInWebview();
    if (result.status === 'error') {
      renderTabs();
      return;
    }
    if (result.status === 'warning' && !confirm('warning があります。理解した上で確定しますか？')) return;
    model.steps[selectedStepIndex] = cloneStepDraft(stepDraft);
    clearStepDraft();
    render();
  }
}, true);

window.addEventListener('message', function(event) {
  const message = event.data;
  if (message.type === 'model' || message.type === 'saved') clearStepDraft();
  if (message.type === 'stepDraftValidationResult') {
    latestStepDraftHostValidation = message;
    if (activeTab === 'step') renderTabs();
  }
});
`
}
