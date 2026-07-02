export function renderWorkflowBuilderStepDraftRepairScript(): string {
  return String.raw`
const stepDraftRepairOriginalPanel = renderStepDraftPanel;
function stepDraftRepairCanApply(result) {
  if (!isStepDraftDirty()) return false;
  if ((result.diagnostics || []).some(function(item) { return item.severity === 'error'; })) return false;
  const impactErrors = (result.impacts || []).filter(function(item) { return item.severity === 'error'; });
  return impactErrors.length > 0 && impactErrors.every(function(item) { return item.repairable === true || /producedBy|includeState|stateKey/.test(item.message || ''); });
}
function stepDraftRepairReferences() {
  const draft = ensureStepDraft();
  const original = model.steps[selectedStepIndex];
  const repaired = { artifacts: [], steps: [], resultSteps: [] };
  if (!draft || !original) return repaired;
  if (original.id && draft.id && original.id !== draft.id) {
    model.artifacts.forEach(function(artifact) {
      if (artifact.producedBy === original.id) {
        artifact.producedBy = draft.id;
        repaired.artifacts.push(artifact.id);
      }
    });
  }
  if (original.resultKey && draft.resultKey && original.resultKey !== draft.resultKey) {
    model.steps.forEach(function(candidate, index) {
      if (index <= selectedStepIndex) return;
      if (Array.isArray(candidate.includeState) && candidate.includeState.includes(original.resultKey)) {
        candidate.includeState = candidate.includeState.map(function(key) { return key === original.resultKey ? draft.resultKey : key; });
        repaired.steps.push(candidate.id);
      }
      if (candidate.type === 'result' && candidate.result && candidate.result.source === 'state' && candidate.result.stateKey === original.resultKey) {
        candidate.result.stateKey = draft.resultKey;
        repaired.resultSteps.push(candidate.id);
      }
    });
  }
  return repaired;
}
renderStepDraftPanel = function(result) {
  const html = stepDraftRepairOriginalPanel(result);
  const disabled = stepDraftRepairCanApply(result) ? '' : ' disabled';
  const repairButton = '<button data-action="apply-step-draft-with-reference-updates"' + disabled + '>Apply + update refs</button>';
  return html.replace('<button class="secondary" data-action="discard-step-draft"', repairButton + '<button class="secondary" data-action="discard-step-draft"');
};
document.addEventListener('click', function(event) {
  const target = event.target.closest('[data-action]');
  if (!target || target.dataset.action !== 'apply-step-draft-with-reference-updates') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const result = validateStepDraftInWebview();
  if (!stepDraftRepairCanApply(result)) { renderTabs(); return; }
  if (!confirm('参照も更新して Step を確定しますか？')) return;
  const repaired = stepDraftRepairReferences();
  model.steps[selectedStepIndex] = cloneStepDraft(stepDraft);
  clearStepDraft();
  latestDiagnostics = ['- step draft applied with reference updates', '- updated artifacts: ' + repaired.artifacts.join(', '), '- updated includeState steps: ' + repaired.steps.join(', '), '- updated result state steps: ' + repaired.resultSteps.join(', ')];
  render();
}, true);
`
}
