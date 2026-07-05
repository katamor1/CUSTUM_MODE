const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

function sampleReviewResult(reviewId = "bazaar-r125-project-rule-review") {
  return {
    review_id: reviewId,
    vcs: {
      type: "bazaar",
      repository: "legacy-control",
      revision_mode: "single",
      revision: "125"
    },
    checklist_results: [
      {
        rule_id: "RT-001",
        title: "RT thread has no blocking I/O",
        status: "fail",
        severity: "error",
        confidence: "high",
        evidence: [],
        reason: "blocking I/O was added"
      },
      {
        rule_id: "UT-001",
        title: "tests are updated",
        status: "fail",
        severity: "warning",
        confidence: "medium",
        evidence: [],
        reason: "test evidence is not present"
      }
    ],
    findings: [
      {
        id: "F-001",
        rule_id: "RT-001",
        severity: "error",
        title: "blocking I/O",
        description: "blocking I/O was added"
      }
    ],
    summary: {
      pass: 0,
      fail: 2,
      unknown: 0,
      not_applicable: 0,
      blocked: 0
    }
  }
}

function sampleRecord(overrides = {}) {
  return {
    schema_version: "bazaar-review-record/v1",
    campaign_id: "phase1-bazaar-review-uat-001",
    record_id: "bzr-r125-single-run-001",
    review_id: "bazaar-r125-project-rule-review",
    target_id: "bzr-r125-single",
    workflow: {
      workflow_id: "bazaar-project-rule-review",
      run_id: "wrun-001",
      status: "completed",
      unavailable: false
    },
    vcs: {
      type: "bazaar",
      repository: ".",
      revision_mode: "singleRevision",
      revision: "125"
    },
    inputs: {
      review_packet_path: ".bob-review-records/campaigns/phase1-bazaar-review-uat-001/records/bazaar-r125-project-rule-review/review-packet.md",
      checklist_path: ".bob/review/checklist.json"
    },
    outputs: {
      review_result_json: ".bob/review/results/bazaar-r125-project-rule-review.json",
      review_result_markdown: ".bob/review/results/bazaar-r125-project-rule-review.md",
      triage_yaml: ".bob-review-records/campaigns/phase1-bazaar-review-uat-001/records/bazaar-r125-project-rule-review/triage.yaml"
    },
    quality_gate: {
      schema_valid: true,
      checklist_count_matches: true,
      evidence_required_satisfied: true,
      findings_have_rule_id: true
    },
    metrics: {
      baseline_review_minutes: 45,
      bob_review_minutes: 18,
      human_triage_minutes: 12,
      findings_total: 2,
      findings_accepted: 1,
      findings_rejected: 0,
      findings_needs_investigation: 1,
      findings_deferred: 0
    },
    notes: "notes.md",
    ...overrides
  }
}

async function prepareWorkspace() {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-bazaar-records-"))
  await fs.mkdir(path.join(workspaceRoot, ".bob", "review", "results"), { recursive: true })
  await fs.writeFile(
    path.join(workspaceRoot, ".bob", "review", "results", "bazaar-r125-project-rule-review.json"),
    JSON.stringify(sampleReviewResult(), null, 2),
    "utf8"
  )
  await fs.writeFile(
    path.join(workspaceRoot, ".bob", "review", "results", "bazaar-r125-project-rule-review.md"),
    "# Review result\n",
    "utf8"
  )
  await fs.mkdir(path.join(workspaceRoot, ".bob-review-records", "campaigns", "phase1-bazaar-review-uat-001", "records", "bazaar-r125-project-rule-review"), { recursive: true })
  await fs.writeFile(
    path.join(workspaceRoot, ".bob-review-records", "campaigns", "phase1-bazaar-review-uat-001", "records", "bazaar-r125-project-rule-review", "review-packet.md"),
    "# Packet\n",
    "utf8"
  )
  return workspaceRoot
}

