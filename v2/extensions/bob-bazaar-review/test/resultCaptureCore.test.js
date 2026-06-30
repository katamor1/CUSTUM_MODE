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

test("workflow capture recovers review-result JSON from markdown checklist output", async () => {
  const { captureReviewResultText } = require("../out/projectRules/resultCaptureCore")
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-review-capture-markdown-"))
  await fs.mkdir(path.join(workspaceRoot, ".bob", "review"), { recursive: true })
  await fs.writeFile(path.join(workspaceRoot, ".bob", "review", "checklist.json"), JSON.stringify({
    version: "1.0.0",
    project: "legacy-control",
    rules: [
      {
        id: "RT-001",
        category: "realtime",
        title: "RTスレッド内でI/Oを行っていない",
        description: "RT threads must not perform I/O.",
        severity_on_fail: "error"
      },
      {
        id: "DOC-001",
        category: "design-doc",
        title: "基本設計・詳細設計・台帳との不整合がない",
        description: "Design documents must stay consistent.",
        severity_on_fail: "warning"
      }
    ]
  }, null, 2), "utf8")
  const markdown = [
    "## チェックリスト分析結果",
    "",
    "| ルールID | カテゴリ | タイトル | 適用条件の該当 | 判定 |",
    "|----------|----------|----------|----------------|------|",
    "| **RT-001** | realtime | RTスレッド内でI/Oを行っていない | 変更ファイルが `src/rt_*.c` 外 | **not_applicable** |",
    "| **DOC-001** | design-doc | 基本設計・詳細設計・台帳との不整合がない | 仕様変更キーワードなし | **not_applicable** |"
  ].join("\n")

  const result = await captureReviewResultText(workspaceRoot, markdown, "agent output", {
    expectedChecklistItems: 2,
    workflowState: {
      reviewContext: JSON.stringify({
        workspacePath: "C:/repo/project",
        mode: "singleRevision",
        revision: "3",
        targetRevision: "3"
      }),
      reviewRules: JSON.stringify({ checklistPath: ".bob/review/checklist.json", checklistItems: 2 })
    }
  })

  assert.equal(result.status, "ok")
  assert.equal(result.source, "agent output markdown recovery")
  assert.equal(result.reviewId, "bazaar-r3-project-rule-review")
  assert.match(result.jsonText, /"review_id": "bazaar-r3-project-rule-review"/)
  const saved = JSON.parse(await fs.readFile(result.jsonPath, "utf8"))
  assert.equal(saved.vcs.repository, "C:/repo/project")
  assert.deepEqual(saved.summary, { pass: 0, fail: 0, unknown: 0, not_applicable: 2, blocked: 0 })
  assert.deepEqual(saved.checklist_results.map((item) => [item.rule_id, item.status, item.severity]), [
    ["RT-001", "not_applicable", "info"],
    ["DOC-001", "not_applicable", "info"]
  ])
  assert.equal(saved.checklist_results[0].reason, "変更ファイルが src/rt_*.c 外")
  assert.match(await fs.readFile(result.markdownPath, "utf8"), /bazaar-r3-project-rule-review/)
})

test("workflow capture recovers review-result JSON from markdown rule headings and status lines", async () => {
  const { captureReviewResultText } = require("../out/projectRules/resultCaptureCore")
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-review-capture-heading-markdown-"))
  await fs.mkdir(path.join(workspaceRoot, ".bob", "review"), { recursive: true })
  await fs.writeFile(path.join(workspaceRoot, ".bob", "review", "checklist.json"), JSON.stringify({
    version: "1.0.0",
    project: "legacy-control",
    rules: [
      {
        id: "RT-001",
        category: "realtime",
        title: "RTスレッド内でI/Oを行っていない",
        description: "RT threads must not perform I/O.",
        severity_on_fail: "error"
      },
      {
        id: "DOC-001",
        category: "design-doc",
        title: "基本設計・詳細設計・台帳との不整合がない",
        description: "Design documents must stay consistent.",
        severity_on_fail: "warning"
      }
    ]
  }, null, 2), "utf8")
  const markdown = [
    "### 各ルール判定詳細",
    "",
    "#### RT-001 — RTスレッド内でI/Oを行っていない",
    "- `applies_when` : `changed_file_matches:src/rt_*.c` → **該当なし**",
    "- **ステータス: `not_applicable`** （confidence: high）",
    "",
    "#### DOC-001 — 基本設計・詳細設計・台帳との不整合がない",
    "- 差分テキストだけでは設計書との関係が判断できません。",
    "- **status: unknown**"
  ].join("\n")

  const result = await captureReviewResultText(workspaceRoot, markdown, "agent output", {
    expectedChecklistItems: 2,
    workflowState: {
      reviewContext: JSON.stringify({
        workspacePath: "C:/repo/project",
        mode: "revisionRange",
        baseRevision: "1",
        targetRevision: "4"
      }),
      reviewRules: JSON.stringify({ checklistPath: ".bob/review/checklist.json", checklistItems: 2 })
    }
  })

  assert.equal(result.status, "ok")
  assert.equal(result.reviewId, "bazaar-r1-4-project-rule-review")
  const saved = JSON.parse(await fs.readFile(result.jsonPath, "utf8"))
  assert.deepEqual(saved.summary, { pass: 0, fail: 0, unknown: 1, not_applicable: 1, blocked: 0 })
  assert.deepEqual(saved.checklist_results.map((item) => [item.rule_id, item.status]), [
    ["RT-001", "not_applicable"],
    ["DOC-001", "unknown"]
  ])
  assert.match(saved.checklist_results[0].reason, /changed_file_matches:src\/rt_\*\.c/)
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
