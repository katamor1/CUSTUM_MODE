import * as vscode from "vscode"
import { applyTraceabilityPrepAction, buildTraceabilityPrepModel, type TraceabilityPrepAction, type TraceabilityPrepModel } from "../core/traceabilityPrepController"
import { readTraceabilityCatalog, validateAndWriteTraceabilityGateReport, writeTraceabilityCatalog } from "../core/traceabilityCatalogStore"
import type { TraceabilityCatalog } from "../core/traceabilityCatalog"

export interface OpenTraceabilityPrepWebviewOptions {
  context: vscode.ExtensionContext
  workspaceRoot: string
  catalogPath: string
  reportPath: string
  textEncoding?: string
}

type TraceabilityPrepWebviewMessage =
  | { type: "ready" }
  | { type: "action"; action: TraceabilityPrepAction }
  | { type: "save" }

export async function openTraceabilityPrepWebview(options: OpenTraceabilityPrepWebviewOptions): Promise<{ status: "ok"; catalogPath: string } | { status: "error"; errors: string[] }> {
  const read = await readTraceabilityCatalog({ workspaceRoot: options.workspaceRoot, catalogPath: options.catalogPath, textEncoding: options.textEncoding })
  if (read.status === "error") return read

  let catalog: TraceabilityCatalog = read.catalog
  const panel = vscode.window.createWebviewPanel("bobCodeConsistencyTraceabilityPrep", "Traceability Prep", vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true
  })
  panel.webview.html = renderTraceabilityPrepHtml(panel.webview.cspSource, buildTraceabilityPrepModel(catalog), getNonce())
  panel.webview.onDidReceiveMessage(async (message: TraceabilityPrepWebviewMessage) => {
    if (message.type === "ready") {
      await panel.webview.postMessage({ type: "model", model: buildTraceabilityPrepModel(catalog) })
      return
    }
    if (message.type === "action") {
      const result = applyTraceabilityPrepAction(catalog, message.action)
      catalog = result.catalog
      await panel.webview.postMessage({ type: "model", model: result.model })
      if (result.status === "error") await panel.webview.postMessage({ type: "error", message: result.message })
      return
    }
    if (message.type === "save") {
      const write = await writeTraceabilityCatalog({ workspaceRoot: options.workspaceRoot, catalogPath: options.catalogPath, catalog, backupExisting: true })
      if (write.status === "error") {
        await panel.webview.postMessage({ type: "error", message: write.errors.join("; ") })
        return
      }
      const gate = await validateAndWriteTraceabilityGateReport({ workspaceRoot: options.workspaceRoot, catalogPath: options.catalogPath, reportPath: options.reportPath, textEncoding: options.textEncoding })
      await panel.webview.postMessage({ type: "saved", catalogPath: write.catalogPath, backupPath: write.backupPath, reportPath: gate.status === "ok" ? gate.reportPath : undefined })
    }
  }, undefined, options.context.subscriptions)

  return { status: "ok", catalogPath: read.catalogPath }
}

