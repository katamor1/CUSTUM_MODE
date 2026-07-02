const assert = require("node:assert/strict")
const { test } = require("node:test")
const { readSourceSet } = require("./helpers/sourceReader")

test("Bazaar workflow provider resolves repository root independently from workflowRoot", () => {
  const bridgeSource = readSourceSet(["workflowRegisterBridge.ts", "workspaceResolver.ts"])
  const guiSource = readSourceSet(["reviewGui.ts", "reviewGuiTypes.ts"])

  assert.match(bridgeSource, /workflowRoot\?: string/)
  assert.match(bridgeSource, /bazaarRoot\?: string/)
  assert.match(bridgeSource, /repositoryRoot\?: string/)
  assert.match(bridgeSource, /const explicitBazaarRoot =[\s\S]*stringInput\(input\?\.bazaarRoot\)[\s\S]*stringInput\(input\?\.repositoryRoot\)/)
  assert.match(bridgeSource, /bazaarRoot: explicitBazaarRoot/)
  assert.match(guiSource, /private bazaarWorkspaceFolder\?: vscode\.WorkspaceFolder/)
  assert.match(guiSource, /private bobWorkspaceFolder\?: vscode\.WorkspaceFolder/)
  assert.match(guiSource, /resolveBazaarWorkspaceFolder\(\{[\s\S]*workflowRoot: this\.initialTarget\?\.workflowRoot/)
  assert.match(guiSource, /resolveBobWorkspaceFolder\(\{[\s\S]*workflowRoot: this\.initialTarget\?\.workflowRoot/)
  assert.match(guiSource, /buildProjectRulesSectionForWorkspace\(bobFolder\.uri\.fsPath\)/)
  assert.doesNotMatch(guiSource, /workspaceFolders\?\.\[0\]|workspaceFolders\?\[0\]/)
})

test("Bazaar review GUI accepts workflow inputs as initial target values", () => {
  const bridgeSource = readSourceSet(["workflowRegisterBridge.ts"])
  const guiSource = readSourceSet(["reviewGui.ts", "reviewGuiHtml.ts", "reviewGuiTypes.ts"])

  assert.match(bridgeSource, /function initialTargetFromWorkflowInputs\(inputs: Record<string, unknown>, input\?: WorkflowActionExecutionInput\)/)
  assert.match(bridgeSource, /revisionMode: targetMode\(inputs\.revisionMode\)/)
  assert.match(guiSource, /export interface BazaarReviewInitialTarget/)
  assert.match(guiSource, /openBazaarReviewGui\(context: vscode\.ExtensionContext, initialTarget\?: BazaarReviewInitialTarget\)/)
  assert.match(guiSource, /new BazaarReviewGuiController\(context, panel, initialTarget\)/)
  assert.match(guiSource, /const initialTargetJson = JSON\.stringify\(initialTarget \?\? \{\}\)/)
  assert.match(guiSource, /applyInitialTarget\(initialTarget\)/)
})
