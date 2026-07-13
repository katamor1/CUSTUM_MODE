const assert = require("node:assert/strict")
const fs = require("node:fs")
const fsp = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const {
  CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION,
  FileRunStateStore
} = require("../out/core/runStateStore.js")

const fixtureRoot = path.join(__dirname, "fixtures", "run-state")

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "workflow-run-state-migration-"))
}

function readFixture(name) {
  return fs.readFileSync(path.join(fixtureRoot, name), "utf8")
}

function parseFixture(name) {
  return JSON.parse(readFixture(name))
}

function runDirectory(root, runId) {
  return path.join(root, ".bob", "workflows", "runs", runId)
}

function runFile(root, runId) {
  return path.join(runDirectory(root, runId), "run.json")
}

function backupFile(root, runId) {
  return path.join(runDirectory(root, runId), "run-state-v0.backup.json")
}

async function writeRunDocument(root, runId, content) {
  await fsp.mkdir(runDirectory(root, runId), { recursive: true })
  await fsp.writeFile(runFile(root, runId), content, "utf8")
}

function workflow() {
  return {
    id: "workflow-register.history",
    name: "history",
    label: "History",
    menuLabel: "History",
    description: "Historical workflow.",
    schemaVersion: "workflow-register/v1",
    definitionHash: "sha256:history",
    filePath: ".bob/workflows/history/WORKFLOW.md",
    inputs: { revision: { type: "string", required: true } },
    engineSteps: [
      { id: "review", title: "Review", type: "manual" }
    ]
  }
}

test("new and saved workflow runs persist the current run-state schema", async (t) => {
  const root = tempRoot()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const store = new FileRunStateStore({
    workspaceRoot: root,
    now: () => "2026-07-12T00:00:00.000Z",
    engineVersion: "test-engine"
  })

  const run = await store.createRun(workflow(), { revision: "abc123" })
  assert.equal(run.schemaVersion, CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION)

  delete run.schemaVersion
  await store.saveRun(run)
  const persisted = JSON.parse(fs.readFileSync(runFile(root, run.runId), "utf8"))

  assert.equal(run.schemaVersion, CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION)
  assert.equal(persisted.schemaVersion, CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION)
})

test("loading an unversioned run backs up exact bytes and migrates without changing updatedAt", async (t) => {
  const root = tempRoot()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const historicalBytes = readFixture("v0-basic.json")
  const historical = JSON.parse(historicalBytes)
  await writeRunDocument(root, historical.runId, historicalBytes)
  const store = new FileRunStateStore({ workspaceRoot: root, now: () => "2099-01-01T00:00:00.000Z" })

  const first = await store.loadRun(historical.runId)
  const migratedBytes = fs.readFileSync(runFile(root, historical.runId), "utf8")
  const migrated = JSON.parse(migratedBytes)

  assert.equal(first.schemaVersion, CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION)
  assert.equal(first.updatedAt, historical.updatedAt)
  assert.equal(fs.readFileSync(backupFile(root, historical.runId), "utf8"), historicalBytes)
  assert.equal(migrated.schemaVersion, CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION)
  assert.equal(migrated.updatedAt, historical.updatedAt)
  assert.deepEqual(
    Object.fromEntries(Object.entries(migrated).filter(([key]) => key !== "schemaVersion")),
    historical
  )

  const second = await store.loadRun(historical.runId)
  assert.deepEqual(second, first)
  assert.equal(fs.readFileSync(backupFile(root, historical.runId), "utf8"), historicalBytes)
  assert.deepEqual(store.getLoadDiagnostics(), [{
    runId: historical.runId,
    severity: "info",
    code: "migrated",
    message: `Migrated unversioned workflow run state to '${CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION}'.`
  }])
})

test("a matching backup resumes migration while a conflicting backup blocks replacement", async (t) => {
  const root = tempRoot()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const historicalBytes = readFixture("v0-basic.json")
  const historical = JSON.parse(historicalBytes)
  await writeRunDocument(root, historical.runId, historicalBytes)
  fs.writeFileSync(backupFile(root, historical.runId), historicalBytes, "utf8")
  const store = new FileRunStateStore({ workspaceRoot: root })

  const resumed = await store.loadRun(historical.runId)
  assert.equal(resumed.schemaVersion, CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION)

  const conflictingId = "20260712T000000Z-conflicting-000000000002"
  const conflicting = { ...historical, runId: conflictingId }
  const conflictingBytes = `${JSON.stringify(conflicting, null, 2)}\n`
  await writeRunDocument(root, conflictingId, conflictingBytes)
  fs.writeFileSync(backupFile(root, conflictingId), "different historical bytes\n", "utf8")

  await assert.rejects(
    store.loadRun(conflictingId),
    /migration backup conflicts with the current unversioned run/
  )
  assert.equal(fs.readFileSync(runFile(root, conflictingId), "utf8"), conflictingBytes)
})

