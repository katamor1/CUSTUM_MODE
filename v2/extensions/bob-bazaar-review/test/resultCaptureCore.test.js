const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const fsSync = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")
const extensionRoot = path.resolve(__dirname, "..")

function validReviewResult(id = "BRR-TEST-001") {
  return {
    review_id: id,
    vcs: {
      type: "bazaar",
      repository: "test-repo",
      revision_mode: "singleRevision",
      revision: "2"
    },
    checklist_results: [
      {
        rule_id: "RULE-001",
        title: "Rule one",
        status: "pass",
        severity: "info",
        confidence: "medium",
        evidence: [{ file: "src/main.c", summary: "Reviewed the changed function." }],
        reason: "No issue was found."
      }
    ],
    findings: [],
    summary: {
      pass: 1,
      fail: 0,
      unknown: 0,
      not_applicable: 0,
      blocked: 0
    }
  }
}

function checklistResult(ruleId, status, evidence = []) {
  return {
    rule_id: ruleId,
    title: `Rule ${ruleId}`,
    status,
    severity: status === "fail" ? "warning" : "info",
    confidence: "medium",
    evidence,
    reason: `${ruleId} was reviewed.`
  }
}

test("explicit review-result text is validated and saved as JSON and Markdown", async () => {
  const { captureReviewResultText } = require("../out/projectRules/resultCaptureCore")
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-review-capture-"))
  const raw = JSON.stringify(validReviewResult("BRR-EXPLICIT-001"), null, 2)

  const result = await captureReviewResultText(workspaceRoot, `\`\`\`json\n${raw}\n\`\`\``, "command argument")

  assert.equal(result.status, "ok")
  assert.equal(result.source, "command argument")
  assert.equal(result.reviewId, "BRR-EXPLICIT-001")
  assert.equal(result.valid, true)
  assert.match(result.jsonPath, /BRR-EXPLICIT-001\.json$/)
  assert.match(result.markdownPath, /BRR-EXPLICIT-001\.md$/)
  assert.deepEqual(JSON.parse(await fs.readFile(result.jsonPath, "utf8")).review_id, "BRR-EXPLICIT-001")
  assert.match(await fs.readFile(result.markdownPath, "utf8"), /BRR-EXPLICIT-001/)
})

test("invalid explicit review-result JSON returns validation issues without saving artifacts", async () => {
  const { captureReviewResultText } = require("../out/projectRules/resultCaptureCore")
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-review-capture-invalid-"))

  const result = await captureReviewResultText(workspaceRoot, "{\"review_id\":\"missing-required-fields\"}", "command argument")

  assert.equal(result.status, "error")
  assert.equal(result.valid, false)
  assert.ok(result.issueCount > 0)
  assert.match(result.issues.map((issue) => issue.path).join("\n"), /\$\.vcs/)
})

test("placeholder checklist severities from Bob agent output are normalized to info", async () => {
  const { captureReviewResultText } = require("../out/projectRules/resultCaptureCore")
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-review-capture-severity-"))
  const payload = validReviewResult("BRR-SEVERITY-NORMALIZE")
  payload.checklist_results = [
    {
      rule_id: "RULE-001",
      title: "Rule one",
      status: "not_applicable",
      severity: "N/A",
      confidence: "high",
      evidence: [],
      reason: "The changed files do not trigger this rule."
    }
  ]
  payload.summary = {
    pass: 0,
    fail: 0,
    unknown: 0,
    not_applicable: 1,
    blocked: 0
  }

  const result = await captureReviewResultText(workspaceRoot, `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``, "command argument")

  assert.equal(result.status, "ok")
  const saved = JSON.parse(await fs.readFile(result.jsonPath, "utf8"))
  assert.equal(saved.checklist_results[0].severity, "info")
})

test("completed workflow checklist is saved after normalizing mismatched summary counts", async () => {
  const { captureReviewResultText } = require("../out/projectRules/resultCaptureCore")
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-review-capture-complete-"))
  const payload = validReviewResult("BRR-SUMMARY-NORMALIZE")
  payload.checklist_results = [
    checklistResult("RULE-001", "pass", [{ file: "src/main.c", summary: "Rule one was checked." }]),
    checklistResult("RULE-002", "unknown"),
    checklistResult("RULE-003", "not_applicable")
  ]
  payload.summary = {
    pass: 3,
    fail: 0,
    unknown: 0,
    not_applicable: 0,
    blocked: 0
  }

  const result = await captureReviewResultText(
    workspaceRoot,
    `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``,
    "command argument",
    { expectedChecklistItems: 3 }
  )

  assert.equal(result.status, "ok")
  const saved = JSON.parse(await fs.readFile(result.jsonPath, "utf8"))
  assert.deepEqual(saved.summary, {
    pass: 1,
    fail: 0,
    unknown: 1,
    not_applicable: 1,
    blocked: 0
  })
  assert.match(await fs.readFile(result.markdownPath, "utf8"), /\| unknown \| 1 \|/)
})

test("workflow checklist capture rejects incomplete checklist decisions before saving artifacts", async () => {
  const { captureReviewResultText } = require("../out/projectRules/resultCaptureCore")
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-review-capture-incomplete-"))
  const payload = validReviewResult("BRR-INCOMPLETE-CHECKLIST")

  const result = await captureReviewResultText(
    workspaceRoot,
    `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``,
    "command argument",
    { expectedChecklistItems: 2 }
  )

  assert.equal(result.status, "error")
  assert.match(result.issues.map((issue) => issue.message).join("\n"), /expected 2 checklist result\(s\), got 1/)
  await assert.rejects(fs.stat(path.join(workspaceRoot, ".bob", "review", "results", "BRR-INCOMPLETE-CHECKLIST.json")))
})

test("command argument capture path returns without awaiting presentation UI", () => {
  const source = fsSync.readFileSync(path.join(extensionRoot, "src", "projectRules", "resultCapture.ts"), "utf8")

  assert.match(source, /const explicitInput = typeof inputText === "string" && inputText\.trim\(\)\.length > 0/)
  assert.match(source, /if \(!explicitInput\) await presentCaptureResult\(result\)/)
})
