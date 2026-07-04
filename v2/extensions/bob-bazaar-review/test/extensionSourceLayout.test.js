const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const { extensionRoot, readSrc } = require("./helpers/sourceReader")

test("extension entrypoint is a composition root for command and workflow registrations", () => {
  for (const fileName of ["workflow/workflowProviders.ts", "workflow/workflowActions.ts", "workspace/workspaceCommands.ts"]) {
    assert.ok(fs.existsSync(path.join(extensionRoot, "src", fileName)), `${fileName} must exist`)
  }

  const source = readSrc("extension.ts")
  assert.match(source, /registerWorkflowProvidersWithRetry\(context\)/)
  assert.match(source, /collectReviewContext\(/)
  assert.match(source, /loadReviewRules\(/)
  assert.match(source, /configureMcp\(context\)/)
  assert.match(source, /initProjectRules\(\)/)
  assert.doesNotMatch(source, /function registerWorkflowProviders/)
  assert.doesNotMatch(source, /function collectReviewContext/)
  assert.doesNotMatch(source, /function findReviewPacketText/)
  assert.doesNotMatch(source, /function configureMcp/)
  assert.doesNotMatch(source, /function initProjectRules/)
})

test("workspace root resolution modules live under the workspace source boundary", () => {
  for (const fileName of ["workspaceResolver.ts", "workspaceRoots.ts"]) {
    assert.ok(fs.existsSync(path.join(extensionRoot, "src", "workspace", fileName)), `workspace/${fileName} must exist`)
    assert.ok(!fs.existsSync(path.join(extensionRoot, "src", fileName)), `${fileName} must not stay at the src root`)
  }

  const resolverSource = readSrc("workspace", "workspaceResolver.ts")
  assert.match(resolverSource, /from "\.\/workspaceRoots"/)
})

test("review GUI modules live under the ui source boundary", () => {
  for (const fileName of ["reviewGui.ts", "reviewGuiHtml.ts", "reviewGuiTypes.ts"]) {
    assert.ok(fs.existsSync(path.join(extensionRoot, "src", "ui", fileName)), `ui/${fileName} must exist`)
    assert.ok(!fs.existsSync(path.join(extensionRoot, "src", fileName)), `${fileName} must not stay at the src root`)
  }

  const guiSource = readSrc("ui", "reviewGui.ts")
  assert.match(guiSource, /from "\.\/reviewGuiHtml"/)
  assert.match(guiSource, /from "\.\/reviewGuiTypes"/)
})

test("workflow integration modules live under the workflow source boundary", () => {
  for (const fileName of [
    "workflowActions.ts",
    "workflowBridge.ts",
    "workflowProviders.ts",
    "workflowRegisterBridge.ts",
    "workflowStepCompletion.ts"
  ]) {
    assert.ok(fs.existsSync(path.join(extensionRoot, "src", "workflow", fileName)), `workflow/${fileName} must exist`)
    assert.ok(!fs.existsSync(path.join(extensionRoot, "src", fileName)), `${fileName} must not stay at the src root`)
  }

  const providersSource = readSrc("workflow", "workflowProviders.ts")
  assert.match(providersSource, /from "\.\/workflowActions"/)
  assert.match(providersSource, /from "\.\/workflowRegisterBridge"/)
})

test("bazaar review modules live under the bazaar source boundary", () => {
  for (const fileName of [
    "bazaar.ts",
    "bazaarReviewCommands.ts",
    "bzrPathTrust.ts",
    "markdownFence.ts",
    "reviewLimits.ts",
    "reviewPacket.ts",
    "reviewPacketSelection.ts",
    "reviewTarget.ts",
    "revisionInfo.ts",
    "textEncoding.ts"
  ]) {
    assert.ok(fs.existsSync(path.join(extensionRoot, "src", "bazaar", fileName)), `bazaar/${fileName} must exist`)
    assert.ok(!fs.existsSync(path.join(extensionRoot, "src", fileName)), `${fileName} must not stay at the src root`)
  }

  const commandSource = readSrc("bazaar", "bazaarReviewCommands.ts")
  assert.match(commandSource, /from "\.\/bazaar"/)
  assert.match(commandSource, /from "\.\/reviewPacket"/)
})

test("extension source root only keeps the extension entrypoint", () => {
  const rootFiles = fs.readdirSync(path.join(extensionRoot, "src"))
    .filter((entry) => entry.endsWith(".ts"))
    .sort()

  assert.deepEqual(rootFiles, ["extension.ts"])

  for (const fileName of ["bobCodeExtension.ts", "bobContext.ts"]) {
    assert.ok(fs.existsSync(path.join(extensionRoot, "src", "bob", fileName)), `bob/${fileName} must exist`)
  }
  assert.ok(fs.existsSync(path.join(extensionRoot, "src", "mcp", "mcpConfig.ts")), "mcp/mcpConfig.ts must exist")
  assert.ok(fs.existsSync(path.join(extensionRoot, "src", "projectRules", "reviewResultValidationCommand.ts")), "projectRules/reviewResultValidationCommand.ts must exist")
  for (const fileName of ["bobWorkspaceInit.ts", "templateRefresh.ts", "workspaceCommands.ts"]) {
    assert.ok(fs.existsSync(path.join(extensionRoot, "src", "workspace", fileName)), `workspace/${fileName} must exist`)
  }
})
