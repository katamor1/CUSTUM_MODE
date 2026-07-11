const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

function readSource(...segments) {
  return fs.readFileSync(path.join(__dirname, "..", "src", ...segments), "utf8")
}

test("BazaarClient delegates process execution to the bounded runner", () => {
  const source = readSource("bazaar", "bazaar.ts")

  assert.match(source, /runExternalProcess/)
  assert.match(source, /timeoutMs/)
  assert.match(source, /signal/)
  assert.doesNotMatch(source, /execFile\(/)
})

test("direct Bazaar review progress exposes cancellation to the client", () => {
  const source = readSource("bazaar", "bazaarReviewCommands.ts")

  assert.match(source, /cancellable:\s*true/)
  assert.match(source, /AbortController/)
  assert.match(source, /token\.onCancellationRequested/)
  assert.match(source, /makeBazaarClient\(signal\)/)
})
