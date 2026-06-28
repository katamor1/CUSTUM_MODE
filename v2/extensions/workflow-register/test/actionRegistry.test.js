const assert = require("node:assert/strict")
const { test } = require("node:test")

const { createDefaultActionRegistry } = require("../out/core/actionRegistry")

test("default action registry exposes a VS Code command provider", async () => {
  const calls = []
  const registry = createDefaultActionRegistry({
    executeCommand: (command, ...args) => {
      calls.push({ command, args })
      return "ok"
    }
  })

  assert.deepEqual(registry.list(), ["vscode.executeCommand"])
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
