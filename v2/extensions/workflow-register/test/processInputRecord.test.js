const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")
const yaml = require("js-yaml")

const outRoot = path.resolve(__dirname, "..", "out")
const { validateProcessInput } = require(path.join(outRoot, "process", "processInputValidator"))
const { validateProcessReviewResult } = require(path.join(outRoot, "process", "processReviewResultValidator"))
const { generateCampaignSummary, writeProcessRecord } = require(path.join(outRoot, "process", "processRecordStore"))
const { PROCESS_INPUT_SCHEMA_VERSION, PROCESS_RECORD_SCHEMA_VERSION, PROCESS_REVIEW_RESULT_SCHEMA_VERSION } = require(path.join(outRoot, "process", "processTypes"))

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "process-workflow-"))
}

async function safeFixtureWorkspace() {
  const root = await tempRoot()
  await fs.mkdir(path.join(root, "docs"), { recursive: true })
  await fs.mkdir(path.join(root, "src"), { recursive: true })
  await fs.writeFile(path.join(root, "docs", "requirement.md"), "# 要件\n", "utf8")
  await fs.writeFile(path.join(root, "src", "sample.c"), "int sample(void) { return 0; }\n", "utf8")
  return root
}

function sampleProcessInput() {
  return {
    schemaVersion: PROCESS_INPUT_SCHEMA_VERSION,
    campaignId: "campaign-alpha",
    runId: "run-001",
    workflowName: "process-code-doc-investigation",
    phase: "investigation",
    targetLanguage: "c_cpp",
    targetSummary: "仕様とコードの対応を調査する",
    vcs: {
      type: "bazaar",
      root: ".",
      noAliases: true,
      revision: "123"
    },
    inputs: {
      requirements: [{ path: "docs/requirement.md", title: "要件" }],
      target_files: [{ path: "src/sample.c", encoding: "shift_jis" }]
    },
    options: {
      destructiveVcsOperations: false,
      requireHumanGate: true
    }
  }
}

test("process input validates safe workspace-relative files and Bazaar no-aliases intent", async () => {
  const root = await safeFixtureWorkspace()

  const result = await validateProcessInput(sampleProcessInput(), { workspaceRoot: root })

  assert.equal(result.ok, true, result.diagnostics.join("\n"))
  assert.equal(result.input.vcs.noAliases, true)
  assert.deepEqual(Object.keys(result.input.inputs).sort(), ["requirements", "target_files"])
})

test("process input rejects absolute paths, parent traversal, destructive VCS intent, and symlink escapes", async (t) => {
  const root = await safeFixtureWorkspace()
  const outside = await tempRoot()
  await fs.writeFile(path.join(outside, "outside.md"), "outside\n", "utf8")
  const link = path.join(root, "linked")
  try {
    await fs.symlink(outside, link, "junction")
  } catch {
    t.skip("symlink creation is not available in this environment")
    return
  }
  const input = sampleProcessInput()
  input.inputs.requirements.push({ path: "../outside.md" })
  input.inputs.requirements.push({ path: "C:/outside/absolute.md" })
  input.inputs.requirements.push({ path: "linked/outside.md" })
  input.vcs.noAliases = false
  input.options.destructiveVcsOperations = true

  const result = await validateProcessInput(input, { workspaceRoot: root })

  assert.equal(result.ok, false)
  assert.match(result.diagnostics.join("\n"), /unsafe workspace path/i)
  assert.match(result.diagnostics.join("\n"), /symlink escape/i)
  assert.match(result.diagnostics.join("\n"), /bzr --no-aliases/i)
  assert.match(result.diagnostics.join("\n"), /destructive VCS operations/i)
})

