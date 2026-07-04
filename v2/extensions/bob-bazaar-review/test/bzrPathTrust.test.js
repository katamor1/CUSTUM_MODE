const assert = require("node:assert/strict")
const path = require("node:path")
const { test } = require("node:test")
const {
  extensionRoot,
  readSourceSet
} = require("./helpers/sourceReader")

function configWithInspection(inspection, fallback = "workspace-malicious-bzr") {
  return {
    get: () => fallback,
    inspect: () => inspection
  }
}

test("resolveBzrPath ignores workspace overrides when the workspace is untrusted", () => {
  const { resolveBzrPath } = require(path.join(extensionRoot, "out", "bzrPathTrust"))
  const resolved = resolveBzrPath(configWithInspection({
    defaultValue: "bzr",
    globalValue: "user-bzr",
    workspaceValue: "workspace-bzr",
    workspaceFolderValue: "workspace-folder-bzr"
  }), false)

  assert.equal(resolved, "user-bzr")
})

test("resolveBzrPath uses default bzr in untrusted workspaces without user/global configuration", () => {
  const { resolveBzrPath } = require(path.join(extensionRoot, "out", "bzrPathTrust"))
  const resolved = resolveBzrPath(configWithInspection({
    defaultValue: "bzr",
    workspaceValue: "workspace-bzr"
  }), false)

  assert.equal(resolved, "bzr")
})

test("resolveBzrPath allows workspace overrides only when the workspace is trusted", () => {
  const { resolveBzrPath } = require(path.join(extensionRoot, "out", "bzrPathTrust"))
  const resolved = resolveBzrPath(configWithInspection({
    defaultValue: "bzr",
    globalValue: "user-bzr",
    workspaceValue: "workspace-bzr",
    workspaceFolderValue: "workspace-folder-bzr"
  }), true)

  assert.equal(resolved, "workspace-folder-bzr")
})

test("Bazaar command, GUI, and MCP setup use trust-aware bzrPath resolution", () => {
  const source = readSourceSet(["bazaarReviewCommands.ts", "reviewGui.ts", "extension.ts"])

  assert.match(source, /resolveBzrPath\(config, vscode\.workspace\.isTrusted\)/)
  assert.doesNotMatch(source, /config\.get<string>\("bzrPath", "bzr"\)/)
})
