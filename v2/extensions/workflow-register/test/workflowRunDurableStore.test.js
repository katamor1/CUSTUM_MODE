const assert = require("node:assert/strict")
const fs = require("node:fs")
const fsp = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { FileRunStateStore } = require("../out/core/runStateStore.js")
const { readWorkflowRunEventLog } = require("../out/core/runtime/runEventLog.js")
const { readWorkflowRunJournal } = require("../out/core/runtime/runStateJournal.js")
const { readRunDurabilityFile } = require("../out/core/runtime/runDurabilityPath.js")

function root(t) {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-durable-store-"))
  t.after(() => fs.rmSync(value, { recursive: true, force: true }))
  return value
}

function workflow() {
  return {
    id: "workflow.test",
    name: "test",
    schemaVersion: "workflow-register/v1",
    definitionHash: "sha256:def",
    filePath: ".bob/workflows/test/WORKFLOW.md",
    engineSteps: [{ id: "step-1", title: "Step 1", type: "manual" }]
  }
}

function clock(...values) {
  let index = 0
  return () => values[Math.min(index++, values.length - 1)]
}

test("store commits run state with an immutable event and clears operational files", async (t) => {
  const workspace = root(t)
  const store = new FileRunStateStore({
    workspaceRoot: workspace,
    now: clock("2026-07-12T00:00:00.000Z", "2026-07-12T00:01:00.000Z", "2026-07-12T00:02:00.000Z"),
    lockOptions: { heartbeatMs: 0 }
  })
  const run = await store.createRun(workflow(), {})
  await store.saveRun(run)
  run.status = "paused"
  await store.saveRun(run)

  const events = await readWorkflowRunEventLog(workspace, run.runId)
  assert.deepEqual(events.events.map((event) => event.kind), ["run.created", "run.updated"])
  assert.equal(events.events[1].previousEventHash, events.events[0].hash)
  assert.equal(events.events[1].snapshot.status, "paused")
  assert.equal(await readWorkflowRunJournal(workspace, run.runId), undefined)
  assert.equal(await readRunDurabilityFile(workspace, run.runId, "run.lock.json"), undefined)
})

test("store recovers each injected crash point without duplicate events", async (t) => {
  for (const stage of ["afterJournal", "afterRun", "afterEvent"]) {
    await t.test(stage, async (t) => {
      const workspace = root(t)
      const base = new FileRunStateStore({
        workspaceRoot: workspace,
        now: clock("2026-07-12T00:00:00.000Z", "2026-07-12T00:01:00.000Z"),
        lockOptions: { heartbeatMs: 0 }
      })
      const run = await base.createRun(workflow(), {})
      await base.saveRun(run)
      const oldUpdatedAt = run.updatedAt
      const crashing = new FileRunStateStore({
        workspaceRoot: workspace,
        now: () => "2026-07-12T00:02:00.000Z",
        lockOptions: { heartbeatMs: 0 },
        durabilityFault: (point) => {
          if (point === stage) throw new Error(`crash:${stage}`)
        }
      })
      const loaded = await crashing.loadRun(run.runId)
      loaded.status = "paused"
      await assert.rejects(crashing.saveRun(loaded), new RegExp(`crash:${stage}`))
      assert.equal(loaded.updatedAt, oldUpdatedAt)
      assert.ok(await readWorkflowRunJournal(workspace, run.runId))

      const recovery = new FileRunStateStore({ workspaceRoot: workspace, lockOptions: { heartbeatMs: 0 } })
      const recovered = await recovery.loadRun(run.runId)
      assert.equal(recovered.status, "paused")
      assert.equal(recovered.updatedAt, "2026-07-12T00:02:00.000Z")
      assert.equal((await readWorkflowRunEventLog(workspace, run.runId)).events.length, 2)
      assert.equal(await readWorkflowRunJournal(workspace, run.runId), undefined)
    })
  }
})

test("stale loaded state cannot overwrite a newer committed revision", async (t) => {
  const workspace = root(t)
  const createStore = new FileRunStateStore({
    workspaceRoot: workspace,
    now: clock("2026-07-12T00:00:00.000Z", "2026-07-12T00:01:00.000Z"),
    lockOptions: { heartbeatMs: 0 }
  })
  const created = await createStore.createRun(workflow(), {})
  await createStore.saveRun(created)

  const storeA = new FileRunStateStore({ workspaceRoot: workspace, now: () => "2026-07-12T00:02:00.000Z", lockOptions: { heartbeatMs: 0 } })
  const storeB = new FileRunStateStore({ workspaceRoot: workspace, now: () => "2026-07-12T00:03:00.000Z", lockOptions: { heartbeatMs: 0 } })
  const runA = await storeA.loadRun(created.runId)
  const runB = await storeB.loadRun(created.runId)
  runA.state.winner = "A"
  await storeA.saveRun(runA)
  runB.state.winner = "B"
  await assert.rejects(storeB.saveRun(runB), /stale.*revision|changed since it was loaded/i)

  const finalRun = await new FileRunStateStore({ workspaceRoot: workspace, lockOptions: { heartbeatMs: 0 } }).loadRun(created.runId)
  assert.equal(finalRun.state.winner, "A")
  assert.equal((await readWorkflowRunEventLog(workspace, created.runId)).events.length, 2)
  assert.equal(await readWorkflowRunJournal(workspace, created.runId), undefined)
})

test("unversioned migration is backup-first, journaled, and emits one migration event", async (t) => {
  const workspace = root(t)
  const runId = "legacy-run"
  const directory = path.join(workspace, ".bob", "workflows", "runs", runId)
  await fsp.mkdir(directory, { recursive: true })
  const legacy = {
    runId,
    workflowId: "workflow.test",
    workflowName: "test",
    status: "paused",
    currentStep: "step-1",
    inputs: {},
    state: {},
    steps: [{ id: "step-1", title: "Step 1", type: "manual", status: "held" }],
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:01:00.000Z"
  }
  const bytes = `${JSON.stringify(legacy, null, 2)}\n`
  await fsp.writeFile(path.join(directory, "run.json"), bytes)
  const store = new FileRunStateStore({ workspaceRoot: workspace, lockOptions: { heartbeatMs: 0 } })

  const migrated = await store.loadRun(runId)
  assert.equal(migrated.schemaVersion, "workflow-register/run-state/v1")
  assert.equal(migrated.updatedAt, legacy.updatedAt)
  assert.equal(await fsp.readFile(path.join(directory, "run-state-v0.backup.json"), "utf8"), bytes)
  const events = await readWorkflowRunEventLog(workspace, runId)
  assert.deepEqual(events.events.map((event) => event.kind), ["run.migrated"])
})
