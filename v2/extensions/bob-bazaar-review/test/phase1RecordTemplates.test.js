const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const extensionRoot = path.resolve(__dirname, "..")

function extensionFile(relativePath) {
  return path.join(extensionRoot, relativePath)
}

function readExtensionFile(relativePath) {
  return fs.readFileSync(extensionFile(relativePath), "utf8")
}

function assertLocalFile(relativePath) {
  assert.ok(fs.existsSync(extensionFile(relativePath)), `${relativePath} must be extension-local`)
}

test("Phase 1 campaign operation docs are extension-local", () => {
  const campaignDoc = readExtensionFile("docs/uat/bazaar-review-campaign-template-ja.md")
  for (const phrase of [
    "campaign.yaml",
    "targets.yaml",
    "record.yaml",
    "triage.yaml",
    "summary.json",
    "summary.md",
    "BZR-RT-036",
    "BZR-RT-043",
    ".bob-review-records",
    "accepted",
    "rejected",
    "needs_investigation",
    "deferred"
  ]) {
    assert.ok(campaignDoc.includes(phrase), `campaign doc must include ${phrase}`)
  }
})

test("Phase 1 record and summary templates are extension-local", () => {
  for (const relativePath of [
    "docs/uat/bazaar-review-record-template.yaml",
    "docs/uat/bazaar-review-triage-template.yaml",
    "docs/uat/bazaar-review-summary-template.md",
    "templates/.bob-review-records/campaigns/phase1-bazaar-review-uat-001/campaign.yaml",
    "templates/.bob-review-records/campaigns/phase1-bazaar-review-uat-001/targets.yaml",
    "templates/.bob-review-records/campaigns/phase1-bazaar-review-uat-001/records/_template/record.yaml",
    "templates/.bob-review-records/campaigns/phase1-bazaar-review-uat-001/records/_template/triage.yaml"
  ]) {
    assertLocalFile(relativePath)
  }

  assert.match(readExtensionFile("docs/uat/bazaar-review-record-template.yaml"), /^schema_version: bazaar-review-record\/v1$/m)
  assert.match(readExtensionFile("docs/uat/bazaar-review-triage-template.yaml"), /^schema_version: bazaar-review-triage\/v1$/m)
  assert.ok(readExtensionFile("docs/uat/bazaar-review-summary-template.md").includes("IBM Bob Bazaar"))
})

test("Phase 1 review record operations are documented in local docs", () => {
  const readme = readExtensionFile("README.md")
  const realMachineSpec = readExtensionFile("docs/real-machine-test-spec-ja.md")

  for (const phrase of [
    "bobBazaar.records.initCampaign",
    "bobBazaar.records.createRecord",
    "bobBazaar.records.createTriage",
    "bobBazaar.records.generateSummary",
    "review-packet.md",
    "summary.json"
  ]) {
    assert.ok(readme.includes(phrase), `README must document ${phrase}`)
  }

  assert.ok(realMachineSpec.includes("BZR-RT-036"))
  assert.ok(realMachineSpec.includes("BZR-RT-043"))
})
