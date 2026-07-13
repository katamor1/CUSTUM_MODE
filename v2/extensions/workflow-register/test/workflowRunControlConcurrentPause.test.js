const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { FileRunControlStore } = require("../out/core/runControlStore.js")
const { FileRunStateStore } = require("../out/core/runStateStore.js")
const { withWorkflowRunLock } = require("../out/core/runtime/runLock.js")

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function workflow() {
  return {
    id: "workflow.concurrent-pause",
    name: "concurrent-pause",
    schemaVersion: "workflow-register/v1",
    engineSteps: [{ id: "step-1", title: "Step 1", type: "manual" }]
  }
}

test("pause requests remain writable while another process-equivalent execution lease is active", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-concurrent-pause-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const store = new FileRunStateStore({ workspaceRoot: root, lockOptions: { heartbeatMs: 0 } })
  const run = await store.createRun(workflow(), {})
  await store.saveRun(run)

  const started = deferred()
  const release = deferred()
  const owner = withWorkflowRunLock(root, run.runId, async () => {
    started.resolve()
    await release.promise
  }, { timeoutMs: 1_000, heartbeatMs: 0 })
  await started.promise

  try {
    const controlStore = new FileRunControlStore({
      workspaceRoot: root,
      now: () => "2026-07-12T00:02:00.000Z",
      lockOptions: { timeoutMs: 50, heartbeatMs: 0 }
    })
    const control = await controlStore.requestPause({
      runId: run.runId,
      mode: "afterCurrentStep",
      reason: "operator-request"
    })
    assert.equal(control.pauseRequestedAt, "2026-07-12T00:02:00.000Z")
    assert.equal(await controlStore.isPauseRequested(run.runId), true)
  } finally {
    release.resolve()
    await owner
  }
})
