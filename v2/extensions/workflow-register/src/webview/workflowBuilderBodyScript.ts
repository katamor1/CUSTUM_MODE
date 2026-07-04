/**
 * Markdown body editing を追加する小さな Webview-side script を返す。
 *
 * Builder の大半の挙動は main client script が所有する。この helper は tab renderer だけを拡張し、
 * Markdown body 機能を review しやすく、将来の client-side module 分割へ移しやすい範囲に閉じる。
 */
export function renderWorkflowBuilderBodyScript(): string {
  return String.raw`
function defaultMarkdownBody() {
  const title = (model.metadata && model.metadata.title) || titleFromId((model.metadata && model.metadata.name) || 'new-workflow');
  const description = (model.metadata && model.metadata.description) || 'Run workflow.';
  return '# ' + title + '\n\n## Goal\n\n' + description;
}
function currentMarkdownBody() {
  return typeof model.body === 'string' && model.body.length > 0 ? model.body : defaultMarkdownBody();
}
function renderMarkdownBody() {
  document.getElementById('content').innerHTML = '<h2>Markdown Body</h2><div class="card"><label>WORKFLOW.md body</label><textarea data-body-field="body" style="min-height:360px">' + escapeHtml(currentMarkdownBody()) + '</textarea><p class="muted">YAML front matter の後ろに出力される Markdown 本文です。既存 workflow では元の本文を保持し、新規 workflow では空欄の場合に title / description から自動生成します。</p></div>';
}
// body editor は大きな generated client script から隔離する。override は body tab だけに限定し、
// 他の tab は元の renderer へ委譲して Webview 側の副作用範囲を広げない。
const workflowBuilderRenderTabsBase = renderTabs;
renderTabs = function() {
  document.querySelectorAll('.tab').forEach(function(tab) { tab.classList.toggle('active', tab.dataset.tab === activeTab); });
  if (activeTab === 'body') renderMarkdownBody();
  else workflowBuilderRenderTabsBase();
};
function handleMarkdownBodyEvent(event) {
  const target = event.target;
  if (!target || !target.dataset || !target.dataset.bodyField) return;
  model.body = target.value;
  requestPreview();
}
document.addEventListener('input', handleMarkdownBodyEvent);
document.addEventListener('change', handleMarkdownBodyEvent);
`
}
