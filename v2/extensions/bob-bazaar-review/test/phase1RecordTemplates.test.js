const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const extensionRoot = path.resolve(__dirname, "..")
const repoRoot = path.resolve(extensionRoot, "..", "..")

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8")
}

function assertFileIncludes(relativePath, expectedSnippets) {
  const text = readRepoFile(relativePath)
  for (const snippet of expectedSnippets) {
    assert.match(text, snippet, `${relativePath} should include ${snippet}`)
  }
}

test("Phase 1 campaign operation docs include executable record workflow templates", () => {
  assertFileIncludes("docs/uat/bazaar-review-campaign-template-ja.md", [
    /campaign\.yaml/,
    /targets\.yaml/,
    /record\.yaml/,
    /triage\.yaml/,
    /summary\.json/,
    /summary\.md/,
    /BZR-RT-036/,
    /BZR-RT-043/,
    /\.bob-review-records/,
    /accepted/,
    /rejected/,
    /needs_investigation/,
    /deferred/
  ])

  assertFileIncludes("docs/uat/bazaar-review-record-template.yaml", [
    /^schema_version: bazaar-review-record\/v1$/m,
    /^campaign_id:/m,
    /^record_id:/m,
    /^review_id:/m,
    /review_packet_path:/,
    /review_result_json:/,
    /triage_yaml:/,
    /schema_valid:/,
    /baseline_review_minutes:/,
    /human_triage_minutes:/
  ])

  assertFileIncludes("docs/uat/bazaar-review-triage-template.yaml", [
    /^schema_version: bazaar-review-triage\/v1$/m,
    /^review_id:/m,
    /decision: needs_investigation/,
    /accepted:/,
    /rejected:/,
    /needs_investigation:/,
    /deferred:/
  ])

  assertFileIncludes("docs/uat/bazaar-review-summary-template.md", [
    /IBM Bob Bazaar/,
    /campaign_id/,
    /records_total/,
    /estimated_minutes_saved/,
    /Phase 2/
  ])
})

test("Phase 1 runtime templates can be copied into a workspace without touching review-result artifacts", () => {
  assertFileIncludes("extensions/bob-bazaar-review/templates/.bob-review-records/campaigns/phase1-bazaar-review-uat-001/campaign.yaml", [
    /^schema_version: bazaar-review-campaign\/v1$/m,
    /^campaign_id: phase1-bazaar-review-uat-001$/m,
    /checklist_path: \.bob\/review\/checklist\.json/,
    /schema_path: \.bob\/review\/review-result\.schema\.json/,
    /human_triage_required: true/
  ])

  assertFileIncludes("extensions/bob-bazaar-review/templates/.bob-review-records/campaigns/phase1-bazaar-review-uat-001/targets.yaml", [
    /^schema_version: bazaar-review-targets\/v1$/m,
    /mode: singleRevision/,
    /mode: revisionRange/,
    /mode: workingTreeSinceRevision/
  ])

  assertFileIncludes("extensions/bob-bazaar-review/templates/.bob-review-records/campaigns/phase1-bazaar-review-uat-001/records/_template/record.yaml", [
    /^schema_version: bazaar-review-record\/v1$/m,
    /review_packet_path: \.bob-review-records\//,
    /review_result_json: \.bob\/review\/results\//,
    /triage_yaml: \.bob-review-records\//,
    /findings_needs_investigation:/
  ])

  assertFileIncludes("extensions/bob-bazaar-review/templates/.bob-review-records/campaigns/phase1-bazaar-review-uat-001/records/_template/triage.yaml", [
    /^schema_version: bazaar-review-triage\/v1$/m,
    /decision: needs_investigation/,
    /accepted:/,
    /deferred:/
  ])
})

test("Phase 1 review record operations are documented for README and real-machine UAT", () => {
  assertFileIncludes("extensions/bob-bazaar-review/README.md", [
    /\.bob-review-records/,
    /bobBazaar\.records\.initCampaign/,
    /bobBazaar\.records\.createRecord/,
    /bobBazaar\.records\.createTriage/,
    /bobBazaar\.records\.generateSummary/,
    /review-packet\.md/,
    /summary\.json/
  ])

  assertFileIncludes("extensions/bob-bazaar-review/docs/real-machine-test-spec-ja.md", [
    /\.bob-review-records/,
    /BZR-RT-036/,
    /BZR-RT-037/,
    /BZR-RT-038/,
    /BZR-RT-039/,
    /BZR-RT-040/,
    /BZR-RT-041/,
    /BZR-RT-042/,
    /BZR-RT-043/
  ])
})
