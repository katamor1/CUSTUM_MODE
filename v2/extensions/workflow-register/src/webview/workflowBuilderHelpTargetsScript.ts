export function renderWorkflowBuilderHelpTargetsScript(): string {
  return String.raw`
function fieldIdForControl(control) {
  if (!control || !control.dataset) return undefined;
  if (control.id === 'templateSelect') return 'template.select';
  if (control.dataset.action === 'add-step' && control.dataset.stepType) {
    const type = control.dataset.stepType;
    return 'steps.add' + type.slice(0, 1).toUpperCase() + type.slice(1);
  }
  if (control.dataset.sectionHelp) return control.dataset.sectionHelp;
  if (control.dataset.meta) return 'meta.' + control.dataset.meta;
  if (control.dataset.bodyField) return 'body.' + control.dataset.bodyField;
  if (control.dataset.stepField) return 'step.' + control.dataset.stepField;
  if (control.dataset.userActionField) return 'step.userAction.' + control.dataset.userActionField;
  if (control.dataset.commandField) return 'command.' + control.dataset.commandField;
  if (control.dataset.resultSinkField) return 'result.sink.' + control.dataset.resultSinkField;
  if (control.dataset.resultField) return 'result.' + control.dataset.resultField;
  if (control.dataset.stateKey) return 'step.includeState';
  if (control.dataset.inputField) return 'input.' + control.dataset.inputField;
  if (control.dataset.requiresField) return 'requires.' + control.dataset.requiresField;
  if (control.dataset.preflightField) return 'preflight.' + control.dataset.preflightField;
  if (control.dataset.branchingField) return 'branching.' + control.dataset.branchingField;
  if (control.dataset.branchLoopField) return 'branching.loop.' + control.dataset.branchLoopField;
  if (control.dataset.manualFormField) return 'manual.form.' + control.dataset.manualFormField;
  if (control.dataset.manualApprovalField) return 'manual.approval.' + control.dataset.manualApprovalField;
  if (control.dataset.transitionDefault) return 'transition.default';
  if (control.dataset.transitionDecisionsJson) return 'transition.decisions';
  if (control.dataset.artifactField) return 'artifact.' + control.dataset.artifactField;
  if (control.dataset.guardrailField) return 'guardrails.' + control.dataset.guardrailField;
  if (control.dataset.approvalField) return 'approval.' + control.dataset.approvalField;
  if (control.dataset.completionField) return 'completion.' + control.dataset.completionField;
  return undefined;
}
function labelForControl(control) {
  if (!control) return undefined;
  if (control.dataset && control.dataset.sectionHelp) return control;
  const wrapped = control.closest && control.closest('label');
  if (wrapped) return wrapped;
  let previous = control.previousElementSibling;
  while (previous && previous.nodeType === 1) {
    if (previous.tagName === 'LABEL') return previous;
    if (!previous.classList || !previous.classList.contains('muted')) break;
    previous = previous.previousElementSibling;
  }
  return undefined;
}
function sectionHelpIdForHeading(heading) {
  const text = String(heading.textContent || '').replace('?', '').trim();
  if (text === 'includeState') return 'section.includeState';
  if (text === 'Command') return 'section.command';
  if (text === 'Result') return 'section.result';
  if (text === 'Result sinks') return 'section.resultSinks';
  if (text === 'User action') return 'section.userAction';
  if (text === 'Manual Form') return 'section.manualForm';
  if (text === 'Manual Approval') return 'section.manualApproval';
  if (text === 'Transition') return 'section.transition';
  if (text === 'Checkpoint') return 'section.branchCheckpoint';
  return undefined;
}
function matchingElements(scope, selector) {
  const matches = [];
  if (scope && scope.nodeType === 1 && scope.matches && scope.matches(selector)) matches.push(scope);
  if (scope && scope.querySelectorAll) {
    scope.querySelectorAll(selector).forEach(function(item) {
      if (!matches.includes(item)) matches.push(item);
    });
  }
  return matches;
}
function decorateSectionHelp(scope) {
  matchingElements(scope, 'h3').forEach(function(heading) {
    if (heading.dataset.helpDecorated) return;
    const id = sectionHelpIdForHeading(heading);
    if (!id || !helpCatalog[id]) return;
    heading.dataset.sectionHelp = id;
    heading.dataset.helpId = id;
    heading.dataset.helpDecorated = 'true';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'help-button';
    button.textContent = '?';
    button.setAttribute('aria-label', helpCatalog[id].labelJa + ' の説明を表示');
    button.setAttribute('data-help-button', id);
    button.setAttribute('data-help-id', id);
    heading.appendChild(document.createTextNode(' '));
    heading.appendChild(button);
  });
}
function decorateHelpTargets(root) {
  const scope = root || document;
  decorateSectionHelp(scope);
  matchingElements(scope, 'input, select, textarea, button[data-action="add-step"]').forEach(function(control) {
    const id = fieldIdForControl(control);
    if (!id || !helpCatalog[id]) return;
    control.setAttribute('data-help-id', id);
    const label = labelForControl(control);
    if (!label || label.querySelector('[data-help-button="' + id + '"]')) return;
    const entry = helpCatalog[id];
    if (!label.querySelector('.field-key') && entry.fieldKey && control.tagName !== 'BUTTON') {
      const key = document.createElement('span');
      key.className = 'field-key';
      key.textContent = entry.fieldKey;
      label.appendChild(document.createTextNode(' '));
      label.appendChild(key);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'help-button';
    button.textContent = '?';
    button.setAttribute('aria-label', entry.labelJa + ' の説明を表示');
    button.setAttribute('data-help-button', id);
    button.setAttribute('data-help-id', id);
    if (control.tagName === 'BUTTON') {
      control.insertAdjacentElement('afterend', button);
    } else {
      label.appendChild(document.createTextNode(' '));
      label.appendChild(button);
    }
  });
}
function helpForActiveTab() {
  const tab = document.querySelector('.tab.active');
  if (!tab || !tab.dataset || !tab.dataset.tab) return defaultHelpId;
  return 'tab.' + tab.dataset.tab;
}
function focusHelpTarget(id) {
  const target = controlForHelpId(id);
  if (target && typeof target.focus === 'function') target.focus();
  if (target && typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  if (target) {
    renderHelpPanel(id, target);
    return true;
  }
  renderHelpPanel(id);
  return false;
}
function controlForHelpButton(button) {
  const helpId = button.dataset && button.dataset.helpId;
  if (!helpId) return undefined;
  const section = button.closest && button.closest('[data-section-help]');
  if (section) return section;
  const label = button.closest && button.closest('label');
  if (label) {
    const inside = label.querySelector('[data-help-id="' + helpId + '"]:not(.help-button)');
    if (inside) return inside;
    let sibling = label.nextElementSibling;
    while (sibling) {
      if (sibling.matches && sibling.matches('[data-help-id="' + helpId + '"]:not(.help-button)')) {
        return sibling;
      }
      const nested = sibling.querySelector &&
        sibling.querySelector('[data-help-id="' + helpId + '"]:not(.help-button)');
      if (nested) return nested;
      if (sibling.tagName === 'LABEL' || sibling.tagName === 'H2' || sibling.tagName === 'H3') break;
      sibling = sibling.nextElementSibling;
    }
  }
  let previous = button.previousElementSibling;
  while (previous) {
    if (previous.matches && previous.matches('[data-help-id="' + helpId + '"]:not(.help-button)')) {
      return previous;
    }
    previous = previous.previousElementSibling;
  }
  return document.querySelector('[data-help-id="' + helpId + '"]:not(.help-button)');
}
`
}
