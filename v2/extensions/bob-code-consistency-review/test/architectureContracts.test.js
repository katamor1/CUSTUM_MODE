const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const { extensionRoot, repoPath } = require("./helpers/sourceReader")

test("workflow action contract docs define code consistency provider ids", () => {
  const contract = fs.readFileSync(repoPath("docs", "workflow-action-contracts-ja.md"), "utf8")

  for (const providerId of [
    "bobCodeConsistency.prepareAiTraceabilityDraft",
    "bobCodeConsistency.applyAiTraceabilityDraft",
    "bobCodeConsistency.openTraceabilityPrep",
    "bobCodeConsistency.validateTraceabilityCatalog",
    "bobCodeConsistency.createReviewInputFromTraceability",
    "bobCodeConsistency.preprocess",
    "bobCodeConsistency.captureBobOutput",
    "bobCodeConsistency.validateOutput",
    "bobCodeConsistency.triage"
  ]) {
    assert.ok(contract.includes(providerId), `workflow contract must document ${providerId}`)
  }
})

test("code consistency README reflects current implementation, dependencies, and artifact paths", () => {
  const readme = fs.readFileSync(path.join(extensionRoot, "README.md"), "utf8")

  for (const phrase of [
    "read-excel-file",
    "src/commands/reviewInputCommands.ts",
    ".bob-review/bob-output/",
    ".bob-review/human-triage/",
    "artifact_metadata"
  ]) {
    assert.ok(readme.includes(phrase), `README must document: ${phrase}`)
  }

  assert.doesNotMatch(readme, /次の分割候補は、`extension\.ts` に残る `runCreateReviewInput`/)
  assert.doesNotMatch(readme, /\| `.xlsx` \| `xlsx`/)
})