test("process review result validates evidence references and checklist summary counts", () => {
  const valid = {
    schemaVersion: PROCESS_REVIEW_RESULT_SCHEMA_VERSION,
    campaignId: "campaign-alpha",
    runId: "run-001",
    workflowName: "process-common-review",
    status: "needs_rework",
    summary: {
      pass: 1,
      fail: 1,
      warning: 0,
      not_applicable: 0
    },
    checklist: [
      { id: "scope-confirmed", title: "対象確認", status: "pass", evidenceRefs: ["req"] },
      { id: "issue-found", title: "指摘", status: "fail", evidenceRefs: ["code"], finding: "境界条件の扱いを修正する" }
    ],
    findings: [
      { id: "F-001", severity: "major", summary: "境界条件の扱いが不足", evidenceRefs: ["code"] }
    ]
  }

  const ok = validateProcessReviewResult(valid, {
    evidenceIndex: {
      entries: [
        { id: "req", path: "docs/requirement.md" },
        { id: "code", path: "src/sample.c" }
      ]
    }
  })
  assert.equal(ok.ok, true, ok.diagnostics.join("\n"))

  const invalid = structuredClone(valid)
  invalid.summary.fail = 0
  invalid.checklist[1].finding = ""
  invalid.findings[0].evidenceRefs = ["missing-ref"]
  const failed = validateProcessReviewResult(invalid, { evidenceIndex: { entries: [{ id: "req", path: "docs/requirement.md" }] } })
  assert.equal(failed.ok, false)
  assert.match(failed.diagnostics.join("\n"), /summary counts/i)
  assert.match(failed.diagnostics.join("\n"), /failing checklist item/i)
  assert.match(failed.diagnostics.join("\n"), /unknown evidence ref/i)
})

test("process record store writes campaign records, backs up replacements, and summarizes metrics", async () => {
  const root = await tempRoot()
  const baseRecord = {
    schemaVersion: PROCESS_RECORD_SCHEMA_VERSION,
    campaignId: "campaign-alpha",
    runId: "run-001",
    workflowName: "process-common-review",
    phase: "common",
    status: "completed",
    inputPath: "process-input.yaml",
    artifactRoot: ".bob-process-runs/run-001",
    evidenceIndexPath: ".bob-process-runs/run-001/evidence-index.json",
    reviewResultPath: ".bob-process-runs/run-001/common-review/review-result.yaml",
    humanGate: {
      required: true,
      status: "accepted",
      reviewer: "operator"
    },
    metrics: {
      evidenceCount: 2,
      findingCount: 1,
      passedChecks: 1,
      failedChecks: 1
    }
  }

  const first = await writeProcessRecord(root, baseRecord)
  assert.equal(first.relativePath, ".bob-process-records/campaigns/campaign-alpha/records/run-001/record.yaml")
  assert.equal((await fs.stat(first.absolutePath)).isFile(), true)

  const replacement = { ...baseRecord, status: "needs_rework", metrics: { ...baseRecord.metrics, failedChecks: 2 } }
  const second = await writeProcessRecord(root, replacement)
  assert.equal(second.backupRelativePath.includes(".bak."), true)
  assert.equal(yaml.load(await fs.readFile(second.absolutePath, "utf8")).status, "needs_rework")

  await writeProcessRecord(root, { ...baseRecord, runId: "run-002", status: "blocked", metrics: { ...baseRecord.metrics, findingCount: 0 } })
  const invalidDir = path.join(root, ".bob-process-records", "campaigns", "campaign-alpha", "records", "invalid")
  await fs.mkdir(invalidDir, { recursive: true })
  await fs.writeFile(path.join(invalidDir, "record.yaml"), "schemaVersion: wrong\n", "utf8")

  const summary = await generateCampaignSummary(root, "campaign-alpha")

  assert.equal(summary.summary.recordCount, 2)
  assert.equal(summary.summary.invalidRecordCount, 1)
  assert.deepEqual(summary.summary.statusCounts, { needs_rework: 1, blocked: 1 })
  assert.equal(summary.summary.totalFindingCount, 1)
  assert.equal((await fs.stat(summary.absolutePath)).isFile(), true)
})