test("review record store writes YAML under .bob-review-records and rejects escaped artifact paths", async () => {
  const {
    readReviewRecord,
    validateReviewRecord,
    writeReviewRecord
  } = require("../out/records/reviewRecordStore")
  const workspaceRoot = await prepareWorkspace()
  const record = sampleRecord()

  const written = await writeReviewRecord(workspaceRoot, record)
  const loaded = await readReviewRecord(workspaceRoot, record.campaign_id, record.review_id)
  const issues = await validateReviewRecord(workspaceRoot, loaded)

  assert.equal(path.relative(workspaceRoot, written), path.join(".bob-review-records", "campaigns", record.campaign_id, "records", record.review_id, "record.yaml"))
  assert.equal(loaded.review_id, record.review_id)
  assert.deepEqual(issues, [])

  const escapedRecord = sampleRecord({
    outputs: {
      ...record.outputs,
      review_result_json: "../outside.json"
    }
  })

  const escapedIssues = await validateReviewRecord(workspaceRoot, escapedRecord)
  assert.match(escapedIssues.join("\n"), /workspace-relative path/)
})

test("triage draft generation covers findings and failed checklist rules without findings", () => {
  const {
    createTriageDraft,
    validateTriage
  } = require("../out/records/reviewTriage")
  const reviewResult = sampleReviewResult()

  const triage = createTriageDraft(reviewResult, {
    triagedBy: "reviewer-name",
    triagedAt: "2026-07-04T11:00:00+09:00"
  })

  assert.equal(triage.review_id, reviewResult.review_id)
  assert.deepEqual(triage.items.map((item) => item.finding_id), ["F-001", "CHECKLIST-UT-001"])
  assert.deepEqual(triage.items.map((item) => item.decision), ["needs_investigation", "needs_investigation"])
  assert.deepEqual(triage.summary, {
    accepted: 0,
    rejected: 0,
    needs_investigation: 2,
    deferred: 0
  })
  assert.deepEqual(validateTriage(triage, reviewResult), [])

  const badTriage = {
    ...triage,
    items: [{ ...triage.items[0], decision: "maybe" }],
    summary: { accepted: 1, rejected: 0, needs_investigation: 0, deferred: 0 }
  }
  const issues = validateTriage(badTriage, reviewResult)
  assert.match(issues.join("\n"), /invalid decision/)
  assert.match(issues.join("\n"), /summary.accepted/)

  const missingChecklistTriage = {
    ...triage,
    items: triage.items.filter((item) => item.finding_id !== "CHECKLIST-UT-001"),
    summary: {
      accepted: 0,
      rejected: 0,
      needs_investigation: 1,
      deferred: 0
    }
  }
  assert.match(validateTriage(missingChecklistTriage, reviewResult).join("\n"), /missing triage item.*CHECKLIST-UT-001/)

  const missingFindingTriage = {
    ...triage,
    items: triage.items.filter((item) => item.finding_id !== "F-001"),
    summary: {
      accepted: 0,
      rejected: 0,
      needs_investigation: 1,
      deferred: 0
    }
  }
  assert.match(validateTriage(missingFindingTriage, reviewResult).join("\n"), /missing triage item.*F-001/)
})

