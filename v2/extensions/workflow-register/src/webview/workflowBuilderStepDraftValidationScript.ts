export function renderWorkflowBuilderStepDraftValidationScript(): string {
  return String.raw`
function validateStepDraftInWebview() {
  const step = ensureStepDraft();
  const diagnostics = [];
  const impacts = [];
  function add(severity, message) {
    diagnostics.push({ severity: severity, message: message });
  }
  if (!step) {
    return {
      status: 'error',
      diagnostics: [{ severity: 'error', message: 'step が選択されていません。' }],
      impacts: []
    };
  }
  if (!String(step.id || '').trim()) {
    add('error', 'step id は必須です。');
  } else if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(step.id).trim())) {
    add('error', 'step id は英数字で始め、英数字・ドット・アンダースコア・ハイフンだけを使用してください。');
  }
  if (!String(step.title || '').trim()) add('error', 'step title は必須です。');
  if (!['agent', 'command', 'manual', 'result'].includes(step.type)) {
    add('error', '未対応の step type です: ' + step.type);
  }
  if (step.maxResultBytes !== undefined) {
    const maxResultBytes = Number(step.maxResultBytes);
    if (!Number.isFinite(maxResultBytes) || maxResultBytes <= 0) {
      add('error', 'maxResultBytes は正の数を指定してください。');
    }
  }
  if (step.stateRequired === true) {
    const hasStateKeys = Array.isArray(step.includeState) && step.includeState.length > 0;
    if (!hasStateKeys) add('error', 'stateRequired が true の場合は includeState を1件以上指定してください。');
  }
  if ((step.type === 'agent' || step.type === 'manual') && !String(step.prompt || '').trim()) {
    add('error', step.type + ' step では prompt が必須です。');
  }
  if (step.type === 'command') validateCommandStepDraft(step, add);
  if (step.type === 'result') validateResultStepDraft(step, add);
  validateStepDraftImpacts(step, impacts);

  const nextSteps = model.steps.map(function(candidate, index) {
    return index === selectedStepIndex ? step : candidate;
  });
  analyzeReferences(nextSteps).forEach(function(issue) {
    if (issue.stepIndex === selectedStepIndex || issue.stepId === step.id || issue.artifactId) {
      impacts.push({ severity: 'error', message: issue.message });
    }
  });

  const all = diagnostics.concat(impacts);
  const hasError = all.some(function(item) { return item.severity === 'error'; });
  const hasWarning = all.some(function(item) { return item.severity === 'warning'; });
  const status = hasError ? 'error' : hasWarning ? 'warning' : 'ok';
  return { status: status, diagnostics: diagnostics, impacts: impacts };
}

function validateCommandStepDraft(step, add) {
  const provider = step.action && step.action.provider;
  const args = step.action && Array.isArray(step.action.args) ? step.action.args : [];
  if (!String(provider || '').trim()) add('error', 'command step では action.provider が必須です。');
  if (provider === 'vscode.executeCommand' && !String(args[0] || '').trim()) {
    add('error', 'provider が vscode.executeCommand の場合は args[0] に command id が必要です。');
  }
  if (step.sendResult === true && !String(step.resultKey || '').trim()) {
    add('warning', 'sendResult が true ですが resultKey が未設定です。');
  }
  if (step.sendResult === true && step.maxResultBytes === undefined) {
    add('warning', 'sendResult が true の command step では maxResultBytes の指定を推奨します。');
  }
}

function validateResultStepDraft(step, add) {
  const result = step.result || {};
  if (result.source === 'state' && !String(result.stateKey || '').trim()) {
    add('error', 'result.source が state の場合は result.stateKey が必須です。');
  }
  if (result.source === 'literal' && !String(result.text || '').trim()) {
    add('error', 'result.source が literal の場合は literal text が必須です。');
  }
  const sinks = Array.isArray(result.sinks) ? result.sinks : [];
  if (sinks.length === 0) add('warning', 'result step に sink がありません。');
  sinks.forEach(function(sink, index) {
    if (!sink || sink.type === 'file') {
      if (!sink || !String(sink.path || '').trim()) add('error', 'file sink #' + (index + 1) + ' の path は必須です。');
      return;
    }
    if (sink.type === 'command' && !String(sink.command || '').trim()) {
      add('error', 'command sink #' + (index + 1) + ' の command は必須です。');
    }
  });
  if (result.source === 'state' && step.resultKey && result.stateKey === step.resultKey) {
    add('error', 'result.stateKey が同一 step の resultKey を参照しています。');
  }
}

function validateStepDraftImpacts(step, impacts) {
  const original = model.steps[selectedStepIndex];
  if (!original) return;
  if (original.type !== step.type) {
    impacts.push({
      severity: 'warning',
      message: 'step type を ' + original.type + ' から ' + step.type + ' へ変更します。'
    });
  }
  if (original.id && step.id && original.id !== step.id) {
    model.artifacts.forEach(function(artifact) {
      if (artifact.producedBy === original.id) {
        impacts.push({
          severity: 'error',
          message: "artifact '" + artifact.id + "' の producedBy が孤立します。"
        });
      }
    });
  }
  if (original.resultKey && original.resultKey !== step.resultKey) {
    model.steps.forEach(function(candidate, index) {
      const orphaned = index > selectedStepIndex && (candidate.includeState || []).includes(original.resultKey);
      if (orphaned) {
        impacts.push({
          severity: 'error',
          message: "step '" + candidate.id + "' の includeState が孤立します: " + original.resultKey
        });
      }
    });
  }
}
`
}
