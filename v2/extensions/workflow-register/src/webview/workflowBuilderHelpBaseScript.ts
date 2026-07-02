export function renderWorkflowBuilderHelpBaseScript(): string {
  return String.raw`
let activeHelpId = 'tab.step';
let helpSearchQuery = '';
const defaultHelpId = 'tab.step';
Object.assign(helpCatalog, {
  'template.select': {
    id: 'template.select',
    labelJa: 'テンプレート選択',
    fieldKey: 'template',
    summary: '新規 workflow の初期構成を選びます。',
    effect: '選択したテンプレートに応じて、inputs、steps、artifacts、guardrails などの初期値が変わります。',
    caution: 'テンプレートを反映すると現在の編集中モデルが置き換わるため、既存設定を残したい場合は保存前に Preview を確認してください。'
  },
  'steps.addAgent': {
    id: 'steps.addAgent',
    labelJa: 'AI step を追加',
    fieldKey: 'steps[].type = agent',
    summary: 'Bob / agent に prompt を渡して処理させる step を追加します。',
    effect: '分析、要約、レビュー、文章生成など、AI に判断や文章化をさせる処理に使います。'
  },
  'steps.addCommand': {
    id: 'steps.addCommand',
    labelJa: 'Command step を追加',
    fieldKey: 'steps[].type = command',
    summary: '拡張機能の action provider や VS Code command を実行する step を追加します。',
    effect: '差分収集、ファイル生成、検証、外部ツール連携など、AI ではなく拡張機能側で確実に行う処理に使います。'
  },
  'steps.addManual': {
    id: 'steps.addManual',
    labelJa: 'Manual step を追加',
    fieldKey: 'steps[].type = manual',
    summary: '人間の確認完了を待つ step を追加します。',
    effect: '承認、目視確認、手動作業の完了待ちを workflow に含められます。'
  },
  'steps.addResult': {
    id: 'steps.addResult',
    labelJa: 'Result step を追加',
    fieldKey: 'steps[].type = result',
    summary: '前段結果や固定テキストを成果物として保存する step を追加します。',
    effect: 'Bob の出力や command の結果を file sink などへ渡して、後で確認できる形にします。'
  },
  'section.includeState': {
    id: 'section.includeState',
    labelJa: 'includeState セクション',
    fieldKey: 'steps[].includeState',
    summary: '前段 step の resultKey を、選択中 step に渡すための設定です。',
    effect: 'チェックした resultKey の内容を、AI step や command step が入力・根拠として利用できるようになります。',
    caution: '選べる候補は現在の step より前にある resultKey のみです。順序を変えると参照エラーになる場合があります。'
  },
  'section.command': {
    id: 'section.command',
    labelJa: 'Command セクション',
    fieldKey: 'steps[].action',
    summary: 'command step で呼び出す provider と引数を設定します。',
    effect: 'Bob に考えさせるのではなく、拡張機能側で決定論的に実行する処理を定義します。',
    caution: '許可されていない provider は guardrails や action registry により実行できない場合があります。'
  },
  'section.result': {
    id: 'section.result',
    labelJa: 'Result セクション',
    fieldKey: 'steps[].result',
    summary: '書き出し元と保存先を設定します。',
    effect: 'state、literal、agent 出力を選び、file sink などへ保存できるようにします。'
  },
  'step.prompt': {
    id: 'step.prompt',
    labelJa: 'Prompt',
    fieldKey: 'steps[].prompt',
    summary: 'agent / manual step で Bob または人間に渡す指示文です。',
    effect: 'AI に何を分析・生成させるか、または人間に何を確認してほしいかを具体的に伝えます。',
    caution: '大きな仕様全文を貼るより、includeState や artifacts と組み合わせて根拠を限定する方が安定します。'
  }
});
function helpEntry(id) { return helpCatalog[id] || helpCatalog[defaultHelpId]; }
function selectedTemplateHelp(control) {
  if (!control || control.id !== 'templateSelect') return '';
  const template = templates.find(function(item) { return item.id === control.value; });
  if (!template) return '';
  return [
    '<div class="help-option"><strong>選択中: ',
    escapeHtml(template.label),
    '</strong><p>',
    escapeHtml(template.description),
    '</p><p>このテンプレートを反映すると、初期 step 構成と関連設定が作成されます。</p></div>'
  ].join('');
}
function stepById(id) { return (model.steps || []).find(function(step) { return step.id === id; }); }
function resultKeyProducer(key) {
  return (model.steps || []).find(function(step) { return step.resultKey === key; });
}
function dynamicChoiceHelp(id, control) {
  if (!control) return '';
  if (id === 'template.select') return selectedTemplateHelp(control);
  if ((id === 'artifact.producedBy') && control.value) {
    const step = stepById(control.value);
    if (!step) return '';
    return [
      '<div class="help-option"><strong>選択中: ',
      escapeHtml(step.id),
      '</strong><p>',
      escapeHtml(step.title || step.id),
      ' / type: ',
      escapeHtml(step.type),
      '</p><p>この成果物は、この step が生成するものとして扱われます。</p></div>'
    ].join('');
  }
  if (id === 'result.stateKey' || id === 'step.includeState') {
    const key = (control.dataset && control.dataset.stateKey) || control.value;
    if (!key) return '';
    const step = resultKeyProducer(key);
    if (!step) return '';
    return [
      '<div class="help-option"><strong>選択中: ',
      escapeHtml(key),
      '</strong><p>生成元 step: ',
      escapeHtml(step.id),
      ' / ',
      escapeHtml(step.title || step.id),
      '</p><p>この前段結果を現在の step の入力または書き出し元として利用します。</p></div>'
    ].join('');
  }
  return '';
}
function optionHelpHtml(entry, control) {
  const dynamic = dynamicChoiceHelp(entry && entry.id, control);
  if (dynamic) return dynamic;
  if (!entry || !entry.options || !control || control.tagName !== 'SELECT') return '';
  const option = entry.options[control.value];
  if (!option) return '';
  const caution = option.caution
    ? '<p class="help-caution">注意: ' + escapeHtml(option.caution) + '</p>'
    : '';
  return [
    '<div class="help-option"><strong>選択中: ',
    escapeHtml(option.label),
    '</strong><p>',
    escapeHtml(option.summary),
    '</p><p>',
    escapeHtml(option.effect),
    '</p>',
    caution,
    '</div>'
  ].join('');
}
function helpSearchText(id, entry) {
  const optionText = entry.options ? Object.keys(entry.options).map(function(key) {
    const option = entry.options[key];
    return [key, option.label, option.summary, option.effect, option.caution].filter(Boolean).join(' ');
  }).join(' ') : '';
  return [
    id,
    entry.labelJa,
    entry.fieldKey,
    entry.summary,
    entry.effect,
    entry.whenToUse,
    entry.caution,
    entry.example,
    optionText
  ].filter(Boolean).join(' ').toLowerCase();
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
function controlForHelpId(id) {
  if (!id) return undefined;
  return document.querySelector('[data-help-id="' + id + '"]:not(.help-button)') ||
    document.querySelector('[data-section-help="' + id + '"]');
}
function resolveHelpControl(id, control) {
  if (control && control.isConnected !== false) return control;
  return controlForHelpId(id) || control;
}
function helpTabForId(id) {
  if (!id) return undefined;
  if (id.indexOf('tab.') === 0) return id.slice(4);
  if (id.indexOf('meta.') === 0 || id.indexOf('template.') === 0 || id.indexOf('steps.add') === 0) {
    return undefined;
  }
  if (
    id.indexOf('step.') === 0 ||
    id.indexOf('command.') === 0 ||
    id.indexOf('result.') === 0 ||
    id === 'section.command' ||
    id === 'section.result' ||
    id === 'section.includeState'
  ) {
    return 'step';
  }
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
          return [
            '<button class="help-result" type="button" data-help-jump="',
            escapeHtml(id),
            '"><strong>',
            escapeHtml(entry.labelJa),
            '</strong><span>',
            escapeHtml(entry.fieldKey),
            '</span>',
            tab ? '<em>' + escapeHtml(tab) + '</em>' : '',
            '</button>'
          ].join('');
        }).join('') + '</div>';
  return [
    '<div class="help-search"><label>ヘルプ検索</label><input data-help-search="true" value="',
    value,
    '" placeholder="resultKey、承認、成果物、Bob など" />',
    resultHtml,
    '</div>'
  ].join('');
}
function renderHelpPanel(id, control) {
  activeHelpId = id || activeHelpId || defaultHelpId;
  const entry = helpEntry(activeHelpId);
  const activeControl = resolveHelpControl(activeHelpId, control);
  const panel = ensureHelpPanel();
  if (!entry || !panel) return;
  const relatedHtml = entry.related && entry.related.length
    ? '<h3>関連</h3><ul>' + entry.related.map(function(item) {
        return '<li>' + escapeHtml(item) + '</li>';
      }).join('') + '</ul>'
    : '';
  panel.innerHTML = [
    helpSearchHtml(),
    '<h2>この項目の説明</h2>',
    '<div class="help-title">' + escapeHtml(entry.labelJa) + '</div>',
    '<div class="help-key">' + escapeHtml(entry.fieldKey) + '</div>',
    '<p>' + escapeHtml(entry.summary) + '</p>',
    '<h3>効果</h3><p>' + escapeHtml(entry.effect) + '</p>',
    entry.whenToUse ? '<h3>使う場面</h3><p>' + escapeHtml(entry.whenToUse) + '</p>' : '',
    entry.caution ? '<h3>注意</h3><p class="help-caution">' + escapeHtml(entry.caution) + '</p>' : '',
    optionHelpHtml(entry, activeControl),
    entry.example ? '<h3>YAML例</h3><pre>' + escapeHtml(entry.example) + '</pre>' : '',
    relatedHtml
  ].join('');
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
`
}
