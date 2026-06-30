export function renderWorkflowBuilderHelpScript(): string {
  return String.raw`
let activeHelpId = 'tab.step';
let helpSearchQuery = '';
const defaultHelpId = 'tab.step';
Object.assign(helpCatalog, {
  'template.select': { id: 'template.select', labelJa: 'テンプレート選択', fieldKey: 'template', summary: '新規 workflow の初期構成を選びます。', effect: '選択したテンプレートに応じて、inputs、steps、artifacts、guardrails などの初期値が変わります。', caution: 'テンプレートを反映すると現在の編集中モデルが置き換わるため、既存設定を残したい場合は保存前に Preview を確認してください。' },
  'steps.addAgent': { id: 'steps.addAgent', labelJa: 'AI step を追加', fieldKey: 'steps[].type = agent', summary: 'Bob / agent に prompt を渡して処理させる step を追加します。', effect: '分析、要約、レビュー、文章生成など、AI に判断や文章化をさせる処理に使います。' },
  'steps.addCommand': { id: 'steps.addCommand', labelJa: 'Command step を追加', fieldKey: 'steps[].type = command', summary: '拡張機能の action provider や VS Code command を実行する step を追加します。', effect: '差分収集、ファイル生成、検証、外部ツール連携など、AI ではなく拡張機能側で確実に行う処理に使います。' },
  'steps.addManual': { id: 'steps.addManual', labelJa: 'Manual step を追加', fieldKey: 'steps[].type = manual', summary: '人間の確認完了を待つ step を追加します。', effect: '承認、目視確認、手動作業の完了待ちを workflow に含められます。' },
  'steps.addResult': { id: 'steps.addResult', labelJa: 'Result step を追加', fieldKey: 'steps[].type = result', summary: '前段結果や固定テキストを成果物として保存する step を追加します。', effect: 'Bob の出力や command の結果を file sink などへ渡して、後で確認できる形にします。' },
  'section.includeState': { id: 'section.includeState', labelJa: 'includeState セクション', fieldKey: 'steps[].includeState', summary: '前段 step の resultKey を、選択中 step に渡すための設定です。', effect: 'チェックした resultKey の内容を、AI step や command step が入力・根拠として利用できるようになります。', caution: '選べる候補は現在の step より前にある resultKey のみです。順序を変えると参照エラーになる場合があります。' },
  'section.command': { id: 'section.command', labelJa: 'Command セクション', fieldKey: 'steps[].action', summary: 'command step で呼び出す provider と引数を設定します。', effect: 'Bob に考えさせるのではなく、拡張機能側で決定論的に実行する処理を定義します。', caution: '許可されていない provider は guardrails や action registry により実行できない場合があります。' },
  'section.result': { id: 'section.result', labelJa: 'Result セクション', fieldKey: 'steps[].result', summary: '書き出し元と保存先を設定します。', effect: 'state、literal、agent 出力を選び、file sink などへ保存できるようにします。' },
  'step.prompt': { id: 'step.prompt', labelJa: 'Prompt', fieldKey: 'steps[].prompt', summary: 'agent / manual step で Bob または人間に渡す指示文です。', effect: 'AI に何を分析・生成させるか、または人間に何を確認してほしいかを具体的に伝えます。', caution: '大きな仕様全文を貼るより、includeState や artifacts と組み合わせて根拠を限定する方が安定します。' }
});
function helpEntry(id) { return helpCatalog[id] || helpCatalog[defaultHelpId]; }
function selectedTemplateHelp(control) {
  if (!control || control.id !== 'templateSelect') return '';
  const template = templates.find(function(item) { return item.id === control.value; });
  if (!template) return '';
  return '<div class="help-option"><strong>選択中: ' + escapeHtml(template.label) + '</strong><p>' + escapeHtml(template.description) + '</p><p>このテンプレートを反映すると、初期 step 構成と関連設定が作成されます。</p></div>';
}
function stepById(id) { return (model.steps || []).find(function(step) { return step.id === id; }); }
function resultKeyProducer(key) { return (model.steps || []).find(function(step) { return step.resultKey === key; }); }
function dynamicChoiceHelp(id, control) {
  if (!control) return '';
  if (id === 'template.select') return selectedTemplateHelp(control);
  if ((id === 'artifact.producedBy') && control.value) {
    const step = stepById(control.value);
    if (!step) return '';
    return '<div class="help-option"><strong>選択中: ' + escapeHtml(step.id) + '</strong><p>' + escapeHtml(step.title || step.id) + ' / type: ' + escapeHtml(step.type) + '</p><p>この成果物は、この step が生成するものとして扱われます。</p></div>';
  }
  if (id === 'result.stateKey' || id === 'step.includeState') {
    const key = (control.dataset && control.dataset.stateKey) || control.value;
    if (!key) return '';
    const step = resultKeyProducer(key);
    if (!step) return '';
    return '<div class="help-option"><strong>選択中: ' + escapeHtml(key) + '</strong><p>生成元 step: ' + escapeHtml(step.id) + ' / ' + escapeHtml(step.title || step.id) + '</p><p>この前段結果を現在の step の入力または書き出し元として利用します。</p></div>';
  }
  return '';
}
function optionHelpHtml(entry, control) {
  const dynamic = dynamicChoiceHelp(entry && entry.id, control);
  if (dynamic) return dynamic;
  if (!entry || !entry.options || !control || control.tagName !== 'SELECT') return '';
  const option = entry.options[control.value];
  if (!option) return '';
  return '<div class="help-option"><strong>選択中: ' + escapeHtml(option.label) + '</strong><p>' + escapeHtml(option.summary) + '</p><p>' + escapeHtml(option.effect) + '</p>' + (option.caution ? '<p class="help-caution">注意: ' + escapeHtml(option.caution) + '</p>' : '') + '</div>';
}
function helpSearchText(id, entry) {
  const optionText = entry.options ? Object.keys(entry.options).map(function(key) {
    const option = entry.options[key];
    return [key, option.label, option.summary, option.effect, option.caution].filter(Boolean).join(' ');
  }).join(' ') : '';
  return [id, entry.labelJa, entry.fieldKey, entry.summary, entry.effect, entry.whenToUse, entry.caution, entry.example, optionText].filter(Boolean).join(' ').toLowerCase();
}
function searchHelpEntries(query) {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) return [];
  const words = normalized.split(/\s+/).filter(Boolean);
  return Object.keys(helpCatalog).filter(function(id) {
    const entry = helpCatalog[id];
    const text = helpSearchText(id, entry);
    return words.every(function(word) { return text.indexOf(word) >= 0; });
  }).slice(0, 12);
}
function helpTabForId(id) {
  if (!id) return undefined;
  if (id.indexOf('tab.') === 0) return id.slice(4);
  if (id.indexOf('meta.') === 0 || id.indexOf('template.') === 0 || id.indexOf('steps.add') === 0) return undefined;
  if (id.indexOf('step.') === 0 || id.indexOf('command.') === 0 || id.indexOf('result.') === 0 || id === 'section.command' || id === 'section.result' || id === 'section.includeState') return 'step';
  if (id.indexOf('input.') === 0) return 'inputs';
  if (id.indexOf('requires.') === 0) return 'requires';
  if (id.indexOf('preflight.') === 0) return 'preflight';
  if (id.indexOf('artifact.') === 0) return 'artifacts';
  if (id.indexOf('guardrails.') === 0 || id.indexOf('approval.') === 0) return 'guardrails';
  if (id.indexOf('completion.') === 0) return 'completion';
  if (id.indexOf('body.') === 0) return 'body';
  return undefined;
}
function helpSearchHtml() {
  const results = searchHelpEntries(helpSearchQuery);
  const value = escapeHtml(helpSearchQuery);
  const resultHtml = !helpSearchQuery.trim()
    ? '<div class="muted">例: resultKey / 承認 / 成果物 / Bob / stop / テンプレート</div>'
    : results.length === 0
      ? '<div class="muted">該当する項目がありません。</div>'
      : '<div class="help-search-results">' + results.map(function(id) {
          const entry = helpCatalog[id];
          const tab = helpTabForId(id);
          return '<button class="help-result" type="button" data-help-jump="' + escapeHtml(id) + '"><strong>' + escapeHtml(entry.labelJa) + '</strong><span>' + escapeHtml(entry.fieldKey) + '</span>' + (tab ? '<em>' + escapeHtml(tab) + '</em>' : '') + '</button>';
        }).join('') + '</div>';
  return '<div class="help-search"><label>ヘルプ検索</label><input data-help-search="true" value="' + value + '" placeholder="resultKey、承認、成果物、Bob など" />' + resultHtml + '</div>';
}
function renderHelpPanel(id, control) {
  activeHelpId = id || activeHelpId || defaultHelpId;
  const entry = helpEntry(activeHelpId);
  const panel = ensureHelpPanel();
  if (!entry || !panel) return;
  panel.innerHTML = helpSearchHtml() + '<h2>この項目の説明</h2>' +
    '<div class="help-title">' + escapeHtml(entry.labelJa) + '</div>' +
    '<div class="help-key">' + escapeHtml(entry.fieldKey) + '</div>' +
    '<p>' + escapeHtml(entry.summary) + '</p>' +
    '<h3>効果</h3><p>' + escapeHtml(entry.effect) + '</p>' +
    (entry.whenToUse ? '<h3>使う場面</h3><p>' + escapeHtml(entry.whenToUse) + '</p>' : '') +
    (entry.caution ? '<h3>注意</h3><p class="help-caution">' + escapeHtml(entry.caution) + '</p>' : '') +
    optionHelpHtml(entry, control) +
    (entry.example ? '<h3>YAML例</h3><pre>' + escapeHtml(entry.example) + '</pre>' : '') +
    (entry.related && entry.related.length ? '<h3>関連</h3><ul>' + entry.related.map(function(item) { return '<li>' + escapeHtml(item) + '</li>'; }).join('') + '</ul>' : '');
}
function ensureHelpPanel() {
  let panel = document.getElementById('workflowHelpPanel');
  if (panel) return panel;
  const main = document.querySelector('main');
  if (!main) return undefined;
  panel = document.createElement('aside');
  panel.id = 'workflowHelpPanel';
  panel.className = 'help-panel';
  panel.setAttribute('aria-live', 'polite');
  main.appendChild(panel);
  return panel;
}
function fieldIdForControl(control) {
  if (!control || !control.dataset) return undefined;
  if (control.id === 'templateSelect') return 'template.select';
  if (control.dataset.action === 'add-step' && control.dataset.stepType) return 'steps.add' + control.dataset.stepType.slice(0, 1).toUpperCase() + control.dataset.stepType.slice(1);
  if (control.dataset.sectionHelp) return control.dataset.sectionHelp;
  if (control.dataset.meta) return 'meta.' + control.dataset.meta;
  if (control.dataset.bodyField) return 'body.' + control.dataset.bodyField;
  if (control.dataset.stepField) return 'step.' + control.dataset.stepField;
  if (control.dataset.commandField) return 'command.' + control.dataset.commandField;
  if (control.dataset.resultField) return 'result.' + control.dataset.resultField;
  if (control.dataset.stateKey) return 'step.includeState';
  if (control.dataset.inputField) return 'input.' + control.dataset.inputField;
  if (control.dataset.requiresField) return 'requires.' + control.dataset.requiresField;
  if (control.dataset.preflightField) return 'preflight.' + control.dataset.preflightField;
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
  const text = String(heading.textContent || '').trim();
  if (text === 'includeState') return 'section.includeState';
  if (text === 'Command') return 'section.command';
  if (text === 'Result') return 'section.result';
  return undefined;
}
function decorateSectionHelp(scope) {
  scope.querySelectorAll('h3').forEach(function(heading) {
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
  scope.querySelectorAll('input, select, textarea, button[data-action="add-step"]').forEach(function(control) {
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
  const target = document.querySelector('[data-help-id="' + id + '"]:not(.help-button)') || document.querySelector('[data-section-help="' + id + '"]');
  if (target && typeof target.focus === 'function') target.focus();
  if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
      if (sibling.matches && sibling.matches('[data-help-id="' + helpId + '"]:not(.help-button)')) return sibling;
      const nested = sibling.querySelector && sibling.querySelector('[data-help-id="' + helpId + '"]:not(.help-button)');
      if (nested) return nested;
      if (sibling.tagName === 'LABEL' || sibling.tagName === 'H2' || sibling.tagName === 'H3') break;
      sibling = sibling.nextElementSibling;
    }
  }
  let previous = button.previousElementSibling;
  while (previous) {
    if (previous.matches && previous.matches('[data-help-id="' + helpId + '"]:not(.help-button)')) return previous;
    previous = previous.previousElementSibling;
  }
  return document.querySelector('[data-help-id="' + helpId + '"]:not(.help-button)');
}
function jumpToHelpEntry(id) {
  const tab = helpTabForId(id);
  if (tab && typeof activeTab !== 'undefined' && activeTab !== tab) {
    activeTab = tab;
    renderTabs();
    setTimeout(function() { decorateHelpTargets(document.getElementById('content')); focusHelpTarget(id); }, 0);
    return;
  }
  decorateHelpTargets(document);
  focusHelpTarget(id);
}
document.addEventListener('focusin', function(event) {
  const control = event.target && event.target.closest ? event.target.closest('[data-help-id]') : undefined;
  if (control) renderHelpPanel(control.dataset.helpId, control);
});
document.addEventListener('input', function(event) {
  const search = event.target && event.target.closest ? event.target.closest('[data-help-search]') : undefined;
  if (!search) return;
  helpSearchQuery = search.value;
  renderHelpPanel(activeHelpId);
  const nextSearch = document.querySelector('[data-help-search]');
  if (nextSearch) {
    nextSearch.focus();
    nextSearch.setSelectionRange(nextSearch.value.length, nextSearch.value.length);
  }
});
document.addEventListener('change', function(event) {
  const control = event.target && event.target.closest ? event.target.closest('[data-help-id]') : undefined;
  if (control) renderHelpPanel(control.dataset.helpId, control);
});
document.addEventListener('click', function(event) {
  const jump = event.target && event.target.closest ? event.target.closest('[data-help-jump]') : undefined;
  if (jump) {
    event.preventDefault();
    event.stopPropagation();
    jumpToHelpEntry(jump.dataset.helpJump);
    return;
  }
  const button = event.target && event.target.closest ? event.target.closest('[data-help-id]') : undefined;
  if (button && button.classList && button.classList.contains('help-button')) {
    event.preventDefault();
    event.stopPropagation();
    renderHelpPanel(button.dataset.helpId, controlForHelpButton(button));
    return;
  }
  const tab = event.target && event.target.closest ? event.target.closest('.tab') : undefined;
  if (tab && tab.dataset && tab.dataset.tab) setTimeout(function() { decorateHelpTargets(document.getElementById('content')); renderHelpPanel('tab.' + tab.dataset.tab); }, 0);
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
