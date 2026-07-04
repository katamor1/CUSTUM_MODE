const test = require("node:test")
const assert = require("node:assert/strict")

const { createAuthoringModelFromTemplate } = require("../out/core/workflowAuthoringDefaults")
const { renderWorkflowBuilderBodyScript } = require("../out/webview/workflowBuilderBodyScript")
const { renderWorkflowBuilderClientScript } = require("../out/webview/workflowBuilderClientScript")
const { renderWorkflowBuilderGuidedHelpScript } = require("../out/webview/workflowBuilderGuidedHelpScript")
const { workflowBuilderHelpCatalog } = require("../out/webview/workflowBuilderHelpCatalog")
const { WorkflowBuilderHelpIds, workflowBuilderHelpIdValues, isWorkflowBuilderHelpId } = require("../out/webview/workflowBuilderHelpIds")
const { renderWorkflowBuilderHelpScript } = require("../out/webview/workflowBuilderHelpScript")
const { renderWorkflowBuilderHtml } = require("../out/webview/workflowBuilderHtml")
const { renderWorkflowBuilderStyles } = require("../out/webview/workflowBuilderStyles")

test("workflow builder html includes split style and client script output", () => {
  const model = createAuthoringModelFromTemplate({
    name: "webview-modules",
    title: "Webview Modules",
    description: "Render split webview modules.",
    template: "simple-agent"
  })
  const html = renderWorkflowBuilderHtml({
    cspSource: "vscode-resource:",
    initialModel: model,
    isEditMode: false,
    modeNote: "mode note",
    nonce: "nonce-123",
    templateOptions: [{ id: "simple-agent", label: "Simple Agent", description: "simple" }]
  })

  assert.match(html, /nonce-123/)
  assert.match(html, /Requires/)
  assert.match(html, /Guardrails/)
  assert.match(html, /data-tab="branching"/)
  assert.match(html, /Markdown Body/)
  assert.match(html, /requireApproval/)
  assert.match(html, /helpCatalog/)
  assert.match(html, /workflowHelpPanel/)
  assert.match(html, /workflowBuilderJumpToHelp/)
  assert.match(html, /renderWorkflowBuilderGuidedHelpScript|stepTypeGuideHtml/)
})

test("workflow builder split modules expose approval, markdown body, help, and guided navigation pieces", () => {
  const styles = renderWorkflowBuilderStyles()
  assert.match(styles, /\.tabs/)
  assert.match(styles, /\.help-panel/)
  assert.match(styles, /\.help-search-results/)
  assert.match(styles, /\.help-inline-guide/)

  const script = renderWorkflowBuilderClientScript()
  assert.match(script, /add-approval/)
  assert.match(script, /delete-approval/)
  assert.match(script, /data-approval-field/)
  assert.match(script, /data-manual-form-field/)
  assert.match(script, /data-manual-approval-field/)
  assert.match(script, /data-transition-default/)
  assert.match(script, /data-transition-decisions-json/)
  assert.match(script, /renderBranching/)
  assert.match(script, /data-branch-loop-field/)
  assert.match(script, /add-branch-loop/)
  assert.match(script, /delete-branch-loop/)
  assert.match(script, /editorDiagnostics/)
  assert.match(script, /setEditorDiagnostic/)
  assert.match(script, /transition-preview/)
  assert.match(script, /stepResultKeys/)
  assert.match(script, /data-user-action-field/)
  assert.match(script, /renderUserActionStep/)
  assert.match(script, /userActionPreviewHtml/)
  assert.match(script, /goto-help-target/)

  const guidedScript = renderWorkflowBuilderGuidedHelpScript()
  assert.match(guidedScript, /stepTypeGuideHtml/)
  assert.match(guidedScript, /stepOptionLabel/)
  assert.match(guidedScript, /resultKeyOptionLabel/)
  assert.match(guidedScript, /diagnosticTarget/)
  assert.match(guidedScript, /gotoHelpTarget/)

  const bodyScript = renderWorkflowBuilderBodyScript()
  assert.match(bodyScript, /renderMarkdownBody/)
  assert.match(bodyScript, /data-body-field/)
  assert.match(bodyScript, /model\.body/)

  const helpScript = renderWorkflowBuilderHelpScript()
  assert.match(helpScript, /renderHelpPanel/)
  assert.match(helpScript, /data-help-id/)
  assert.match(helpScript, /MutationObserver/)
  assert.match(helpScript, /searchHelpEntries/)
  assert.match(helpScript, /data-help-search/)
  assert.match(helpScript, /data-help-jump/)
  assert.match(helpScript, /jumpToHelpEntry/)
  assert.match(helpScript, /template\.select/)
  assert.match(helpScript, /steps\.addCommand/)
  assert.match(helpScript, /section\.includeState/)
  assert.match(helpScript, /section\.command/)
  assert.match(helpScript, /section\.result/)
  assert.match(helpScript, /section\.userAction/)
  assert.match(helpScript, /step\.userAction\.message/)
  assert.match(helpScript, /dynamicChoiceHelp/)
  assert.match(helpScript, /artifact\.producedBy/)
  assert.match(helpScript, /dataset\.stateKey/)
  assert.match(helpScript, /controlForHelpButton/)
})

