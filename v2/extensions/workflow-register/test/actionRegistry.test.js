const assert = require("node:assert/strict")
const { test } = require("node:test")

const { ActionRegistry, createDefaultActionRegistry } = require("../out/core/actionRegistry")

test("default action registry exposes a VS Code command provider", async () => {
  const calls = []
  const registry = createDefaultActionRegistry({
    executeCommand: (command, ...args) => {
      calls.push({ command, args })
      return "ok"
    }
  })

  assert.deepEqual(registry.list(), ["vscode.executeCommand", "workflowRegister.runMechanicalChecks"])
  const result = await registry.execute("vscode.executeCommand", {
    args: ["sample.command", "one", 2],
    inputs: {}
  })

  assert.equal(result.ok, true)
  assert.equal(result.value, "ok")
  assert.deepEqual(calls, [{ command: "sample.command", args: ["one", 2] }])
})

test("default action registry rejects missing VS Code command ids", async () => {
  const registry = createDefaultActionRegistry({ executeCommand: () => "unused" })
  const result = await registry.execute("vscode.executeCommand", { args: [], inputs: {} })

  assert.equal(result.ok, false)
  assert.match(result.error, /requires the command id/)
})

test("default action registry injects workflowRoot into Bob command inputs", async () => {
  const calls = []
  const registry = createDefaultActionRegistry({
    executeCommand: (command, ...args) => {
      calls.push({ command, args })
      return "ok"
    }
  })

  const result = await registry.execute("vscode.executeCommand", {
    args: ["bobProcess.validateCatalog", { catalogPath: ".bob/process/process-catalog.yaml" }],
    inputs: {},
    workflowRoot: "C:\\repo\\workspace-b"
  })

  assert.equal(result.ok, true)
  assert.deepEqual(calls, [{
    command: "bobProcess.validateCatalog",
    args: [{ catalogPath: ".bob/process/process-catalog.yaml", workspaceRoot: "C:\\repo\\workspace-b" }]
  }])
})

test("default action registry injects workflowRoot into Bob code consistency command inputs", async () => {
  const calls = []
  const registry = createDefaultActionRegistry({
    executeCommand: (command, ...args) => {
      calls.push({ command, args })
      return "ok"
    }
  })

  const result = await registry.execute("vscode.executeCommand", {
    args: ["bobCodeConsistency.prepareAiTraceabilityDraft", { docsRoot: "docs" }],
    inputs: {},
    workflowRoot: "C:\\repo\\workspace-b"
  })

  assert.equal(result.ok, true)
  assert.deepEqual(calls, [{
    command: "bobCodeConsistency.prepareAiTraceabilityDraft",
    args: [{ docsRoot: "docs", workspaceRoot: "C:\\repo\\workspace-b" }]
  }])
})

test("default action registry keeps explicit Bob command workspaceRoot", async () => {
  const calls = []
  const registry = createDefaultActionRegistry({
    executeCommand: (command, ...args) => {
      calls.push({ command, args })
      return "ok"
    }
  })

  await registry.execute("vscode.executeCommand", {
    args: ["bobTemplate.validateLibrary", { workspaceRoot: "C:\\repo\\workspace-a" }],
    inputs: {},
    workflowRoot: "C:\\repo\\workspace-b"
  })

  assert.deepEqual(calls, [{
    command: "bobTemplate.validateLibrary",
    args: [{ workspaceRoot: "C:\\repo\\workspace-a" }]
  }])
})

test("default action registry blocks VS Code commands in untrusted workspaces", async () => {
  let called = false
  const registry = createDefaultActionRegistry({
    isWorkspaceTrusted: () => false,
    executeCommand: () => {
      called = true
      return "unused"
    }
  })

  const result = await registry.execute("vscode.executeCommand", {
    args: ["sample.command"],
    inputs: {}
  })

  assert.equal(result.ok, false)
  assert.match(result.error, /Workspace is not trusted/)
  assert.equal(called, false)
})

test("action registry executes registered providers and rejects unknown providers", async () => {
  const registry = new ActionRegistry()
  registry.register({
    id: "sample.collect",
    execute: async ({ args, inputs }) => ({ revision: args.revision, target: inputs.target })
  })

  const ok = await registry.execute("sample.collect", {
    args: { revision: "42" },
    inputs: { target: "trunk" }
  })
  const missing = await registry.execute("sample.missing", { args: {}, inputs: {} })

  assert.equal(ok.ok, true)
  assert.deepEqual(ok.value, { revision: "42", target: "trunk" })
  assert.equal(missing.ok, false)
  assert.match(missing.error, /Unsupported action provider/)
})

test("action registry rejects duplicate ids and preserves the original owner", async () => {
  const registry = new ActionRegistry()
  registry.register({ id: "sample.collect", sourceId: "extension.alpha", execute: () => "alpha" })

  assert.throws(
    () => registry.register({ id: "sample.collect", sourceId: "extension.beta", execute: () => "beta" }),
    /sample\.collect.*extension\.alpha.*extension\.beta/
  )

  const result = await registry.execute("sample.collect", { args: {}, inputs: {} })
  assert.equal(result.ok, true)
  assert.equal(result.value, "alpha")
})

test("action provider registration disposable removes only its own registration", async () => {
  const registry = new ActionRegistry()
  const first = registry.register({ id: "sample.collect", sourceId: "extension.alpha", execute: () => "alpha" })

  first.dispose()
  const missing = await registry.execute("sample.collect", { args: {}, inputs: {} })
  assert.equal(missing.ok, false)

  registry.register({ id: "sample.collect", sourceId: "extension.beta", execute: () => "beta" })
  first.dispose()
  const replacement = await registry.execute("sample.collect", { args: {}, inputs: {} })
  assert.equal(replacement.ok, true)
  assert.equal(replacement.value, "beta")
})
