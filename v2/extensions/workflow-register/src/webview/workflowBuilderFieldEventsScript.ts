export function renderWorkflowBuilderFieldEventsScript(): string {
  return String.raw`
function ensureTransition(step) {
  if (!step.transition) step.transition = { decisions: [], default: 'next' };
  if (!Array.isArray(step.transition.decisions)) step.transition.decisions = [];
  if (!step.transition.default) step.transition.default = 'next';
  return step.transition;
}
function handleFieldEvent(event) {
  const target = event.target;
  if (!target || !target.dataset) return;
  const value = target.type === 'checkbox' ? target.checked : target.value;
  if (target.dataset.meta) { model.metadata[target.dataset.meta] = value; requestPreview(); return; }
  if (target.dataset.branchingField) {
    ensureArrays();
    if (target.dataset.branchingField === 'enabled') model.branching.enabled = value;
    requestPreview(); return;
  }
  if (target.dataset.branchLoopIndex) {
    ensureArrays();
    const loop = model.branching.loops[Number(target.dataset.branchLoopIndex)];
    if (!loop) return;
    const field = target.dataset.branchLoopField;
    if (field === 'maxIterations' || field === 'extensionSize') loop[field] = Math.max(1, Number(value) || 1);
    else if (field === 'checkpointTitle' || field === 'checkpointMessage') {
      if (!loop.checkpoint) loop.checkpoint = {};
      if (field === 'checkpointTitle') loop.checkpoint.title = value || undefined;
      else loop.checkpoint.message = value || undefined;
    } else {
      loop[field] = value || undefined;
    }
    requestPreview(); return;
  }
  const step = selectedStep();
  if (step && target.dataset.stepField) {
    const field = target.dataset.stepField;
    if (field === 'type') {
      const replacement = makeStep(value);
      replacement.id = step.id;
      replacement.title = step.title;
      replacement.prompt = step.prompt;
      replacement.includeState = step.includeState;
      replacement.transition = step.transition;
      replacement.userAction = step.userAction;
      model.steps[selectedStepIndex] = replacement;
      render();
      return;
    }
    if (field === 'maxResultBytes') step[field] = value ? Number(value) : undefined;
    else step[field] = value;
    renderStepsList(); renderTabs(); requestPreview(); return;
  }
  if (step && target.dataset.userActionField) {
    const field = target.dataset.userActionField;
    const userAction = ensureUserAction(step);
    if (field === 'confirmOnComplete') userAction.confirmOnComplete = value;
    else userAction[field] = value || undefined;
    Object.keys(userAction).forEach(function(key) {
      if (userAction[key] === undefined || userAction[key] === '') delete userAction[key];
    });
    if (Object.keys(userAction).length === 0) delete step.userAction;
    renderTabs(); requestPreview(); return;
  }
  if (step && target.dataset.manualFormField && step.type === 'manual') {
    if (!step.form) step.form = { resultKey: '', fields: [] };
    if (target.dataset.manualFormField === 'fieldsJson') {
      try {
        const fields = JSON.parse(value || '[]');
        if (Array.isArray(fields)) { step.form.fields = fields; clearEditorDiagnostic('manualFormFields:' + step.id); }
        else setEditorDiagnostic('manualFormFields:' + step.id, "Manual form fields JSON must be an array for step '" + step.id + "'.");
      } catch (error) { setEditorDiagnostic('manualFormFields:' + step.id, "Manual form fields JSON parse error for step '" + step.id + "': " + error.message); }
    } else {
      step.form[target.dataset.manualFormField] = value || undefined;
    }
    renderStepsList(); requestPreview(); return;
  }
  if (step && target.dataset.manualApprovalField && step.type === 'manual') {
    if (!step.approval) step.approval = { resultKey: '' };
    step.approval[target.dataset.manualApprovalField] = value || undefined;
    renderStepsList(); requestPreview(); return;
  }
  if (step && target.dataset.transitionDefault) {
    const transition = ensureTransition(step);
    transition.default = value || 'next';
    requestPreview(); return;
  }
  if (step && target.dataset.transitionDecisionsJson) {
    const transition = ensureTransition(step);
    try {
      const decisions = JSON.parse(value || '[]');
      if (Array.isArray(decisions)) { transition.decisions = decisions; clearEditorDiagnostic('transitionDecisions:' + step.id); }
      else setEditorDiagnostic('transitionDecisions:' + step.id, "Transition decisions JSON must be an array for step '" + step.id + "'.");
    } catch (error) { setEditorDiagnostic('transitionDecisions:' + step.id, "Transition decisions JSON parse error for step '" + step.id + "': " + error.message); }
    requestPreview(); return;
  }
  if (step && target.dataset.commandField && step.type === 'command') {
    if (!step.action) step.action = { provider: 'vscode.executeCommand', args: [] };
    const args = Array.isArray(step.action.args) ? step.action.args.slice() : [];
    if (target.dataset.commandField === 'provider') step.action.provider = value;
    if (target.dataset.commandField === 'commandId') step.action.args = [value].concat(args.slice(1));
    if (target.dataset.commandField === 'extraArgs') {
      try {
        const extra = JSON.parse(value || '[]');
        step.action.args = [args[0] || ''].concat(Array.isArray(extra) ? extra : [extra]);
        clearEditorDiagnostic('commandExtraArgs:' + step.id);
      } catch (error) { setEditorDiagnostic('commandExtraArgs:' + step.id, "Command extra args JSON parse error for step '" + step.id + "': " + error.message); }
    }
    requestPreview(); return;
  }
  if (step && target.dataset.resultField && (step.type === 'result' || step.type === 'agent')) {
    const result = ensureResult(step);
    const field = target.dataset.resultField;
    if (field === 'source') {
      const sinks = result.sinks;
      if (value === 'literal') step.result = { source: 'literal', text: result.text || '', sinks: sinks };
      else if (value === 'agent') step.result = { source: 'agent', sinks: sinks };
      else step.result = { source: 'state', stateKey: result.stateKey || '', sinks: sinks };
      render(); return;
    }
    if (field === 'stateKey' && result.source === 'state') result.stateKey = value;
    if (field === 'text' && result.source === 'literal') result.text = value;
    if (field === 'path') result.sinks[0] = { type: 'file', path: value };
    requestPreview(); return;
  }
  if (target.dataset.stateKey && step) {
    step.includeState = Array.isArray(step.includeState) ? step.includeState : [];
    if (target.checked && !step.includeState.includes(target.dataset.stateKey)) step.includeState.push(target.dataset.stateKey);
    if (!target.checked) step.includeState = step.includeState.filter(function(key) { return key !== target.dataset.stateKey; });
    renderStepsList(); renderTabs(); requestPreview(); return;
  }
  if (target.dataset.inputIndex) {
    const input = model.inputs[Number(target.dataset.inputIndex)];
    if (!input) return;
    const field = target.dataset.inputField;
    if (field === 'options') input.options = linesFromText(value);
    else if (field === 'required' || field === 'prompt') input[field] = value;
    else if (field === 'defaultJson') {
      if (!String(value || '').trim()) { delete input.default; clearEditorDiagnostic('inputDefault:' + input.id); }
      else {
        try { input.default = JSON.parse(value); clearEditorDiagnostic('inputDefault:' + input.id); }
        catch (error) { setEditorDiagnostic('inputDefault:' + input.id, "Input default JSON parse error for input '" + input.id + "': " + error.message); }
      }
    }
    else input[field] = value || undefined;
    requestPreview(); return;
  }
  if (target.dataset.requiresField) {
    if (!model.requires) model.requires = {};
    if (target.dataset.requiresField === 'workspace') model.requires.workspace = value;
    if (target.dataset.requiresField === 'bobMinVersion') model.requires.bob = value ? { minVersion: value } : undefined;
    if (target.dataset.requiresField === 'files') model.requires.files = linesFromText(value);
    requestPreview(); return;
  }
  if (target.dataset.preflightIndex) {
    const item = model.preflight[Number(target.dataset.preflightIndex)];
    if (!item) return;
    const field = target.dataset.preflightField;
    if (field === 'checks' || field === 'files') item[field] = linesFromText(value);
    else if (field === 'required') item.required = value;
    else item[field] = value || undefined;
    requestPreview(); return;
  }
  if (target.dataset.artifactIndex) {
    const artifact = model.artifacts[Number(target.dataset.artifactIndex)];
    if (!artifact) return;
    artifact[target.dataset.artifactField] = value || undefined;
    renderTabs(); requestPreview(); return;
  }
  if (target.dataset.guardrailField) {
    if (!model.guardrails) model.guardrails = {};
    model.guardrails[target.dataset.guardrailField] = linesFromText(value);
    requestPreview(); return;
  }
  if (target.dataset.approvalIndex) {
    if (!model.guardrails) model.guardrails = {};
    if (!Array.isArray(model.guardrails.requireApproval)) model.guardrails.requireApproval = [];
    const rule = model.guardrails.requireApproval[Number(target.dataset.approvalIndex)];
    if (!rule) return;
    rule[target.dataset.approvalField] = value || undefined;
    requestPreview(); return;
  }
  if (target.dataset.completionField) {
    if (!model.completion) model.completion = {};
    const field = target.dataset.completionField;
    if (field === 'visualizationType' || field === 'visualizationEnabled') {
      if (!model.completion.visualization) model.completion.visualization = {};
      if (field === 'visualizationType') model.completion.visualization.type = value || undefined;
      else model.completion.visualization.enabled = value;
    } else if (field === 'includeArtifacts' || field === 'validateResult') model.completion[field] = value;
    else model.completion[field] = value || undefined;
    requestPreview(); return;
  }
}
document.addEventListener('input', handleFieldEvent);
document.addEventListener('change', handleFieldEvent);
`
}
