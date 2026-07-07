export function renderWorkflowBuilderStepRendererScript(): string {
  return String.raw`
function referenceSummaryHtml(index) {
  const issues = issuesForStep(index);
  if (issues.length === 0) return '<div class="card reference-ok"><strong>参照チェック OK</strong><div class="muted">この step の includeState / resultKey 参照は現在の順序では問題ありません。</div></div>';
  return '<div class="card reference-issue"><strong>参照チェック</strong><ul class="issue-list">' + issues.map(function(issue) { return '<li>' + escapeHtml(issue.message) + diagnosticLinkHtml(issue, 'この設定を確認') + '</li>'; }).join('') + '</ul></div>';
}
function stepTypeGuideHtml(type) {
  const guides = {
    agent: ['Prompt に Bob へ依頼する分析・生成内容を書く。', '前段結果が必要なら includeState を選ぶ。', '後続で使う出力なら resultKey を設定する。'],
    command: ['action.provider を選ぶ。', 'VS Code command ID / args[0] と extra args を指定する。', '結果を後続で使うなら resultKey と sendResult を設定する。', '成功時に自動で進めるなら completeOnSuccess を有効にする。'],
    manual: ['Prompt に人間へ確認してほしい内容を書く。', 'form か approval を使う場合は resultKey を設定する。', 'reject で戻す場合は Transition に goto と loop を設定する。'],
    result: ['source を選ぶ。', 'state の場合は stateKey を選ぶ。', 'literal の場合は literal text を入力する。', 'file / command sink を必要な数だけ設定する。', '必要なら Artifacts タブで producedBy にこの step を指定する。']
  };
  const items = guides[type] || guides.agent;
  return '<div class="card help-inline-guide" data-help-id="step.type"><strong>' + escapeHtml(type) + ' step の設定ガイド</strong><ol>' + items.map(function(item) { return '<li>' + escapeHtml(item) + '</li>'; }).join('') + '</ol></div>';
}
function optionLabel(value, description) { return value ? value + ' — ' + description : '(未選択)'; }
function stepOptionLabel(id) { if (!id) return '(未選択)'; const step = model.steps.find(function(candidate) { return candidate.id === id; }); if (!step) return id + ' — 存在しない step'; return id + ' — ' + (step.title || step.id) + ' / ' + step.type; }
function resultKeyOptionLabel(key) {
  if (!key) return '(未選択)';
  const step = model.steps.find(function(candidate) { return stepResultKeys(candidate).includes(key); });
  if (!step) return key;
  return key + ' — ' + (step.title || step.id) + ' / ' + step.type;
}
function ignoredFieldWarningsHtml(step) {
  const ignored = [];
  if (step.type === 'agent' && step.maxResultBytes !== undefined) ignored.push('maxResultBytes は agent step では parser に無視されます。');
  if (step.type === 'manual') {
    if (step.resultKey) ignored.push('manual step の top-level resultKey は無視されます。form.resultKey または approval.resultKey を使ってください。');
    if (step.sendResult !== undefined) ignored.push('sendResult は manual step では無視されます。');
    if (step.completeOnSuccess !== undefined) ignored.push('completeOnSuccess は manual step では無視されます。');
    if (step.maxResultBytes !== undefined) ignored.push('maxResultBytes は manual step では無視されます。');
  }
  if (step.type === 'result') {
    if (step.resultKey) ignored.push('result step の top-level resultKey は無視されます。');
    if (step.includeState && step.includeState.length > 0) ignored.push('includeState は result step では無視されます。result.source=state を使ってください。');
    if (step.maxResultBytes !== undefined) ignored.push('maxResultBytes は result step では無視されます。');
  }
  if (ignored.length === 0) return '';
  return '<div class="card reference-issue"><strong>この type では無視される field があります</strong><ul class="issue-list">' + ignored.map(function(item) { return '<li>' + escapeHtml(item) + '</li>'; }).join('') + '</ul></div>';
}
function commonResultSettingsHtml(step) {
  const resultKeyHtml = (step.type === 'command' || step.type === 'agent')
    ? '<div><label data-help-label="step.resultKey">resultKey</label><input data-help-id="step.resultKey" data-step-field="resultKey" value="' + escapeHtml(step.resultKey || '') + '" /></div>'
    : '<div><label data-help-label="step.resultKey">resultKey</label><div class="muted">この step type では top-level resultKey は使いません。</div></div>';
  const maxResultHtml = step.type === 'command'
    ? '<div><label data-help-label="step.maxResultBytes">maxResultBytes</label><input data-help-id="step.maxResultBytes" type="number" data-step-field="maxResultBytes" value="' + escapeHtml(step.maxResultBytes || '') + '" /></div>'
    : '<div><label data-help-label="step.maxResultBytes">maxResultBytes</label><div class="muted">command step の出力上限として使います。</div></div>';
  return '<div class="row">' + resultKeyHtml + maxResultHtml + '</div>';
}
function includeStateHtmlForStep(step, beforeKeys) {
  if (step.type === 'result') return '<div class="muted">result step では includeState ではなく Result の source=state / stateKey を使います。</div>';
  const includeState = Array.isArray(step.includeState) ? step.includeState : [];
  return beforeKeys.length === 0
    ? '<div class="muted">前段 step の resultKey がまだありません。</div>'
    : beforeKeys.map(function(key) { return '<label data-help-label="step.includeState"><input type="checkbox" style="width:auto" data-help-id="step.includeState" data-state-key="' + escapeHtml(key) + '" ' + (includeState.includes(key) ? 'checked' : '') + ' /> ' + escapeHtml(resultKeyOptionLabel(key)) + '</label>'; }).join('');
}
function renderStepDetail() {
  const content = document.getElementById('content');
  const step = selectedStep();
  if (!step) { content.innerHTML = '<h2>Step detail</h2><p class="muted">左のボタンから step を追加してください。</p>'; return; }
  const beforeKeys = resultKeysBefore(selectedStepIndex);
  const includeStateHtml = includeStateHtmlForStep(step, beforeKeys);
  let typeSpecific = '';
  if (step.type === 'command') typeSpecific = renderCommandStep(step);
  else if (step.type === 'result') typeSpecific = renderResultStep(step, beforeKeys);
  else if (step.type === 'manual') typeSpecific = renderManualStep(step);
  else typeSpecific = '<label data-help-label="step.prompt">prompt</label><textarea data-help-id="step.prompt" data-step-field="prompt">' + escapeHtml(step.prompt || '') + '</textarea>';
  content.innerHTML =
    '<h2>Step detail</h2>' +
    referenceSummaryHtml(selectedStepIndex) +
    ignoredFieldWarningsHtml(step) +
    stepTypeGuideHtml(step.type) +
    '<div class="row"><div><label data-help-label="step.id">id</label><input data-help-id="step.id" data-step-field="id" value="' + escapeHtml(step.id) + '" /></div><div><label data-help-label="step.type">type</label><select data-help-id="step.type" data-step-field="type">' + stepTypeOptions(step.type) + '</select></div></div>' +
    '<label data-help-label="step.title">title</label><input data-help-id="step.title" data-step-field="title" value="' + escapeHtml(step.title) + '" />' +
    '<div class="row"><label><input type="checkbox" style="width:auto" data-help-id="step.required" data-step-field="required" ' + (step.required ? 'checked' : '') + ' /> required</label><label><input type="checkbox" style="width:auto" data-help-id="step.stateRequired" data-step-field="stateRequired" ' + (step.stateRequired ? 'checked' : '') + ' /> stateRequired</label></div>' +
    commonResultSettingsHtml(step) +
    '<h3 data-section-help="section.includeState" data-help-id="section.includeState">includeState</h3>' + includeStateHtml +
    typeSpecific +
    renderUserActionStep(step) +
    renderTransitionStep(step) +
    '<h3>操作</h3><button class="secondary" data-action="move-step-up">上へ</button><button class="secondary" data-action="move-step-down">下へ</button><button class="secondary" data-action="duplicate-step">複製</button><button class="danger" data-action="delete-step">削除</button>';
}
function stepTypeOptions(current) { const labels = { agent: 'AI に分析・生成させる', command: '拡張機能の処理を実行', manual: '人間確認で停止', result: '前段結果を保存' }; return ['agent', 'command', 'manual', 'result'].map(function(type) { return '<option value="' + type + '" ' + (type === current ? 'selected' : '') + '>' + escapeHtml(optionLabel(type, labels[type])) + '</option>'; }).join(''); }
function ensureUserAction(step) { if (!step.userAction) step.userAction = {}; return step.userAction; }
function renderUserActionStep(step) {
  const userAction = step.userAction || {};
  return '<h3 data-section-help="section.userAction" data-help-id="section.userAction">User action</h3><label data-help-label="step.userAction.message">手動操作ページのメッセージ</label><textarea data-help-id="step.userAction.message" data-user-action-field="message">' + escapeHtml(userAction.message || '') + '</textarea><div class="row"><div><label data-help-label="step.userAction.completeLabel">完了ボタン文言</label><input data-help-id="step.userAction.completeLabel" data-user-action-field="completeLabel" value="' + escapeHtml(userAction.completeLabel || '') + '" /></div><label><input type="checkbox" style="width:auto" data-help-id="step.userAction.confirmOnComplete" data-user-action-field="confirmOnComplete" ' + (userAction.confirmOnComplete ? 'checked' : '') + ' /> 完了前に確認する</label></div><label data-help-label="step.userAction.confirmMessage">確認メッセージ</label><textarea data-help-id="step.userAction.confirmMessage" data-user-action-field="confirmMessage">' + escapeHtml(userAction.confirmMessage || '') + '</textarea>' + userActionPreviewHtml(step);
}
function userActionPreviewHtml(step) {
  const userAction = step.userAction || {};
  const message = userAction.message || step.prompt || ((step.title || step.id) + ' の操作が完了したら、完了ボタンを押してください。');
  const label = userAction.completeLabel || '完了';
  return '<div class="card"><strong>実行時の表示イメージ</strong><div class="message-preview">' + escapeHtml(message) + '</div><button type="button" disabled>' + escapeHtml(label) + '</button><div class="muted">{{inputs.xxx}} などは実行時に置換されます。</div></div>';
}
function renderCommandStep(step) {
  const args = Array.isArray(step.action && step.action.args) ? step.action.args : [];
  const commandId = typeof args[0] === 'string' ? args[0] : '';
  const extraArgs = args.slice(1);
  return '<h3 data-section-help="section.command" data-help-id="section.command">Command</h3><label data-help-label="command.provider">action.provider</label><input data-help-id="command.provider" data-command-field="provider" value="' + escapeHtml((step.action && step.action.provider) || 'vscode.executeCommand') + '" /><label data-help-label="command.commandId">VS Code command ID / args[0]</label><input data-help-id="command.commandId" data-command-field="commandId" value="' + escapeHtml(commandId) + '" /><label data-help-label="command.extraArgs">extra args JSON array</label><textarea data-help-id="command.extraArgs" data-command-field="extraArgs">' + escapeHtml(JSON.stringify(extraArgs, null, 2)) + '</textarea><label><input type="checkbox" style="width:auto" data-help-id="step.sendResult" data-step-field="sendResult" ' + (step.sendResult ? 'checked' : '') + ' /> sendResult</label><label><input type="checkbox" style="width:auto" data-help-id="step.completeOnSuccess" data-step-field="completeOnSuccess" ' + (step.completeOnSuccess ? 'checked' : '') + ' /> completeOnSuccess</label>';
}
function renderManualStep(step) {
  const form = step.form || {};
  const approval = step.approval || {};
  const fields = Array.isArray(form.fields) ? form.fields : [];
  return '<label data-help-label="step.prompt">prompt</label><textarea data-help-id="step.prompt" data-step-field="prompt">' + escapeHtml(step.prompt || '') + '</textarea>' +
    '<h3>Manual Form</h3><div class="card"><label>form.resultKey</label><input data-manual-form-field="resultKey" value="' + escapeHtml(form.resultKey || '') + '" /><label>form.fields JSON</label><textarea data-manual-form-field="fieldsJson">' + escapeHtml(JSON.stringify(fields, null, 2)) + '</textarea></div>' +
    '<h3>Manual Approval</h3><div class="card"><div class="row"><div><label>approval.resultKey</label><input data-manual-approval-field="resultKey" value="' + escapeHtml(approval.resultKey || '') + '" /></div><div><label>approveLabel</label><input data-manual-approval-field="approveLabel" value="' + escapeHtml(approval.approveLabel || '') + '" /></div></div><label>rejectLabel</label><input data-manual-approval-field="rejectLabel" value="' + escapeHtml(approval.rejectLabel || '') + '" /><label>message</label><textarea data-manual-approval-field="message">' + escapeHtml(approval.message || '') + '</textarea></div>';
}
function renderTransitionStep(step) {
  const transition = step.transition || {};
  const decisions = Array.isArray(transition.decisions) ? transition.decisions : [];
  return '<h3>Transition</h3><div class="card"><label>default</label><input data-transition-default="true" value="' + escapeHtml(transition.default || 'next') + '" /><label>decisions JSON</label><textarea data-transition-decisions-json="true">' + escapeHtml(JSON.stringify(decisions, null, 2)) + '</textarea><p class="muted">backward goto には branching loop が必要です。Preview / Diagnostics で検証してください。</p></div>';
}
function ensureResult(step) { if (!step.result) step.result = { source: 'state', stateKey: '', sinks: [{ type: 'file', path: '.bob/artifacts/result.md' }] }; if (!Array.isArray(step.result.sinks) || step.result.sinks.length === 0) step.result.sinks = [{ type: 'file', path: '.bob/artifacts/result.md' }]; return step.result; }
function renderResultStep(step, beforeKeys) {
  const result = ensureResult(step);
  const stateKeyOptions = [''].concat(beforeKeys).map(function(key) { return '<option value="' + escapeHtml(key) + '" ' + (key === result.stateKey ? 'selected' : '') + '>' + escapeHtml(resultKeyOptionLabel(key)) + '</option>'; }).join('');
  return '<h3 data-section-help="section.result" data-help-id="section.result">Result</h3><label data-help-label="result.source">source</label><select data-help-id="result.source" data-result-field="source"><option value="state" ' + (result.source === 'state' ? 'selected' : '') + '>state — 前段 resultKey を保存</option><option value="literal" ' + (result.source === 'literal' ? 'selected' : '') + '>literal — 固定テキストを保存</option><option value="agent" ' + (result.source === 'agent' ? 'selected' : '') + '>agent — agent 出力を保存</option></select><label data-help-label="result.stateKey">stateKey</label><select data-help-id="result.stateKey" data-result-field="stateKey">' + stateKeyOptions + '</select><label data-help-label="result.text">literal text</label><textarea data-help-id="result.text" data-result-field="text">' + escapeHtml(result.text || '') + '</textarea><h3 data-section-help="section.resultSinks" data-help-id="section.resultSinks">Result sinks</h3><button class="secondary" data-action="add-result-sink">+ sink</button>' + result.sinks.map(renderResultSink).join('');
}
function renderResultSink(sink, index) {
  const type = sink.type === 'command' ? 'command' : 'file';
  const typeSelect = '<label data-help-label="result.sink.type">sink type</label><select data-help-id="result.sink.type" data-result-sink-index="' + index + '" data-result-sink-field="type"><option value="file" ' + (type === 'file' ? 'selected' : '') + '>file</option><option value="command" ' + (type === 'command' ? 'selected' : '') + '>command</option></select>';
  const body = type === 'command'
    ? '<label data-help-label="result.sink.command">command</label><input data-help-id="result.sink.command" data-result-sink-index="' + index + '" data-result-sink-field="command" value="' + escapeHtml(sink.command || '') + '" /><label data-help-label="result.sink.args">args JSON array</label><textarea data-help-id="result.sink.args" data-result-sink-index="' + index + '" data-result-sink-field="argsJson">' + escapeHtml(JSON.stringify(sink.args || [], null, 2)) + '</textarea>'
    : '<label data-help-label="result.sink.path">path</label><input data-help-id="result.sink.path" data-result-sink-index="' + index + '" data-result-sink-field="path" value="' + escapeHtml(sink.path || '') + '" /><label data-help-label="result.sink.encoding">encoding</label><input data-help-id="result.sink.encoding" data-result-sink-index="' + index + '" data-result-sink-field="encoding" value="' + escapeHtml(sink.encoding || '') + '" />';
  return '<div class="card"><div class="row"><div>' + typeSelect + '</div><div><button class="danger" data-action="delete-result-sink" data-index="' + index + '">削除</button></div></div>' + body + '</div>';
}
`
}