function renderTraceabilityPrepHtml(cspSource: string, model: TraceabilityPrepModel, nonce: string): string {
  const initialJson = JSON.stringify(model).replace(/</g, "\\u003c")
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Traceability Prep</title>
<style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;padding:16px}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--vscode-panel-border);padding-bottom:10px}
h1{font-size:20px;margin:0}.summary{display:flex;gap:8px;flex-wrap:wrap}.pill{border:1px solid var(--vscode-panel-border);padding:4px 8px;border-radius:6px}
button{padding:6px 10px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;cursor:pointer}button.secondary{color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground)}
select{padding:6px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border)}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--vscode-panel-border);margin:14px 0}.tab{padding:8px 10px;cursor:pointer}.tab.active{background:var(--vscode-tab-activeBackground);border-bottom:2px solid var(--vscode-focusBorder)}
.toolbar{display:flex;gap:8px;margin-bottom:10px}.table{display:grid;gap:6px}.row{border:1px solid var(--vscode-panel-border);border-radius:6px;padding:8px;background:var(--vscode-sideBar-background)}.rowHead{display:flex;align-items:center;justify-content:space-between;gap:8px}.meta{color:var(--vscode-descriptionForeground);font-size:12px}.actions{display:flex;gap:6px;flex-wrap:wrap}.error{color:var(--vscode-errorForeground)}.warning{color:var(--vscode-editorWarning-foreground)}pre{white-space:pre-wrap;background:var(--vscode-textCodeBlock-background);padding:10px}
</style></head><body>
<header><div><h1>Traceability Prep</h1><div class="meta">sidecar catalog approval</div></div><button id="save">Save</button></header>
<div class="summary" id="summary"></div>
<div class="tabs">
<div class="tab active" data-tab="domains">Domains</div><div class="tab" data-tab="items">Items</div><div class="tab" data-tab="links">Links</div><div class="tab" data-tab="decisions">Decisions</div><div class="tab" data-tab="gate">Gate Report</div><div class="tab" data-tab="preview">Review Input Preview</div>
</div>
<section id="content"></section><div id="status" class="meta"></div>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi();let model=${initialJson};let activeTab='domains';let typeFilter='all';
const content=document.getElementById('content');const status=document.getElementById('status');
document.getElementById('save').onclick=()=>vscode.postMessage({type:'save'});
document.querySelectorAll('.tab').forEach(tab=>tab.onclick=()=>{document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));tab.classList.add('active');activeTab=tab.dataset.tab;render()});
window.addEventListener('message',(event)=>{const m=event.data;if(m.type==='model'){model=m.model;render()}else if(m.type==='saved'){status.textContent='Saved: '+m.catalogPath+(m.backupPath?' / backup: '+m.backupPath:'')+(m.reportPath?' / report: '+m.reportPath:'')}else if(m.type==='error'){status.textContent=m.message;status.className='error'}});
function send(action){vscode.postMessage({type:'action',action})}
function approveItem(id){send({type:'approveItem',proposed_id:id})}
function rejectItem(id){send({type:'rejectItem',proposed_id:id})}
function deprecateItem(id){send({type:'deprecateItem',id})}
function approveLink(from,to,linkType){send({type:'approveLink',proposed_from:from,proposed_to:to,link_type:linkType})}
function rejectLink(from,to,linkType){send({type:'rejectLink',proposed_from:from,proposed_to:to,link_type:linkType})}
function approveDecision(subject,gate){send({type:'approveDecision',subject,gate})}
function rejectDecision(subject,gate){send({type:'rejectDecision',subject,gate})}
function approveDomain(code){send({type:'approveDomain',code})}function rejectDomain(code){send({type:'rejectDomain',code})}
function render(){renderSummary();if(activeTab==='domains')renderDomains();else if(activeTab==='items')renderItems();else if(activeTab==='links')renderLinks();else if(activeTab==='decisions')renderDecisions();else if(activeTab==='gate')renderGate();else renderPreview()}
function renderSummary(){document.getElementById('summary').innerHTML=['status: '+model.report.status,'errors: '+model.report.errors.length,'warnings: '+model.report.warnings.length,'proposed items: '+model.counts.proposedItems].map(x=>'<span class="pill">'+escapeHtml(x)+'</span>').join('')}
function renderDomains(){content.innerHTML='<div class="table">'+model.catalog.domains.map(d=>row(d.code,d.status,escapeHtml(d.label||''),d.status==='proposed'?'<button onclick="approveDomain(\\''+esc(d.code)+'\\')">Approve</button><button class="secondary" onclick="rejectDomain(\\''+esc(d.code)+'\\')">Reject</button>':'')).join('')+'</div>'}
function renderItems(){const types=['all','requirement','basic_design','detailed_design','test_spec','qa_item','review_finding'];const selector='<div class="toolbar"><select onchange="typeFilter=this.value;renderItems()">'+types.map(t=>'<option '+(t===typeFilter?'selected':'')+' value="'+t+'">'+t+'</option>').join('')+'</select></div>';const items=model.catalog.items.filter(i=>typeFilter==='all'||i.type===typeFilter);content.innerHTML=selector+'<div class="table">'+items.map(i=>{const id=i.id||i.proposed_id||'';let actions='';if(i.status==='proposed')actions='<button onclick="approveItem(\\''+esc(i.proposed_id)+'\\')">Approve</button><button class="secondary" onclick="rejectItem(\\''+esc(i.proposed_id)+'\\')">Reject</button>';else if(i.status==='accepted')actions='<button class="secondary" onclick="deprecateItem(\\''+esc(i.id)+'\\')">Deprecate</button>';return row(id,i.status,escapeHtml(i.type+' / '+i.source_document_id+' / '+i.domain+' / '+(i.text_summary||'')),actions)}).join('')+'</div>'}
function renderLinks(){content.innerHTML='<div class="table">'+(model.catalog.links||[]).map(l=>{const from=l.from||l.proposed_from||'';const to=l.to||l.proposed_to||'';const actions=l.status==='proposed'?'<button onclick="approveLink(\\''+esc(l.proposed_from)+'\\',\\''+esc(l.proposed_to)+'\\',\\''+esc(l.link_type)+'\\')">Approve</button><button class="secondary" onclick="rejectLink(\\''+esc(l.proposed_from)+'\\',\\''+esc(l.proposed_to)+'\\',\\''+esc(l.link_type)+'\\')">Reject</button>':'';return row(from+' -> '+to,l.status,escapeHtml(l.link_type),actions)}).join('')+'</div>'}
function renderDecisions(){content.innerHTML='<div class="table">'+(model.catalog.decisions||[]).map(d=>{const actions=d.status==='proposed'?'<button onclick="approveDecision(\\''+esc(d.subject)+'\\',\\''+esc(d.gate)+'\\')">Approve</button><button class="secondary" onclick="rejectDecision(\\''+esc(d.subject)+'\\',\\''+esc(d.gate)+'\\')">Reject</button>':'';return row(d.subject,d.status,escapeHtml(d.gate+' / '+(d.reason||'')),actions)}).join('')+'</div>'}
function renderGate(){content.innerHTML='<h2>Gate Report</h2><h3>Errors</h3>'+issues(model.report.errors,'error')+'<h3>Warnings</h3>'+issues(model.report.warnings,'warning')}
function renderPreview(){const accepted=model.catalog.items.filter(i=>i.status==='accepted').map(i=>({id:i.id,type:i.type,path:i.source_path,document:i.source_document_id}));content.innerHTML='<h2>Review Input Preview</h2><pre>'+escapeHtml(JSON.stringify(accepted,null,2))+'</pre>'}
function issues(items,cls){return items.length?'<div class="table">'+items.map(i=>'<div class="row '+cls+'"><b>'+escapeHtml(i.code)+'</b><div>'+escapeHtml(i.message)+'</div><div class="meta">'+escapeHtml(i.subject||'')+'</div></div>').join('')+'</div>':'<div class="meta">none</div>'}
function row(title,state,body,actions){return '<div class="row"><div class="rowHead"><div><b>'+escapeHtml(title)+'</b><div class="meta">'+escapeHtml(state)+'</div></div><div class="actions">'+actions+'</div></div><div>'+body+'</div></div>'}
function escapeHtml(v){return String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}function esc(v){return String(v??'').replace(/\\\\/g,'\\\\\\\\').replace(/'/g,"\\\\'")}
render();vscode.postMessage({type:'ready'});
</script></body></html>`
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  let text = ""
  for (let index = 0; index < 32; index += 1) text += chars.charAt(Math.floor(Math.random() * chars.length))
  return text
}
