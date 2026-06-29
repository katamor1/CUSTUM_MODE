const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const extensionRoot = path.resolve(__dirname, "..")

test("Bazaar companion extension registers workflow providers with workflow-register", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"))
  const source = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8")

  assert.ok(packageJson.extensionDependencies.includes("local.workflow-register"))
  assert.ok(packageJson.activationEvents.includes("onStartupFinished"))
  assert.match(source, /const WORKFLOW_REGISTER_EXTENSION_ID = "local\.workflow-register"/)
  assert.match(source, /registerWorkflowProviders\(context\)\.catch/)
  assert.match(source, /id: "bobBazaar\.openReviewGui"/)
  assert.match(source, /initialTargetFromWorkflowInputs\(input\.inputs, input\)/)
  assert.match(source, /id: "bobBazaar\.collectReviewContext"/)
  assert.match(source, /id: "bobBazaar\.loadReviewRules"/)
  assert.match(source, /execute: \(input\) => loadReviewRules\(input\)/)
  assert.match(source, /id: "bobBazaar\.captureReviewResult"/)
  assert.match(source, /execute: \(input\) => captureReviewResult\(firstStringArg\(input\.args\), \{[\s\S]*expectedChecklistItems: expectedChecklistItemsFromState\(input\.state\),[\s\S]*workspaceRoot: stringInput\(input\.workflowRoot\)[\s\S]*\}\)/)
})

test("Bazaar workflow provider resolves repository root independently from workflowRoot", () => {
  const source = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8")
  const guiSource = fs.readFileSync(path.join(extensionRoot, "src", "reviewGui.ts"), "utf8")

  assert.match(source, /workflowRoot\?: string/)
  assert.match(source, /bazaarRoot\?: string/)
  assert.match(source, /repositoryRoot\?: string/)
  assert.match(source, /const explicitBazaarRoot = stringInput\(input\?\.bazaarRoot\) \?\? stringInput\(input\?\.repositoryRoot\)/)
  assert.match(source, /bazaarRoot: explicitBazaarRoot/)
  assert.match(source, /resolveBazaarWorkspaceFolder/)
  assert.match(source, /resolveBobWorkspaceFolder/)
  assert.match(guiSource, /private bazaarWorkspaceFolder\?: vscode\.WorkspaceFolder/)
  assert.match(guiSource, /private bobWorkspaceFolder\?: vscode\.WorkspaceFolder/)
  assert.match(guiSource, /resolveBazaarWorkspaceFolder\(\{[\s\S]*workflowRoot: this\.initialTarget\?\.workflowRoot/)
  assert.match(guiSource, /resolveBobWorkspaceFolder\(\{[\s\S]*workflowRoot: this\.initialTarget\?\.workflowRoot/)
  assert.match(guiSource, /buildProjectRulesSectionForWorkspace\(bobFolder\.uri\.fsPath\)/)
  assert.doesNotMatch(guiSource, /workspaceFolders\?\.\[0\]|workspaceFolders\?\[0\]/)
})

test("Bazaar review GUI accepts workflow inputs as initial target values", () => {
  const extensionSource = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8")
  const guiSource = fs.readFileSync(path.join(extensionRoot, "src", "reviewGui.ts"), "utf8")

  assert.match(extensionSource, /function initialTargetFromWorkflowInputs\(inputs: Record<string, unknown>, input\?: WorkflowActionExecutionInput\)/)
  assert.match(extensionSource, /revisionMode: targetMode\(inputs\.revisionMode\)/)
  assert.match(guiSource, /export interface BazaarReviewInitialTarget/)
  assert.match(guiSource, /openBazaarReviewGui\(context: vscode\.ExtensionContext, initialTarget\?: BazaarReviewInitialTarget\)/)
  assert.match(guiSource, /new BazaarReviewGuiController\(context, panel, initialTarget\)/)
  assert.match(guiSource, /const initialTargetJson = JSON\.stringify\(initialTarget \?\? \{\}\)/)
  assert.match(guiSource, /applyInitialTarget\(initialTarget\)/)
})

test("Bazaar workflow template starts review target selection from the GUI by default", () => {
  const workflowPath = path.join(extensionRoot, "templates", ".bob", "workflows", "bazaar-project-rule-review", "WORKFLOW.md")
  const workflow = fs.readFileSync(workflowPath, "utf8")

  assert.match(workflow, /revisionMode:[\s\S]*?prompt: false/)
  assert.match(workflow, /revision:[\s\S]*?prompt: false/)
  assert.match(workflow, /baseRevision:[\s\S]*?prompt: false/)
  assert.match(workflow, /targetRevision:[\s\S]*?prompt: false/)
  assert.doesNotMatch(workflow, /requiredWhen:/)
})

test("Bazaar workflow template declares the providers owned by this extension", () => {
  const workflowPath = path.join(extensionRoot, "templates", ".bob", "workflows", "bazaar-project-rule-review", "WORKFLOW.md")
  const workflow = fs.readFileSync(workflowPath, "utf8")

  assert.match(workflow, /^stepCompletion: manual$/m)
  assert.match(workflow, /^stepMessage: step$/m)
  assert.doesNotMatch(workflow, /```workflow-step/)
  assert.doesNotMatch(workflow, /^## Step:/m)
  assert.match(workflow, /^steps:$/m)
  assert.match(workflow, /id: review-input[\s\S]*?provider: bobBazaar\.openReviewGui[\s\S]*?sendResult: false[\s\S]*?completeOnSuccess: false/)
  assert.match(workflow, /id: collect-context[\s\S]*?provider: bobBazaar\.collectReviewContext[\s\S]*?sendResult: true[\s\S]*?required: true[\s\S]*?completeOnSuccess: true/)
  assert.match(workflow, /id: load-rules[\s\S]*?provider: bobBazaar\.loadReviewRules[\s\S]*?sendResult: true[\s\S]*?required: true[\s\S]*?completeOnSuccess: true/)
})
