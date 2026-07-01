const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const extensionRoot = path.resolve(__dirname, "..")

test("GUI workflow completion calls the workflow-register step command silently", async () => {
  const { completeCurrentWorkflowStepAfterGuiAction } = require("../out/workflowStepCompletion")
  const calls = []

  const completed = await completeCurrentWorkflowStepAfterGuiAction({
    executeCommand: async (...args) => {
      calls.push(args)
      return "Completed: Bazaar Project Rule Review / Confirm the target Bazaar revision or revision range."
    }
  })

  assert.equal(completed, true)
  assert.deepEqual(calls, [["workflowRegister.completeStep", { silent: true }]])
})

test("GUI workflow completion reports no active workflow step without failing the GUI action", async () => {
  const { completeCurrentWorkflowStepAfterGuiAction } = require("../out/workflowStepCompletion")
  const warnings = []

  const completed = await completeCurrentWorkflowStepAfterGuiAction({
    executeCommand: async () => "No active Bob workflow step.",
    showWarningMessage: async (message) => warnings.push(message)
  })

  assert.equal(completed, false)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /No active Bob workflow step/)
})

test("GUI workflow completion reports result capture failures without treating the step as completed", async () => {
  const { completeCurrentWorkflowStepAfterGuiAction } = require("../out/workflowStepCompletion")
  const warnings = []

  const completed = await completeCurrentWorkflowStepAfterGuiAction({
    executeCommand: async () => "Could not capture Bob workflow step result: No result text was available to hand off.",
    showWarningMessage: async (message) => warnings.push(message)
  })

  assert.equal(completed, false)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /Could not capture Bob workflow step result/)
})

test("GUI workflow completion reports command failures without failing the GUI action", async () => {
  const { completeCurrentWorkflowStepAfterGuiAction } = require("../out/workflowStepCompletion")
  const warnings = []

  const completed = await completeCurrentWorkflowStepAfterGuiAction({
    executeCommand: async () => {
      throw new Error("command not found")
    },
    showWarningMessage: async (message) => warnings.push(message)
  })

  assert.equal(completed, false)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /command not found/)
})

test("review GUI only completes the workflow step after Bob context ADD succeeds", () => {
  const source = fs.readFileSync(path.join(extensionRoot, "src", "reviewGui.ts"), "utf8")

  assert.match(source, /if \(isBobCodeExtensionAvailable\(\)\) \{[\s\S]*addResult = await addPacketToBobContext\(doc\.uri, packet\)/)
  assert.match(source, /addResult === "added"[\s\S]*completeCurrentWorkflowStepAfterGuiAction/)
  assert.match(source, /import \{ addMarkdownPacketToBobContext \} from "\.\/bobContext"/)
})

test("review GUI stops after markdown creation when IBM Bob is absent", () => {
  const source = fs.readFileSync(path.join(extensionRoot, "src", "reviewGui.ts"), "utf8")

  assert.match(source, /import \{ isBobCodeExtensionAvailable \} from "\.\/bobCodeExtension"/)
  assert.match(source, /if \(isBobCodeExtensionAvailable\(\)\) \{[\s\S]*await addPacketToBobContext\(doc\.uri, packet\)[\s\S]*\} else \{[\s\S]*IBM Bob 拡張機能が見つからないため/)
  assert.match(source, /bobContextAvailable:/)
})
