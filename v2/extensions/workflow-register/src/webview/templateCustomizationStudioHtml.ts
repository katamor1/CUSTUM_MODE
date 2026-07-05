import { TemplateCustomizationStudioModel, TemplateLibraryEntry } from "../template/templateStudioModel"
import { renderTemplateCustomizationStudioClientScript } from "./templateCustomizationStudioClientScript"
import { renderTemplateCustomizationStudioStyles } from "./templateCustomizationStudioStyles"

export interface RenderTemplateCustomizationStudioHtmlOptions {
  cspSource: string
  nonce: string
  templates: TemplateLibraryEntry[]
  model: TemplateCustomizationStudioModel
  diagnostics?: string[]
}

export function renderTemplateCustomizationStudioHtml(options: RenderTemplateCustomizationStudioHtmlOptions): string {
  const selectedTemplate = options.templates.find((template) => template.templatePath === options.model.templatePath) ?? options.templates[0]
  const supportedLanguages = selectedTemplate?.supportedLanguages?.length ? selectedTemplate.supportedLanguages : [options.model.targetLanguage]
  const supportedVcs = selectedTemplate?.supportedVcs?.length ? selectedTemplate.supportedVcs : [options.model.vcsType]
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${options.cspSource} 'unsafe-inline'; script-src 'nonce-${options.nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bob Template Customization Studio</title>
<style>
${renderTemplateCustomizationStudioStyles()}
</style>
</head>
<body>
<header>
  <h1>Template Customization Studio</h1>
  <div class="muted">標準テンプレートを選び、許可された project profile / customization 項目だけを編集します。Bazaar では <code>bzr --no-aliases</code> を前提にします。</div>
</header>
<main>
<aside>
  <h2>Template Library</h2>
  <button class="secondary" data-action="refresh-library">再読み込み</button>
  <div id="templateList" class="template-list">
    ${renderTemplateList(options.templates, options.model.templatePath)}
  </div>
</aside>
<section>
  <div class="tabs">
    <button class="tab active" data-action="tab" data-tab="library">Template Library</button>
    <button class="tab" data-action="tab" data-tab="customize">Customize</button>
    <button class="tab" data-action="tab" data-tab="readiness">Readiness</button>
  </div>

  <div class="tab-panel active" data-panel="library">
    <h2>${escapeHtml(options.model.title)}</h2>
    <div class="panel">
      <div><strong>templateId</strong>: ${escapeHtml(options.model.templateId)}</div>
      <div><strong>templateVersion</strong>: ${escapeHtml(options.model.templateVersion)}</div>
      <div><strong>baseTemplateHash</strong>: ${escapeHtml(options.model.baseTemplateHash)}</div>
      <div class="muted">${escapeHtml(options.model.description)}</div>
    </div>
  </div>

  <div class="tab-panel" data-panel="customize">
    <input id="templatePath" type="hidden" value="${attribute(options.model.templatePath)}">
    <input id="templateId" type="hidden" value="${attribute(options.model.templateId)}">
    <input id="templateVersion" type="hidden" value="${attribute(options.model.templateVersion)}">
    <input id="baseTemplateHash" type="hidden" value="${attribute(options.model.baseTemplateHash)}">

    <h2>Project Profile</h2>
    <div class="row">
      <div><label for="projectId">projectId</label><input id="projectId" value="${attribute(options.model.projectId)}"></div>
      <div><label for="displayName">displayName</label><input id="displayName" value="${attribute(options.model.displayName)}"></div>
    </div>
    <div class="row">
      <div><label for="targetLanguage">targetLanguage</label>${renderSelect("targetLanguage", supportedLanguages, options.model.targetLanguage)}</div>
      <div><label for="vcsType">vcs.type</label>${renderSelect("vcsType", supportedVcs, options.model.vcsType)}</div>
    </div>
    <label for="vcsRoot">vcs.root</label><input id="vcsRoot" value="${attribute(options.model.vcsRoot)}">
    <div class="muted">Bazaar / bzr の profile は <code>vcs.noAliases: true</code> を保存し、操作は <code>bzr --no-aliases</code> を使います。</div>
    <label for="checklistPath">checklist path</label><input id="checklistPath" value="${attribute(options.model.checklistPath)}">
    <label for="artifactOutputRoot">phase artifact root</label><input id="artifactOutputRoot" value="${attribute(options.model.artifactOutputRoot)}">
    <label for="uatEvidencePath">UAT evidence path</label><input id="uatEvidencePath" value="${attribute(options.model.uatEvidencePath)}">

    <h2>Workflow Customization</h2>
    <div class="row">
      <div><label for="workflowName">workflowName</label><input id="workflowName" value="${attribute(options.model.workflowName)}"></div>
      <div><label for="workflowTitle">title</label><input id="workflowTitle" value="${attribute(options.model.title)}"></div>
    </div>
    <label for="workflowDescription">description</label><textarea id="workflowDescription">${escapeHtml(options.model.description)}</textarea>
    <h3>input defaults</h3>
    <div class="input-defaults">
      ${renderInputDefaults(options.model.inputDefaults)}
    </div>
    <label for="promptSupplement">prompt supplement</label><textarea id="promptSupplement">${escapeHtml(options.model.promptSupplement)}</textarea>
    <div class="row">
      <div><label for="humanGate">human gate</label><input id="humanGate" value="required" disabled></div>
      <div><label for="stepReviewPauseAfter">stepReview pauseAfter</label>${renderSelect("stepReviewPauseAfter", ["agentAndCommand", "everyStep", "none"], options.model.stepReviewPauseAfter)}</div>
    </div>
    <div class="action-row">
      <button data-action="validate-profile">profile を検証</button>
      <button data-action="validate-customization">customization を検証</button>
      <button data-action="preview-workflow">preview</button>
      <button data-action="show-workflow-diff" class="secondary">diff</button>
      <button data-action="generate-workflow">workflow を生成</button>
    </div>
  </div>

  <div class="tab-panel" data-panel="readiness">
    <h2>Readiness</h2>
    <div class="action-row">
      <button data-action="check-readiness">readiness check</button>
      <button data-action="open-readiness-report" class="secondary">report を開く</button>
    </div>
    <div id="readinessStatus" class="panel status">status: not checked</div>
    <div id="readinessScore" class="panel">score: -</div>
    <h3>checks</h3>
    <div id="readinessChecks" class="panel"></div>
    <h3>nextActions</h3>
    <div id="readinessNextActions" class="panel"></div>
    <pre id="readinessOutput"></pre>
  </div>

  <h2>Preview / Diagnostics</h2>
  <pre id="diagnosticsOutput">${escapeHtml((options.diagnostics ?? []).join("\n"))}</pre>
  <pre id="previewOutput"></pre>
</section>
</main>
<script nonce="${options.nonce}">
const initialTemplates = ${jsonForScript(options.templates)};
const initialModel = ${jsonForScript(options.model)};
${renderTemplateCustomizationStudioClientScript()}
</script>
</body>
</html>`
}

function renderTemplateList(templates: TemplateLibraryEntry[], selectedPath: string): string {
  if (templates.length === 0) return `<div class="muted">metadata.yaml が見つかりません。</div>`
  return templates.map((template) => {
    const selected = template.templatePath === selectedPath ? " selected" : ""
    return `<button class="template-item${selected}" data-action="load-template" data-template-path="${attribute(template.templatePath)}">
  <span class="template-title">${escapeHtml(template.displayName)}</span>
  <span class="muted">${escapeHtml(template.templateId)} / ${escapeHtml(template.templateVersion)}</span>
  <span>${renderBadges(template.supportedLanguages)}${renderBadges(template.supportedVcs)}</span>
</button>`
  }).join("")
}

function renderInputDefaults(inputDefaults: Record<string, string | number | boolean | null>): string {
  const entries = Object.entries(inputDefaults)
  if (entries.length === 0) return `<div class="muted">このテンプレートに既定値編集対象の input はありません。</div>`
  return entries.map(([key, value]) => renderInputDefault(key, value)).join("")
}

function renderInputDefault(key: string, value: string | number | boolean | null): string {
  const valueType = value === null ? "null" : typeof value
  const id = `input-default-${attribute(key)}`
  const data = `data-input-default="${attribute(key)}" data-input-default-type="${attribute(valueType)}"`
  if (typeof value === "boolean") {
    return `<div><label for="${id}">${escapeHtml(key)}</label><select id="${id}" ${data}><option value="true"${value ? " selected" : ""}>true</option><option value="false"${value ? "" : " selected"}>false</option></select></div>`
  }
  const inputType = typeof value === "number" ? ` type="number"` : ""
  return `<div><label for="${id}">${escapeHtml(key)}</label><input id="${id}"${inputType} ${data} value="${attribute(String(value ?? ""))}"></div>`
}

function renderSelect(id: string, values: string[], selected: string): string {
  return `<select id="${attribute(id)}">${values.map((value) => `<option value="${attribute(value)}"${value === selected ? " selected" : ""}>${escapeHtml(value)}</option>`).join("")}</select>`
}

function renderBadges(values: string[]): string {
  return values.map((value) => `<span class="badge">${escapeHtml(value)}</span>`).join("")
}

function attribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;")
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003C")
    .replace(/>/g, "\\u003E")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
}
