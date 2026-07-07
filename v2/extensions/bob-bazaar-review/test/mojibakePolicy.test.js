const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const extensionRoot = path.resolve(__dirname, "..")

test("package manifest command ids are readable", () => {
  const text = fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8")
  const bad = []
  for (let i = 0; i + 5 < text.length; i += 1) {
    if (text.charCodeAt(i) === 92 && text.charCodeAt(i + 1) === 117) bad.push(i)
  }
  assert.deepEqual(bad, [])
})
