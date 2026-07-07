const assert = require("node:assert/strict")
const { test } = require("node:test")

const { reconcileBobTaskSync, completedPrefixIndex } = require("../out/bobTaskSync.js")

function workflow() {
  return {
    id: "workflow-1",
    definitionHash: "hash-1",
    stepExecution: { mode: "engineSteps", allowOutOfOrder: false, showInBob: true },
    engineSteps: [
      { id: "collect", title: "Collect", type: "command" },
      { id: "draft", title: "Draft", type: "agent" },
      { id: "apply", title: "Apply", type: "command" }
    ]
  }
}

function run(statuses, sync) {
  return {
    runId: "run-1",
    workflowId: "workflow-1",
    workflowName: "Workflow 1",
    status: "running",
    currentStep: "draft",
    inputs: {},
    state: {},
    bobTaskSync: sync,
    steps: statuses.map((status, index) => ({
      id: ["collect", "draft", "apply"][index],
      title: ["Collect", "Draft", "Apply"][index],
      type: index === 1 ? "agent" : "command",
      status
    })),
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z"
  }
}

const now = () => "2026-07-07T00:00:01.000Z"

test("completedPrefixIndex returns the contiguous completed prefix", () => {
  assert.equal(completedPrefixIndex(run(["completed", "reviewing", "completed"])), 0)
  assert.equal(completedPrefixIndex(run(["pending", "completed", "completed"])), -1)
  assert.equal(completedPrefixIndex(run(["completed", "completed", "completed"])), 2)
})

test("reconcileBobTaskSync advances a live Bob task to the JSON completed prefix", () => {
  const target = run(["completed", "completed", "reviewing"])
  let completions = 0
  const result = reconcileBobTaskSync(target, workflow(), {
    reason: "operation-hub-next",
    now,
    task: { setStepComplete: () => { completions += 1 } }
  })
  assert.equal(result.status, "synced")
  assert.equal(result.appliedStepCount, 2)
  assert.equal(completions, 2)
  assert.equal(target.bobTaskSync.completedThroughIndex, 1)
  assert.equal(target.bobTaskSync.completedThroughStepId, "draft")
})

test("reconcileBobTaskSync records taskUnavailable without a live task", () => {
  const target = run(["completed", "reviewing", "pending"])
  const result = reconcileBobTaskSync(target, workflow(), { reason: "operation-hub-resume", now })
  assert.equal(result.status, "taskUnavailable")
  assert.equal(result.appliedStepCount, 0)
  assert.equal(target.bobTaskSync.completedThroughIndex, -1)
  assert.equal(target.bobTaskSync.drift.status, "taskUnavailable")
})

test("reconcileBobTaskSync does not rewind Bob Todo projection on retry", () => {
  const target = run(["completed", "pending", "pending"], {
    schemaVersion: "workflow-register/bob-task-sync/v1",
    projectionVersion: 1,
    completedThroughIndex: 1,
    completedThroughStepId: "draft"
  })
  const result = reconcileBobTaskSync(target, workflow(), {
    reason: "operation-hub-retry",
    now,
    task: { setStepComplete: () => { throw new Error("unexpected completion") } }
  })
  assert.equal(result.status, "requiresNewBobTask")
  assert.equal(target.bobTaskSync.completedThroughIndex, 1)
})

test("reconcileBobTaskSync can record an already-applied manual completion", () => {
  const target = run(["completed", "pending", "pending"])
  let completions = 0
  const result = reconcileBobTaskSync(target, workflow(), {
    reason: "manual-completed",
    now,
    alreadyApplied: true,
    task: { setStepComplete: () => { completions += 1 } }
  })
  assert.equal(result.status, "synced")
  assert.equal(result.appliedStepCount, 0)
  assert.equal(completions, 0)
  assert.equal(target.bobTaskSync.completedThroughStepId, "collect")
})