test("campaign summary aggregates valid records and exposes missing triage", async () => {
  const {
    generateCampaignSummary,
    writeCampaignSummaryArtifacts,
    writeReviewRecord,
    writeTriage
  } = require("../out/records/reviewRecordStore")
  const { createTriageDraft } = require("../out/records/reviewTriage")
  const workspaceRoot = await prepareWorkspace()
  const campaignId = "phase1-bazaar-review-uat-001"
  const reviewResult = sampleReviewResult()
  const triage = createTriageDraft(reviewResult, {
    triagedBy: "reviewer-name",
    triagedAt: "2026-07-04T11:00:00+09:00"
  })
  triage.items[0].decision = "accepted"
  triage.items[0].action = "fix_required"
  triage.items[0].owner = "developer-name"
  triage.summary = {
    accepted: 1,
    rejected: 0,
    needs_investigation: 1,
    deferred: 0
  }

  await writeReviewRecord(workspaceRoot, sampleRecord())
  await writeTriage(workspaceRoot, campaignId, reviewResult.review_id, triage)
  await writeReviewRecord(workspaceRoot, sampleRecord({
    record_id: "bzr-r126-single-run-001",
    review_id: "bazaar-r126-project-rule-review",
    target_id: "bzr-r126-single",
    inputs: {
      review_packet_path: ".bob-review-records/campaigns/phase1-bazaar-review-uat-001/records/bazaar-r126-project-rule-review/review-packet.md",
      checklist_path: ".bob/review/checklist.json"
    },
    outputs: {
      review_result_json: ".bob/review/results/bazaar-r125-project-rule-review.json",
      review_result_markdown: ".bob/review/results/bazaar-r125-project-rule-review.md",
      triage_yaml: ".bob-review-records/campaigns/phase1-bazaar-review-uat-001/records/bazaar-r126-project-rule-review/triage.yaml"
    },
    quality_gate: {
      schema_valid: false,
      checklist_count_matches: true,
      evidence_required_satisfied: true,
      findings_have_rule_id: true
    },
    metrics: {
      baseline_review_minutes: 30,
      bob_review_minutes: 20,
      human_triage_minutes: 0,
      findings_total: 0,
      findings_accepted: 0,
      findings_rejected: 0,
      findings_needs_investigation: 0,
      findings_deferred: 0
    }
  }))

  const summary = await generateCampaignSummary(workspaceRoot, campaignId)
  const artifactPaths = await writeCampaignSummaryArtifacts(workspaceRoot, campaignId, summary)

  assert.equal(summary.records_total, 2)
  assert.equal(summary.schema_valid_records, 1)
  assert.equal(summary.schema_invalid_records, 1)
  assert.equal(summary.triage_missing, 1)
  assert.equal(summary.findings_total, 2)
  assert.equal(summary.findings_accepted, 1)
  assert.equal(summary.findings_needs_investigation, 1)
  assert.equal(summary.baseline_review_minutes_total, 75)
  assert.equal(summary.bob_review_minutes_total, 38)
  assert.equal(summary.human_triage_minutes_total, 12)
  assert.equal(summary.estimated_minutes_saved, 25)
  assert.match(summary.warnings.join("\n"), /triage missing/)

  const summaryMarkdown = await fs.readFile(artifactPaths.markdownPath, "utf8")
  assert.match(summaryMarkdown, /# IBM Bob Bazaar レビュー実績サマリ/)
  assert.match(summaryMarkdown, /records_total/)
  assert.match(summaryMarkdown, /triage missing/)
})

test("review packet artifacts are written under the campaign record and protect existing evidence", async () => {
  const {
    writeReviewPacketArtifact
  } = require("../out/records/reviewRecordStore")
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-bazaar-packet-artifact-"))
  const campaignId = "phase1-bazaar-review-uat-001"
  const reviewId = "bazaar-r125-project-rule-review"

  const first = await writeReviewPacketArtifact(workspaceRoot, campaignId, reviewId, "# Packet v1\n")
  assert.equal(path.relative(workspaceRoot, first.packetPath), path.join(".bob-review-records", "campaigns", campaignId, "records", reviewId, "review-packet.md"))
  assert.deepEqual(first.backupPaths, [])
  assert.equal(await fs.readFile(first.packetPath, "utf8"), "# Packet v1\n")

  await assert.rejects(
    () => writeReviewPacketArtifact(workspaceRoot, campaignId, reviewId, "# Packet v2\n"),
    /already exists/
  )

  const second = await writeReviewPacketArtifact(workspaceRoot, campaignId, reviewId, "# Packet v2\n", { backupExisting: true })
  assert.equal(await fs.readFile(second.packetPath, "utf8"), "# Packet v2\n")
  assert.equal(second.backupPaths.length, 1)
  assert.equal(await fs.readFile(second.backupPaths[0], "utf8"), "# Packet v1\n")
})
