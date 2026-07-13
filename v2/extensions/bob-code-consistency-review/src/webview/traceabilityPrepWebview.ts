import * as vscode from "vscode"
import {
  applyTraceabilityPrepAction,
  buildTraceabilityPrepModel,
  type TraceabilityPrepAction,
  type TraceabilityPrepModel
} from "../core/traceabilityPrepController"
import {
  readTraceabilityCatalog,
  validateAndWriteTraceabilityGateReport,
  writeTraceabilityCatalog
} from "../core/traceabilityCatalogStore"
import type { TraceabilityCatalog } from "../core/traceabilityCatalog"
import {
  renderTraceabilityPrepClientScript,
  renderTraceabilityPrepStyles,
  serializeTraceabilityPrepInitialModel
} from "./traceabilityPrepWebviewAssets"

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
  | { type: "restoreOriginalCatalog" }

export async function openTraceabilityPrepWebview(
  options: OpenTraceabilityPrepWebviewOptions
): Promise<{ status: "ok"; catalogPath: string } | { status: "error"; errors: string[] }> {
  const read = await readTraceabilityCatalog({
    workspaceRoot: options.workspaceRoot,
    catalogPath: options.catalogPath,
    textEncoding: options.textEncoding
  })
  if (read.status === "error") return read

  const originalCatalog = cloneCatalog(read.catalog)
  let catalog: TraceabilityCatalog = cloneCatalog(read.catalog)
  let revision = read.revision
  let messageTail = Promise.resolve()
  const panel = vscode.window.createWebviewPanel(
    "bobCodeConsistencyTraceabilityPrep",
    "Traceability Prep",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true
    }
  )
  panel.webview.html = renderTraceabilityPrepHtml(
    panel.webview.cspSource,
    buildTraceabilityPrepModel(catalog),
    getNonce()
  )
  panel.webview.onDidReceiveMessage((message: TraceabilityPrepWebviewMessage) => {
    const handled = messageTail.then(async () => {
      // Webview は承認 UI だが保存主体ではないため、action 適用と catalog 書き込みは必ず extension host 側で行う。
      if (message.type === "ready") {
        await postTraceabilityPrepModel(panel, catalog)
        return
      }
      if (message.type === "action") {
        catalog = await handleTraceabilityPrepAction(panel, catalog, message.action, originalCatalog)
        return
      }
      if (message.type === "restoreOriginalCatalog") {
        catalog = cloneCatalog(originalCatalog)
        await postTraceabilityPrepModel(panel, catalog)
        await panel.webview.postMessage({ type: "info", message: "Opened catalog state restored. Save to write it to disk." })
        return
      }
      if (message.type === "save") {
        revision = await saveTraceabilityPrepCatalog(panel, options, catalog, revision)
      }
    })
    messageTail = handled.then(() => undefined, () => undefined)
    return handled
  }, undefined, options.context.subscriptions)

  return { status: "ok", catalogPath: read.catalogPath }
}

async function postTraceabilityPrepModel(
  panel: vscode.WebviewPanel,
  catalog: TraceabilityCatalog
): Promise<void> {
  await panel.webview.postMessage({
    type: "model",
    model: buildTraceabilityPrepModel(catalog)
  })
}

async function handleTraceabilityPrepAction(
  panel: vscode.WebviewPanel,
  catalog: TraceabilityCatalog,
  action: TraceabilityPrepAction,
  originalCatalog: TraceabilityCatalog
): Promise<TraceabilityCatalog> {
  const result = applyTraceabilityPrepAction(catalog, action, originalCatalog)
  await panel.webview.postMessage({ type: "model", model: result.model })
  if (result.status === "error") {
    await panel.webview.postMessage({ type: "error", message: result.message })
  }
  return result.catalog
}

async function saveTraceabilityPrepCatalog(
  panel: vscode.WebviewPanel,
  options: OpenTraceabilityPrepWebviewOptions,
  catalog: TraceabilityCatalog,
  expectedRevision: string | null
): Promise<string | null> {
  const write = await writeTraceabilityCatalog({
    workspaceRoot: options.workspaceRoot,
    catalogPath: options.catalogPath,
    catalog,
    backupExisting: true,
    expectedRevision
  })
  if (write.status === "error") {
    await panel.webview.postMessage({ type: "error", message: write.errors.join("; ") })
    return expectedRevision
  }
  const gate = await validateAndWriteTraceabilityGateReport({
    workspaceRoot: options.workspaceRoot,
    catalogPath: options.catalogPath,
    reportPath: options.reportPath,
    textEncoding: options.textEncoding,
    expectedRevision: write.revision
  })
  if (gate.status === "error") {
    await panel.webview.postMessage({ type: "error", message: gate.errors.join("; ") })
    return write.revision
  }
  await panel.webview.postMessage({
    type: "saved",
    catalogPath: write.catalogPath,
    backupPath: write.backupPath,
    reportPath: gate.reportPath
  })
  return write.revision
}

function renderTraceabilityPrepHtml(cspSource: string, model: TraceabilityPrepModel, nonce: string): string {
  const initialJson = serializeTraceabilityPrepInitialModel(model)
  const cspHeader = "Content-Security-Policy"
  const scriptPolicy = "script-src"
  const inlineStyle = "'unsafe-inline'"
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta
  http-equiv="${cspHeader}"
  content="default-src 'none'; style-src ${cspSource} ${inlineStyle}; ${scriptPolicy} 'nonce-${nonce}';"
>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Traceability Prep</title>
<style>
${renderTraceabilityPrepStyles()}
</style>
</head>
<body>
<header>
  <div>
    <h1>Traceability Prep</h1>
    <div class="meta">sidecar catalog approval</div>
  </div>
  <div class="headerActions">
    <button id="restore-original-catalog" class="secondary">Rollback to Original</button>
    <button id="save">Save</button>
  </div>
</header>
<div class="summary" id="summary"></div>
<div class="tabs">
  <div class="tab active" data-tab="domains">Domains</div>
  <div class="tab" data-tab="items">Items</div>
  <div class="tab" data-tab="links">Links</div>
  <div class="tab" data-tab="decisions">Decisions</div>
  <div class="tab" data-tab="gate">Gate Report</div>
  <div class="tab" data-tab="preview">Review Input Preview</div>
</div>
<section id="content"></section>
<div id="status" class="meta"></div>
<script nonce="${nonce}">
${renderTraceabilityPrepClientScript(initialJson)}
</script>
</body>
</html>`
}

function cloneCatalog(catalog: TraceabilityCatalog): TraceabilityCatalog {
  return JSON.parse(JSON.stringify(catalog)) as TraceabilityCatalog
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  let text = ""
  for (let index = 0; index < 32; index += 1) text += chars.charAt(Math.floor(Math.random() * chars.length))
  return text
}