test("future run-state versions load read-only and are excluded from recovery", async (t) => {
  const root = tempRoot()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const future = {
    ...parseFixture("v1-basic.json"),
    schemaVersion: "workflow-register/run-state/v2",
    status: "running"
  }
  const bytes = `${JSON.stringify(future, null, 2)}\n`
  await writeRunDocument(root, future.runId, bytes)
  const store = new FileRunStateStore({ workspaceRoot: root })

  const loaded = await store.loadRun(future.runId)
  assert.equal(loaded.schemaVersion, "workflow-register/run-state/v2")
  await assert.rejects(store.saveRun(loaded), /read-only schemaVersion/)
  assert.equal(fs.readFileSync(runFile(root, future.runId), "utf8"), bytes)
  assert.equal(
    await store.findRecoverableRun(workflow(), { revision: "abc123" }),
    undefined
  )
  assert.deepEqual(store.getLoadDiagnostics(), [{
    runId: future.runId,
    severity: "warning",
    code: "read-only",
    message: `Workflow run state schemaVersion 'workflow-register/run-state/v2' is newer than supported '${CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION}' and was loaded read-only.`
  }])
})

test("workflow engine rejects a future run before clearing pause state", async (t) => {
  const root = tempRoot()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const future = {
    ...parseFixture("v1-basic.json"),
    schemaVersion: "workflow-register/run-state/v2",
    status: "paused",
    currentStep: "review",
    steps: [{ id: "review", title: "Review", type: "manual", status: "pending" }]
  }
  const bytes = `${JSON.stringify(future, null, 2)}\n`
  await writeRunDocument(root, future.runId, bytes)
  const store = new FileRunStateStore({ workspaceRoot: root })
  const { ActionRegistry } = require("../out/core/actionRegistry.js")
  const { WorkflowEngine } = require("../out/core/engine.js")
  const { ResultSinkRegistry } = require("../out/core/resultSinkRegistry.js")
  let clearPauseCalls = 0
  const engine = new WorkflowEngine({
    actions: new ActionRegistry(),
    resultSinks: new ResultSinkRegistry(),
    runStore: store,
    runControlStore: {
      clearPause: async () => { clearPauseCalls += 1 }
    }
  })

  await assert.rejects(
    engine.resumeRun(future.runId, { workflow: workflow() }),
    /read-only schemaVersion 'workflow-register\/run-state\/v2'/
  )

  assert.equal(clearPauseCalls, 0)
  assert.equal(fs.readFileSync(runFile(root, future.runId), "utf8"), bytes)
})

test("listRuns isolates malformed and missing run documents with stable diagnostics", async (t) => {
  const root = tempRoot()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const valid = parseFixture("v1-basic.json")
  await writeRunDocument(root, valid.runId, `${JSON.stringify(valid, null, 2)}\n`)
  const invalidId = "20260712T000000Z-invalid-000000000003"
  await writeRunDocument(root, invalidId, "{ not valid json\n")
  const malformedId = "20260712T000000Z-malformed-000000000004"
  await writeRunDocument(root, malformedId, `${JSON.stringify({ runId: malformedId }, null, 2)}\n`)
  const missingId = "20260712T000000Z-missing-000000000005"
  await fsp.mkdir(runDirectory(root, missingId), { recursive: true })
  const store = new FileRunStateStore({ workspaceRoot: root })

  const runs = await store.listRuns()
  const diagnostics = store.getLoadDiagnostics()
  assert.deepEqual(runs.map((run) => run.runId), [valid.runId])
  assert.deepEqual(
    diagnostics.map(({ runId, severity, code }) => ({ runId, severity, code })),
    [
      { runId: invalidId, severity: "error", code: "invalid" },
      { runId: malformedId, severity: "error", code: "invalid" },
      { runId: missingId, severity: "error", code: "invalid" }
    ]
  )
  assert.match(diagnostics[0].message, /contains invalid JSON/)
  assert.match(diagnostics[1].message, /field 'workflowId'/)
  assert.equal(diagnostics[2].message, `Workflow run '${missingId}' is missing run.json.`)
  await assert.rejects(store.loadRun(invalidId), /contains invalid JSON/)
})

test("migration I/O ENOENT is reported instead of being mistaken for a missing run", async (t) => {
  const root = tempRoot()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const historicalBytes = readFixture("v0-basic.json")
  const historical = JSON.parse(historicalBytes)
  await writeRunDocument(root, historical.runId, historicalBytes)
  const store = new FileRunStateStore({ workspaceRoot: root })
  const originalLink = fsp.link
  fsp.link = async () => {
    const error = new Error("simulated backup publication disappearance")
    error.code = "ENOENT"
    throw error
  }

  try {
    await assert.rejects(
      store.loadRun(historical.runId),
      /simulated backup publication disappearance/
    )
  } finally {
    fsp.link = originalLink
  }

  assert.equal(fs.readFileSync(runFile(root, historical.runId), "utf8"), historicalBytes)
  assert.deepEqual(store.getLoadDiagnostics(), [{
    runId: historical.runId,
    severity: "error",
    code: "invalid",
    message: "simulated backup publication disappearance"
  }])
})
