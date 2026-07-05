const assert = require("node:assert/strict")
const { test } = require("node:test")

const { readSrc } = require("./helpers/sourceReader")

function assertJsDocForExport(source, exportName, requiredTerms) {
  const pattern = new RegExp(`/\\*\\*((?:(?!\\*/)[\\s\\S])*)\\*/\\s*export\\s+(?:const|type|interface|class|async\\s+function|function)\\s+${exportName}(?:\\b|<)`)
  const match = source.match(pattern)
  assert.ok(match, `${exportName} must have JSDoc immediately before its export`)
  for (const term of requiredTerms) {
    assert.match(match[1], term, `${exportName} JSDoc must mention ${term}`)
  }
}

test("traceability AI draft entrypoints document AI proposal and human approval boundaries", () => {
  const source = readSrc("core", "traceabilityAiDraftProvider.ts")

  assertJsDocForExport(source, "prepareAiTraceabilityDraftPrompt", [/AI/, /候補/, /workspace/])
  assertJsDocForExport(source, "applyAiTraceabilityDraft", [/AI/, /host/, /承認/])
  assertJsDocForExport(source, "parseAiTraceabilityDraft", [/accepted/, /人間/])
  assertJsDocForExport(source, "mergeAiTraceabilityDraft", [/accepted/, /上書きしない/])
})
