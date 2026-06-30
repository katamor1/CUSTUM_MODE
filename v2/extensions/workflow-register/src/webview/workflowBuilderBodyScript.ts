/**
 * Returns a small Webview-side script that adds Markdown body editing.
 *
 * The main client script still owns most Builder behavior. This helper extends
 * the tab renderer instead of duplicating the large Webview script, keeping the
 * Markdown body feature easy to review and, later, easy to fold into a larger
 * client-side module split.
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
// Keep the body editor isolated from the large generated client script. The
// override is intentionally narrow: only the body tab is handled here; every
// other tab delegates back to the original renderer.
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
