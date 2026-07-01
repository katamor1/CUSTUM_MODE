const assert = require("node:assert/strict")
const { test } = require("node:test")

test("addMarkdownPacketToBobContext sends the full packet to Bob with its line range", async () => {
  const { addMarkdownPacketToBobContext } = require("../out/bobContext")
  const calls = []
  const uri = { scheme: "untitled", path: "bazaar-review.md" }
  const packet = ["# Bazaar Revision Review Request", "", "## Bazaar diff"].join("\n")

  const result = await addMarkdownPacketToBobContext({
    executeCommand: async (...args) => calls.push(args),
    writeClipboard: async () => assert.fail("clipboard fallback should not run"),
    showWarningMessage: async () => assert.fail("warning should not be shown")
  }, uri, packet)

  assert.equal(result, "added")
  assert.deepEqual(calls, [["bob-code.addToContext", uri, packet, 1, 3]])
})

test("addMarkdownPacketToBobContext copies the packet when Bob context insertion fails", async () => {
  const { addMarkdownPacketToBobContext } = require("../out/bobContext")
  const warnings = []
  let clipboardText = ""
  const packet = "# Bazaar Revision Review Request"

  const result = await addMarkdownPacketToBobContext({
    executeCommand: async () => {
      throw new Error("Bob chat is not available")
    },
    writeClipboard: async (text) => {
      clipboardText = text
    },
    showWarningMessage: async (message) => {
      warnings.push(message)
    }
  }, { scheme: "untitled" }, packet)

  assert.equal(result, "clipboardFallback")
  assert.equal(clipboardText, packet)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /クリップボードへコピーしました/)
  assert.match(warnings[0], /Bob chat is not available/)
})
