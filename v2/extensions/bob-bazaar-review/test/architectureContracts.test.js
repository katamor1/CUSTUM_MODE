const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const { extensionRoot, repoPath } = require("./helpers/sourceReader")

test("workflow action contract docs define Bazaar provider ids and sidecar metadata", () => {
  const actionContract = fs.readFileSync(repoPath("docs", "workflow-action-contracts-ja.md"), "utf8")
  const metadataContract = fs.readFileSync(repoPath("docs", "artifact-metadata-contract-ja.md"), "utf8")

  for (const providerId of [
    "bobBazaar.openReviewGui",
    "bobBazaar.collectReviewContext",
    "bobBazaar.loadReviewRules",
    "bobBazaar.captureReviewResult"
  ]) {
    assert.ok(actionContract.includes(providerId), `workflow contract must document ${providerId}`)
  }

  assert.ok(metadataContract.includes(".bob/review/results/<review_id>.artifact-metadata.json"))
  assert.ok(metadataContract.includes("bob-bazaar-review"))
})

test("bob-bazaar-review README reflects current source layout and metadata sidecar", () => {
  const readme = fs.readFileSync(path.join(extensionRoot, "README.md"), "utf8")

  for (const pathFragment of [
    "src/workflow/workflowRegisterBridge.ts",
    "src/bazaar/bazaarReviewCommands.ts",
    "src/projectRules/reviewResultValidationCommand.ts",
    "src/ui/",
    "src/workflow/",
    "src/workspace/"
  ]) {
    assert.ok(readme.includes(pathFragment), `README must mention current path ${pathFragment}`)
  }

  assert.ok(readme.includes(".bob/review/results/<review_id>.artifact-metadata.json"))
})
