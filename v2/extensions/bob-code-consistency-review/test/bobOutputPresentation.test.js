const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const extensionRoot = path.resolve(__dirname, "..")

test("code consistency Bob output tests do not depend on Bazaar presentation source layout", () => {
  const misplacedSource = path.join(extensionRoot, "src", "projectRules", "resultCapture.ts")

  assert.equal(fs.existsSync(misplacedSource), false)
})
