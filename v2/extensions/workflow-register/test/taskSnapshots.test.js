const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "workflow-register-snapshots-"))
}

function snapshot(overrides = {}) {
  return {
    schemaVersion: "workflow-register/task-snapshot/v1",
    createdAt: "2026-06-30T00:00:00.000Z",
    reason: "step-start",
    runId: "run-1",
    workflowId: "workflow-register.snapshot",
    logicalWorkflowId: "snapshot",
    workflowDefinitionHash: "hash-1",
    stepId: "collect",
    runStatus: "running",
    runCurrentStep: "collect",
    taskMetadata: { inputs: { revision: "77" } },
    messages: [
      { role: "user", content: "start" },
      { role: "assistant", content: "analysis" }
    ],
    lastAssistantText: "analysis",
    handoff: undefined,
    ...overrides
  }
}

test("file task snapshot store writes snapshots, latest.json, and summaries", async () => {
  const { FileTaskSnapshotStore } = require("../out/core/taskSnapshots")

  const workspaceRoot = tempDir()
  const store = new FileTaskSnapshotStore({ workspaceRoot, now: () => "2026-06-30T00:00:00.000Z" })
  const saved = await store.saveSnapshot(snapshot({ reason: "workflow-start" }))
  const latest = await store.loadLatest("run-1")
  const summaries = await store.listSnapshots("run-1")

  assert.match(saved.path, /task-snapshots/)
  assert.equal(latest.reason, "workflow-start")
  assert.equal(latest.lastAssistantText, "analysis")
  assert.equal(summaries.length, 1)
  assert.equal(summaries[0].reason, "workflow-start")
  assert.equal(summaries[0].hasLastAssistantText, true)
  assert.ok(fs.existsSync(path.join(workspaceRoot, ".bob", "workflows", "runs", "run-1", "task-snapshots", "latest.json")))
})

test("file task snapshot store truncates oversized messages and prunes old snapshots", async () => {
  const { FileTaskSnapshotStore } = require("../out/core/taskSnapshots")

  const workspaceRoot = tempDir()
  let tick = 0
  const store = new FileTaskSnapshotStore({
    workspaceRoot,
    now: () => `2026-06-30T00:00:0${tick++}.000Z`,
    maxBytes: 700,
    maxPerRun: 2,
    pruneOnSave: true
  })

  await store.saveSnapshot(snapshot({ reason: "workflow-start", messages: [{ role: "assistant", content: "x".repeat(1200) }], lastAssistantText: "x".repeat(1200) }))
  await store.saveSnapshot(snapshot({ reason: "step-start", stepId: "collect" }))
  await store.saveSnapshot(snapshot({ reason: "agent-output", stepId: "analyze", lastAssistantText: "fresh output" }))
  const summaries = await store.listSnapshots("run-1")
  const latest = await store.loadLatest("run-1")

  assert.equal(summaries.length, 2)
  assert.equal(summaries.map((item) => item.reason).join(","), "step-start,agent-output")
  assert.equal(latest.reason, "agent-output")
  assert.equal(latest.lastAssistantText, "fresh output")
})
