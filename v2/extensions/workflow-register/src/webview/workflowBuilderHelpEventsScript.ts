export function renderWorkflowBuilderHelpEventsScript(): string {
  return String.raw`
function jumpToHelpEntry(id) {
  const tab = helpTabForId(id);
  if (tab && typeof activeTab !== 'undefined' && activeTab !== tab) {
    activeTab = tab;
    renderTabs();
    setTimeout(function() {
      decorateHelpTargets(document.getElementById('content'));
      focusHelpTarget(id);
    }, 0);
    return;
  }
  decorateHelpTargets(document);
  focusHelpTarget(id);
}
document.addEventListener('focusin', function(event) {
  const control = event.target && event.target.closest
    ? event.target.closest('[data-help-id]')
    : undefined;
  if (control) renderHelpPanel(control.dataset.helpId, control);
});
document.addEventListener('input', function(event) {
  const search = event.target && event.target.closest
    ? event.target.closest('[data-help-search]')
    : undefined;
  if (search) {
    helpSearchQuery = search.value;
    renderHelpPanel(activeHelpId);
    const nextSearch = document.querySelector('[data-help-search]');
    if (nextSearch) {
      nextSearch.focus();
      nextSearch.setSelectionRange(nextSearch.value.length, nextSearch.value.length);
    }
    return;
  }
  const control = event.target && event.target.closest
    ? event.target.closest('[data-help-id]')
    : undefined;
  if (control) renderHelpPanel(control.dataset.helpId, control);
});
document.addEventListener('change', function(event) {
  const control = event.target && event.target.closest
    ? event.target.closest('[data-help-id]')
    : undefined;
  if (control) renderHelpPanel(control.dataset.helpId, control);
});
document.addEventListener('click', function(event) {
  const jump = event.target && event.target.closest
    ? event.target.closest('[data-help-jump]')
    : undefined;
  if (jump) {
    event.preventDefault();
    event.stopPropagation();
    jumpToHelpEntry(jump.dataset.helpJump);
    return;
  }
  const button = event.target && event.target.closest
    ? event.target.closest('[data-help-id]')
    : undefined;
  if (button && button.classList && button.classList.contains('help-button')) {
    event.preventDefault();
    event.stopPropagation();
    renderHelpPanel(button.dataset.helpId, controlForHelpButton(button));
    return;
  }
  const tab = event.target && event.target.closest
    ? event.target.closest('.tab')
    : undefined;
  if (tab && tab.dataset && tab.dataset.tab) {
    setTimeout(function() {
      decorateHelpTargets(document.getElementById('content'));
      renderHelpPanel('tab.' + tab.dataset.tab);
    }, 0);
  }
});
const helpObserver = new MutationObserver(function(mutations) {
  for (const mutation of mutations) {
    mutation.addedNodes.forEach(function(node) {
      if (node.nodeType === 1) decorateHelpTargets(node);
    });
  }
});
helpObserver.observe(document.body, { childList: true, subtree: true });
ensureHelpPanel();
decorateHelpTargets(document);
renderHelpPanel(helpForActiveTab());
`
}
