const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const { extensionRoot } = require("./helpers/sourceReader")

test("workflow action contract docs define code consistency provider ids", () => {
  const contract = fs.readFileSync(path.join(extensionRoot, "docs", "workflow-action-contracts-ja.md"), "utf8")

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
  assert.doesNotMatch(readme, /\| `\.xlsx` \| `xlsx`/)
})

test("code consistency Japanese specs stay aligned with current test and dependency contracts", () => {
  const detailedDesign = fs.readFileSync(path.join(extensionRoot, "docs", "detailed-design-ja.md"), "utf8")
  const unitSpec = fs.readFileSync(path.join(extensionRoot, "docs", "unit-test-spec-ja.md"), "utf8")
  const realMachineSpec = fs.readFileSync(path.join(extensionRoot, "docs", "real-machine-test-spec-ja.md"), "utf8")
  const scriptInjectionFixture = "</script><" + "script>alert(1)</" + "script>"

  for (const phrase of [
    "read-excel-file",
    "bobCodeConsistency.maxDocumentBytes",
    "bobCodeConsistency.maxWorkbookSheets",
    "bobCodeConsistency.maxRowsPerSheet",
    "bobCodeConsistency.maxExcerptBytesPerDocument",
    "bobCodeConsistency.maxRawDiffBytes",
    "bobCodeConsistency.maxBobInputBytes"
  ]) {
    assert.ok(detailedDesign.includes(phrase), `detailed design must document: ${phrase}`)
  }
  assert.doesNotMatch(detailedDesign, /`\.xlsx` は `xlsx`/)

  for (const phrase of [
    "一時 Git repository",
    "test/vcsValidation.test.js",
    "test/traceabilityPrepWebviewAssets.test.js",
    "test/traceabilityPrepController.test.js",
    "test/workflowProviderRegistration.test.js",
    "test/sizeLimits.test.js"
  ]) {
    assert.ok(unitSpec.includes(phrase), `unit spec must map current test coverage: ${phrase}`)
  }
  assert.doesNotMatch(unitSpec, /Git \/ Bazaar CLI は stub し、実 repository に依存しない/)

  for (const phrase of [
    "CCR-RT-011A",
    scriptInjectionFixture,
    "accepted / rejected / deprecated",
    "Review Input Preview"
  ]) {
    assert.ok(realMachineSpec.includes(phrase), `real-machine spec must cover Traceability Prep behavior: ${phrase}`)
  }
})
