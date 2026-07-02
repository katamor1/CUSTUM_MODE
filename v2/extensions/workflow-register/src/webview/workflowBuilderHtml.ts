import { WorkflowAuthoringModel } from "../core/workflowAuthoringModel"
import { renderWorkflowBuilderBodyScript } from "./workflowBuilderBodyScript"
import { renderWorkflowBuilderClientScript } from "./workflowBuilderClientScript"
import { renderWorkflowBuilderGuidedHelpScript } from "./workflowBuilderGuidedHelpScript"
import { workflowBuilderHelpCatalog } from "./workflowBuilderHelpCatalog"
import { renderWorkflowBuilderHelpScript } from "./workflowBuilderHelpScript"
import { renderWorkflowBuilderStyles } from "./workflowBuilderStyles"

export interface WorkflowBuilderTemplateOption {
  id: string
  label: string
  description: string
}

export interface RenderWorkflowBuilderHtmlOptions {
  cspSource: string
  initialModel: WorkflowAuthoringModel
  isEditMode: boolean
  focusStepId?: string
  modeNote: string
  nonce: string
  templateOptions: WorkflowBuilderTemplateOption[]
}

export function renderWorkflowBuilderHtml(options: RenderWorkflowBuilderHtmlOptions): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${options.cspSource} 'unsafe-inline'; script-src 'nonce-${options.nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bob Workflow Builder</title>
<style>
${renderWorkflowBuilderStyles()}
</style>
</head>
<body>
<header><h1>Bob Workflow Builder</h1><div class="muted">${options.modeNote}</div></header>
<main>
<aside>
<h2>基本情報</h2>
<label>テンプレート</label><select id="templateSelect"></select><button class="secondary" data-action="apply-template">テンプレートを反映</button>
<label>workflow name</label><input id="workflowName" data-meta="name" /><div class="muted">英数字、ドット、アンダースコア、ハイフンを推奨。新規作成では保存先フォルダ名にも使います。</div>
<label>title</label><input id="workflowTitle" data-meta="title" />
<label>description</label><textarea id="workflowDescription" data-meta="description"></textarea>
<label><input id="workspaceRequired" type="checkbox" data-meta="workspaceRequired" style="width:auto" /> workspaceRequired</label>
<h2>Steps</h2>
<button data-action="add-step" data-step-type="agent">+ AI step</button><button data-action="add-step" data-step-type="command">+ Command</button><button data-action="add-step" data-step-type="manual">+ Manual</button><button data-action="add-step" data-step-type="result">+ Result</button>
<div id="stepsList"></div>
</aside>
<section>
<div class="tabs">
<div class="tab active" data-tab="step">Step detail</div><div class="tab" data-tab="inputs">Inputs</div><div class="tab" data-tab="requires">Requires</div><div class="tab" data-tab="preflight">Preflight</div><div class="tab" data-tab="artifacts">Artifacts</div><div class="tab" data-tab="guardrails">Guardrails</div><div class="tab" data-tab="completion">Completion</div><div class="tab" data-tab="body">Markdown Body</div><div class="tab" data-tab="preview">Preview / Diagnostics</div>
</div>
<div id="content"></div>
</section>
</main>
<script nonce="${options.nonce}">
const templates = ${JSON.stringify(options.templateOptions)};
const helpCatalog = ${JSON.stringify(workflowBuilderHelpCatalog)};
let model = ${JSON.stringify(options.initialModel)};
let editMode = ${JSON.stringify(options.isEditMode)};
let focusStepId = ${JSON.stringify(options.focusStepId ?? "")};
${renderWorkflowBuilderClientScript()}
if (focusStepId) {
  const focusIndex = model.steps.findIndex(function(step) { return step.id === focusStepId; });
  if (focusIndex >= 0) { selectedStepIndex = focusIndex; activeTab = 'step'; render(); }
  focusStepId = '';
}
${renderWorkflowBuilderGuidedHelpScript()}
${renderWorkflowBuilderBodyScript()}
${renderWorkflowBuilderHelpScript()}
window.workflowBuilderJumpToHelp = typeof jumpToHelpEntry === 'function' ? jumpToHelpEntry : undefined;
</script>
</body>
</html>`
}
