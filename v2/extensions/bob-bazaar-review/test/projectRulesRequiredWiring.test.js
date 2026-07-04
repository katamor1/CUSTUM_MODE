const assert = require("node:assert/strict")
const { test } = require("node:test")
const { readSrc } = require("./helpers/sourceReader")

test("project rules review entrypoints require configured checklist and schema files", () => {
  const sources = [
    ["bazaar/bazaarReviewCommands.ts", readSrc("bazaar", "bazaarReviewCommands.ts")],
    ["ui/reviewGui.ts", readSrc("ui", "reviewGui.ts")]
  ]

  for (const [fileName, source] of sources) {
    assert.match(source, /\bloadProjectChecklistRequired\b/, `${fileName} should import the required checklist loader`)
    assert.match(source, /\bloadReviewResultSchemaRequired\b/, `${fileName} should import the required schema loader`)
    assert.match(source, /\bloadProjectChecklistRequired\s*\(/, `${fileName} should call the required checklist loader`)
    assert.match(source, /\bloadReviewResultSchemaRequired\s*\(/, `${fileName} should call the required schema loader`)
    assert.doesNotMatch(source, /\bloadProjectChecklist\s*\(/, `${fileName} should not call the fallback checklist loader`)
    assert.doesNotMatch(source, /\bloadReviewResultSchema\s*\(/, `${fileName} should not call the fallback schema loader`)
  }
})