test("workflow builder help id registry exposes known ids", () => {
  assert.equal(WorkflowBuilderHelpIds.StepType, "step.type")
  assert.equal(WorkflowBuilderHelpIds.StepPrompt, "step.prompt")
  assert.equal(WorkflowBuilderHelpIds.StepUserActionMessage, "step.userAction.message")
  assert.equal(WorkflowBuilderHelpIds.ArtifactProducedBy, "artifact.producedBy")
  assert.ok(workflowBuilderHelpIdValues.includes("result.source"))
  assert.equal(isWorkflowBuilderHelpId("guardrails.allowedCommands"), true)
  assert.equal(isWorkflowBuilderHelpId("unknown.help"), false)
})

test("workflow builder help catalog covers high priority Japanese help entries", () => {
  assert.equal(workflowBuilderHelpCatalog["step.type"].labelJa, "Step 種別")
  assert.match(workflowBuilderHelpCatalog["step.userAction.message"].summary, /手動操作ページ/)
  assert.equal(workflowBuilderHelpCatalog["preflight.failurePolicy"].options.stop.label, "stop")
  assert.match(workflowBuilderHelpCatalog["guardrails.allowedCommands"].summary, /許可/)
  assert.match(workflowBuilderHelpCatalog["approval.when"].example, /reviewContext\.changedFiles\.count/)
  assert.match(workflowBuilderHelpCatalog["completion.validateResult"].effect, /schema/)
})

test("workflow builder layout keeps help visible while lower fields scroll", () => {
  const styles = renderWorkflowBuilderStyles()

  assert.match(styles, /body \{[^}]*height: 100vh;[^}]*overflow: hidden;/s)
  assert.match(styles, /main \{[^}]*flex: 1 1 auto;[^}]*min-height: 0;[^}]*overflow: hidden;/s)
  assert.match(styles, /aside, section, \.help-panel \{[^}]*min-height: 0;[^}]*overflow: auto;/s)
})

