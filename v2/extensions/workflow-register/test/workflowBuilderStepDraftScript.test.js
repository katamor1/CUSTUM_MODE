const test = require("node:test")
const assert = require("node:assert/strict")

const { renderWorkflowBuilderStepDraftRepairScript } = require("../out/webview/workflowBuilderStepDraftRepairScript")
const { renderWorkflowBuilderStepDraftScript } = require("../out/webview/workflowBuilderStepDraftScript")
const { renderWorkflowBuilderHtml } = require("../out/webview/workflowBuilderHtml")
const { createAuthoringModelFromTemplate } = require("../out/core/workflowAuthoringDefaults")

test("step draft script exposes transaction controls and validation hooks", () => {
  const script = renderWorkflowBuilderStepDraftScript()

  assert.match(script, /ensureStepDraft/)
  assert.match(script, /validateStepDraftInWebview/)
  assert.match(script, /requestStepDraftHostValidation/)
  assert.match(script, /stepDraftValidationResult/)
  assert.match(script, /apply-step-draft/)
  assert.match(script, /discard-step-draft/)
  assert.match(script, /Host validation/)
  assert.match(script, /未確定の変更/)
})

test("step draft repair script exposes apply with reference updates", () => {
  const script = renderWorkflowBuilderStepDraftRepairScript()

  assert.match(script, /stepDraftRepairReferences/)
  assert.match(script, /apply-step-draft-with-reference-updates/)
  assert.match(script, /Apply \+ update refs/)
  assert.match(script, /producedBy\|includeState\|stateKey/)
})

test("workflow builder html includes step draft scripts before help decoration", () => {
  const model = createAuthoringModelFromTemplate({
    name: "step-draft-html",
    title: "Step Draft HTML",
    description: "Step draft script is included.",
    template: "simple-agent"
  })
  const html = renderWorkflowBuilderHtml({
    cspSource: "vscode-resource:",
    initialModel: model,
    isEditMode: false,
    modeNote: "mode note",
    nonce: "nonce-456",
    templateOptions: [{ id: "simple-agent", label: "Simple Agent", description: "simple" }]
  })

  assert.match(html, /validateStepDraftInWebview/)
  assert.match(html, /requestStepDraftHostValidation/)
  assert.match(html, /apply-step-draft-with-reference-updates/)
  assert.ok(html.indexOf("validateStepDraftInWebview") < html.indexOf("apply-step-draft-with-reference-updates"))
  assert.ok(html.indexOf("apply-step-draft-with-reference-updates") < html.indexOf("jumpToHelpEntry"))
})
