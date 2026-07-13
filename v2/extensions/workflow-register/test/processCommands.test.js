const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")
const yaml = require("js-yaml")

const { readJson, readSourceSet } = require("./helpers/sourceReader")

const outRoot = path.resolve(__dirname, "..", "out")
const {
  collectEvidenceCommand,
  generateCampaignSummaryCommand,
  loadProcessInputCommand,
  validateCatalogCommand,
  validateReviewResultCommand,
  writeProcessRecordCommand
} = require(path.join(outRoot, "commands", "processCommands"))
const {
  PROCESS_INPUT_SCHEMA_VERSION,
  PROCESS_RECORD_SCHEMA_VERSION,
  PROCESS_REVIEW_RESULT_SCHEMA_VERSION
} = require(path.join(outRoot, "process", "processTypes"))

const processCommandIds = [
  "bobProcess.validateCatalog",
  "bobProcess.loadProcessInput",
  "bobProcess.collectEvidence",
  "bobProcess.validateReviewResult",
  "bobProcess.writeProcessRecord",
  "bobProcess.generateCampaignSummary"
]

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "process-command-"))
}

async function commandWorkspace() {
  const root = await tempRoot()
  await fs.mkdir(path.join(root, ".bob", "process"), { recursive: true })
  await fs.mkdir(path.join(root, "docs"), { recursive: true })
  await fs.mkdir(path.join(root, "src"), { recursive: true })
  await fs.writeFile(path.join(root, "docs", "requirement.md"), "# 要件\n", "utf8")
  await fs.writeFile(path.join(root, "src", "sample.c"), "int sample(void) { return 0; }\n", "utf8")
  const processInput = {
    schemaVersion: PROCESS_INPUT_SCHEMA_VERSION,
    campaignId: "campaign-alpha",
    runId: "run-001",
    workflowName: "process-common-review",
    phase: "common",
    targetLanguage: "c_cpp",
    targetSummary: "共通レビューを実施する",
    vcs: { type: "bazaar", root: ".", noAliases: true, revision: "123" },
    inputs: {
      requirements: [{ path: "docs/requirement.md", title: "要件" }],
      target_files: [{ path: "src/sample.c", encoding: "shift_jis" }]
    },
    options: { destructiveVcsOperations: false, requireHumanGate: true }
  }
  await fs.writeFile(path.join(root, "process-input.yaml"), yaml.dump(processInput), "utf8")
  return root
}

test("process command metadata is activated, contributed, and registered", () => {
  const packageJson = readJson("package.json")
  const activationEvents = new Set(packageJson.activationEvents)
  const contributedCommands = new Set(packageJson.contributes.commands.map((command) => command.command))
  const paletteCommands = new Set(packageJson.contributes.menus.commandPalette.map((entry) => entry.command))
  const extensionSource = readSourceSet(["extensionWithAuthoring.ts"])

  for (const commandId of processCommandIds) {
    assert.ok(activationEvents.has(`onCommand:${commandId}`), `${commandId} activation`)
    assert.ok(contributedCommands.has(commandId), `${commandId} contribution`)
    assert.ok(paletteCommands.has(commandId), `${commandId} palette`)
    assert.match(extensionSource, new RegExp(`registerCommand\\("${commandId.replace(".", "\\.")}"`))
  }
})

test("process and template command registrations resolve workspace root from command input", () => {
  const extensionSource = readSourceSet(["extensionWithAuthoring.ts"])

  assert.match(extensionSource, /processCommandOptions\(input\)/)
  assert.match(extensionSource, /templateCommandOptions\(input\)/)
  assert.doesNotMatch(extensionSource, /validateCatalogCommand\(input, processCommandOptions\(\)\)/)
  assert.doesNotMatch(extensionSource, /validateLibraryCommand\(input, templateCommandOptions\(\)\)/)
  assert.match(extensionSource, /workspaceRootFromCommandInput/)
})

test("process command handlers validate catalog/input, collect evidence, write records, and summarize campaign metrics", async () => {
  const root = await commandWorkspace()
  const repoRoot = path.resolve(__dirname, "..", "..", "..")
  await fs.copyFile(
    path.join(repoRoot, ".bob", "process", "process-catalog.yaml"),
    path.join(root, ".bob", "process", "process-catalog.yaml")
  )

  const catalog = await validateCatalogCommand({ catalogPath: ".bob/process/process-catalog.yaml" }, { workspaceRoot: root })
  assert.equal(catalog.status, "ok", catalog.diagnostics.join("\n"))
  assert.equal(catalog.workflowCount, 14)

  const input = await loadProcessInputCommand({ inputPath: "process-input.yaml" }, { workspaceRoot: root })
  assert.equal(input.status, "ok", input.diagnostics.join("\n"))
  assert.equal(input.input.workflowName, "process-common-review")

  const evidence = await collectEvidenceCommand({ inputPath: "process-input.yaml" }, { workspaceRoot: root })
  assert.equal(evidence.status, "ok", evidence.diagnostics.join("\n"))
  assert.equal(evidence.index.entries.length, 2)
  assert.equal(evidence.relativePath, ".bob-process-runs/run-001/evidence-index.json")
  assert.deepEqual(evidence.$workflow, {
    artifacts: [{ id: "evidenceIndex", ownership: "provider", path: evidence.relativePath }]
  })

  const reviewResult = {
    schemaVersion: PROCESS_REVIEW_RESULT_SCHEMA_VERSION,
    campaignId: "campaign-alpha",
    runId: "run-001",
    workflowName: "process-common-review",
    status: "approved",
    summary: { pass: 1, fail: 0, warning: 0, not_applicable: 0 },
    checklist: [
      { id: "scope-confirmed", title: "対象確認", status: "pass", evidenceRefs: ["requirements-1", "target_files-1"] }
    ],
    findings: []
  }
  await fs.mkdir(path.join(root, ".bob-process-runs", "run-001", "common-review"), { recursive: true })
  await fs.writeFile(path.join(root, ".bob-process-runs", "run-001", "common-review", "review-result.yaml"), yaml.dump(reviewResult), "utf8")
  const review = await validateReviewResultCommand({
    reviewResultPath: ".bob-process-runs/run-001/common-review/review-result.yaml",
    evidenceIndexPath: ".bob-process-runs/run-001/evidence-index.json"
  }, { workspaceRoot: root })
  assert.equal(review.status, "ok", review.diagnostics.join("\n"))

  const record = await writeProcessRecordCommand({
    record: {
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
      humanGate: { required: true, status: "accepted", reviewer: "operator" },
      metrics: { evidenceCount: 2, findingCount: 0, passedChecks: 1, failedChecks: 0 }
    }
  }, { workspaceRoot: root })
  assert.equal(record.status, "ok", record.diagnostics.join("\n"))
  assert.equal(record.relativePath, ".bob-process-records/campaigns/campaign-alpha/records/run-001/record.yaml")
  assert.deepEqual(record.$workflow, {
    artifacts: [{ id: "processRecord", ownership: "provider", path: record.relativePath }]
  })

  const summary = await generateCampaignSummaryCommand({ campaignId: "campaign-alpha" }, { workspaceRoot: root })
  assert.equal(summary.status, "ok", summary.diagnostics.join("\n"))
  assert.equal(summary.summary.recordCount, 1)
  assert.deepEqual(summary.summary.statusCounts, { completed: 1 })
  assert.deepEqual(summary.$workflow, {
    artifacts: [{ id: "campaignSummary", ownership: "provider", path: summary.relativePath }]
  })
})