test("workflow builder help decorates directly added step detail nodes", () => {
  class FakeClassList {
    constructor(element) { this.element = element }
    contains(name) { return String(this.element.className || "").split(/\s+/).includes(name) }
  }
  class FakeElement {
    constructor(tagName, textContent = "") {
      this.tagName = tagName.toUpperCase()
      this.textContent = textContent
      this.children = []
      this.dataset = {}
      this.attributes = {}
      this.className = ""
      this.nodeType = 1
      this.parentElement = undefined
      this.previousElementSibling = undefined
      this.classList = new FakeClassList(this)
    }
    appendChild(child) {
      if (child.nodeType === 1) {
        child.previousElementSibling = this.children.filter((item) => item.nodeType === 1).at(-1)
        child.parentElement = this
      }
      this.children.push(child)
      return child
    }
    insertAdjacentElement(_position, element) { return this.appendChild(element) }
    setAttribute(name, value) {
      this.attributes[name] = value
      if (name === "class") this.className = value
      if (name.startsWith("data-")) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
        this.dataset[key] = value
      }
    }
    matches(selector) {
      return selector.split(",").some((part) => this.matchesSingle(part.trim()))
    }
    matchesSingle(selector) {
      if (!selector) return false
      const attrMatch = selector.match(/^\[data-([^=]+)="([^"]+)"\]$/)
      if (attrMatch) {
        const key = attrMatch[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
        return this.dataset[key] === attrMatch[2]
      }
      const tagAttrMatch = selector.match(/^([a-z]+)\[data-([^=]+)="([^"]+)"\]$/i)
      if (tagAttrMatch) {
        const key = tagAttrMatch[2].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
        return this.tagName === tagAttrMatch[1].toUpperCase() && this.dataset[key] === tagAttrMatch[3]
      }
      if (selector === ".field-key") return this.classList.contains("field-key")
      if (selector.startsWith(".")) return this.classList.contains(selector.slice(1))
      return this.tagName === selector.toUpperCase()
    }
    closest(selector) {
      let current = this
      while (current) {
        if (current.matches && current.matches(selector)) return current
        current = current.parentElement
      }
      return undefined
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] }
    querySelectorAll(selector) {
      const matches = []
      const visit = (node) => {
        for (const child of node.children || []) {
          if (child.nodeType === 1 && child.matches(selector)) matches.push(child)
          visit(child)
        }
      }
      visit(this)
      return matches
    }
  }
  const panel = { innerHTML: "" }
  const activeTab = new FakeElement("div")
  activeTab.dataset.tab = "step"
  const context = {
    console,
    document: {
      addEventListener: () => {},
      body: new FakeElement("body"),
      createElement: (tagName) => new FakeElement(tagName),
      createTextNode: (text) => ({ nodeType: 3, textContent: text }),
      getElementById: (id) => id === "workflowHelpPanel" ? panel : undefined,
      querySelector: (selector) => selector === ".tab.active" ? activeTab : undefined,
      querySelectorAll: () => []
    },
    escapeHtml: (value) => String(value === undefined || value === null ? "" : value).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[ch]),
    helpCatalog: JSON.parse(JSON.stringify(workflowBuilderHelpCatalog)),
    model: { steps: [] },
    MutationObserver: class { observe() {} },
    templates: []
  }
  require("node:vm").runInNewContext(renderWorkflowBuilderHelpScript(), context)

  const content = new FakeElement("div")
  const includeStateHeading = new FakeElement("h3", "includeState")
  const promptLabel = new FakeElement("label", "prompt")
  const prompt = new FakeElement("textarea")
  prompt.dataset.stepField = "prompt"
  content.appendChild(includeStateHeading)
  content.appendChild(promptLabel)
  content.appendChild(prompt)

  context.decorateHelpTargets(includeStateHeading)
  context.decorateHelpTargets(prompt)

  assert.equal(includeStateHeading.querySelectorAll('[data-help-button="section.includeState"]').length, 1)
  assert.equal(promptLabel.querySelectorAll(".field-key").length, 1)
  assert.equal(promptLabel.querySelectorAll('[data-help-button="step.prompt"]').length, 1)
})

test("workflow builder help resolves current select after detail rerender", () => {
  const panel = { innerHTML: "" }
  const currentResultSource = {
    dataset: { helpId: "result.source", resultField: "source" },
    isConnected: true,
    tagName: "SELECT",
    value: "agent"
  }
  const staleResultSource = {
    dataset: { helpId: "result.source", resultField: "source" },
    isConnected: false,
    tagName: "SELECT",
    value: "state"
  }
  const listeners = {}
  const context = {
    console,
    document: {
      addEventListener: (name, listener) => { listeners[name] = listener },
      body: {},
      createElement: () => ({ appendChild() {}, setAttribute() {} }),
      createTextNode: (text) => ({ textContent: text }),
      getElementById: (id) => id === "workflowHelpPanel" ? panel : undefined,
      querySelector: (selector) => {
        if (selector === ".tab.active") return { dataset: { tab: "step" } }
        if (selector === '[data-help-id="result.source"]:not(.help-button)') return currentResultSource
        return undefined
      },
      querySelectorAll: () => []
    },
    escapeHtml: (value) => String(value === undefined || value === null ? "" : value).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[ch]),
    helpCatalog: JSON.parse(JSON.stringify(workflowBuilderHelpCatalog)),
    model: { steps: [] },
    MutationObserver: class { observe() {} },
    templates: []
  }

  require("node:vm").runInNewContext(renderWorkflowBuilderHelpScript(), context)
  context.renderHelpPanel("result.source", staleResultSource)

  assert.match(panel.innerHTML, /選択中: agent/)
  assert.doesNotMatch(panel.innerHTML, /選択中: state/)
})
