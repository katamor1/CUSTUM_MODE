const assert = require("node:assert/strict")
const { test } = require("node:test")

const { truncateUtf8Text } = require("../out/core/limits")

test("truncateUtf8Text includes the suffix inside the byte budget", () => {
  const result = truncateUtf8Text("日本語テキスト".repeat(20), 12, "\n[truncated]\n")

  assert.equal(result.truncated, true)
  assert.ok(Buffer.byteLength(result.text, "utf8") <= 12)
  assert.doesNotMatch(result.text, /�/)
})