test("writeProcessRecordCommand normalizes manual approval decisions before validation", async () => {
  const root = await commandWorkspace()

  const record = await writeProcessRecordCommand({
    record: {
      schemaVersion: PROCESS_RECORD_SCHEMA_VERSION,
      campaignId: "campaign-alpha",
      runId: "run-approval",
      workflowName: "process-common-review",
      phase: "common",
      status: "completed",
      inputPath: "process-input.yaml",
      artifactRoot: ".bob-process-runs/run-approval",
      humanGate: { required: true, status: "approved" }
    }
  }, { workspaceRoot: root })

  assert.equal(record.status, "ok", record.diagnostics.join("\n"))
  const written = yaml.load(await fs.readFile(path.join(root, record.relativePath), "utf8"))
  assert.equal(written.humanGate.status, "accepted")
})

test("writeProcessRecordCommand rejects a completed record with a required rejected gate before writing", async () => {
  const root = await commandWorkspace()
  const reviewResultPath = ".bob-process-runs/run-rejected/review-result.yaml"
  const record = await writeProcessRecordCommand({
    record: {
      schemaVersion: PROCESS_RECORD_SCHEMA_VERSION,
      campaignId: "campaign-alpha",
      runId: "run-rejected",
      workflowName: "process-common-review",
      phase: "common",
      status: "completed",
      inputPath: "process-input.yaml",
      artifactRoot: ".bob-process-runs/run-rejected",
      reviewResultPath,
      humanGate: { required: true, status: "rejected" }
    }
  }, { workspaceRoot: root })

  assert.equal(record.status, "error")
  assert.deepEqual(record.diagnostics, ["completed process record requires humanGate.status 'accepted' when humanGate.required is true"])
  await assert.rejects(
    fs.access(path.join(root, ".bob-process-records", "campaigns", "campaign-alpha", "records", "run-rejected", "record.yaml")),
    (error) => error?.code === "ENOENT"
  )
})

test("writeProcessRecordCommand permits non-completed audit records with a required rejected gate", async () => {
  const root = await commandWorkspace()
  const record = await writeProcessRecordCommand({
    record: {
      schemaVersion: PROCESS_RECORD_SCHEMA_VERSION,
      campaignId: "campaign-alpha",
      runId: "run-needs-rework",
      workflowName: "process-common-review",
      phase: "common",
      status: "needs_rework",
      inputPath: "process-input.yaml",
      artifactRoot: ".bob-process-runs/run-needs-rework",
      humanGate: { required: true, status: "rejected" }
    }
  }, { workspaceRoot: root })

  assert.equal(record.status, "ok", record.diagnostics.join("\n"))
  const written = yaml.load(await fs.readFile(path.join(root, record.relativePath), "utf8"))
  assert.equal(written.status, "needs_rework")
  assert.equal(written.humanGate.status, "rejected")
})

test("writeProcessRecordCommand rechecks a completed record review artifact immediately before writing", async () => {
  const root = await commandWorkspace()
  const reviewResultPath = ".bob-process-runs/run-missing-review/common-review/review-result.yaml"
  const record = await writeProcessRecordCommand({
    record: {
      schemaVersion: PROCESS_RECORD_SCHEMA_VERSION,
      campaignId: "campaign-alpha",
      runId: "run-missing-review",
      workflowName: "process-common-review",
      phase: "common",
      status: "completed",
      inputPath: "process-input.yaml",
      artifactRoot: ".bob-process-runs/run-missing-review",
      reviewResultPath,
      humanGate: { required: true, status: "accepted" }
    }
  }, { workspaceRoot: root })

  assert.equal(record.status, "error")
  assert.deepEqual(record.diagnostics, [
    `reviewResultPath: path does not exist or cannot be read (${reviewResultPath})`
  ])
  await assert.rejects(
    fs.access(path.join(root, ".bob-process-records", "campaigns", "campaign-alpha", "records", "run-missing-review", "record.yaml")),
    (error) => error?.code === "ENOENT"
  )
})
