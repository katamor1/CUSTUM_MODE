const assert = require("node:assert/strict")
const { test } = require("node:test")
const { normalizeChangedFilePathStrict } = require("../out/core/fileSystem")

test("changed file paths preserve meaningful inner spaces", () => {
  assert.equal(normalizeChangedFilePathStrict("src/payment review.ts"), "src/payment review.ts")
  assert.equal(normalizeChangedFilePathStrict("docs\\review spec.md"), "docs/review spec.md")
})

test("changed file paths reject outer whitespace instead of selecting another file", () => {
  for (const candidate of [
    " src/payment.ts",
    "src/payment.ts ",
    "\u00a0src/payment.ts"
  ]) {
    assert.throws(
      () => normalizeChangedFilePathStrict(candidate),
      /outer whitespace/
    )
  }
})
