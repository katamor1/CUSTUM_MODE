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

function taskExport(completedThroughIndex) {
  return {
    todos: workflow().engineSteps.map((step, index) => ({
      id: step.id,
      title: step.title,
      completed: index <= completedThroughIndex
    }))
  }
}

const now = () => "2026-07-07T00:00:01.000Z"

test("completedPrefixIndex returns the contiguous completed prefix", () => {
  assert.equal(completedPrefixIndex(run(["completed", "reviewing", "completed"])), 0)
  assert.equal(completedPrefixIndex(run(["pending", "completed", "completed"])), -1)
  assert.equal(completedPrefixIndex(run(["completed", "completed", "completed"])), 2)
})

test("reconcileBobTaskSync advances a live Bob task to the JSON completed prefix", async () => {
  const target = run(["completed", "completed", "reviewing"])
  let completions = 0
  const result = await reconcileBobTaskSync(target, workflow(), {
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

test("reconcileBobTaskSync waits for async Bob task completion before updating projection", async () => {
  const target = run(["completed", "reviewing", "pending"])
  let pending = true
  const result = await reconcileBobTaskSync(target, workflow(), {
    reason: "review-accepted",
    now,
    task: {
      setStepComplete: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        pending = false
      }
    }
  })
  assert.equal(pending, false)
  assert.equal(result.status, "synced")
  assert.equal(result.appliedStepCount, 1)
  assert.equal(target.bobTaskSync.completedThroughIndex, 0)
})

test("reconcileBobTaskSync trusts task export projection over a stale stored projection", async () => {
  const target = run(["completed", "completed", "reviewing"], {
    schemaVersion: "workflow-register/bob-task-sync/v1",
    projectionVersion: 1,
    completedThroughIndex: 2,
    completedThroughStepId: "apply"
  })
  let completions = 0
  let taskProjection = 0
  const result = await reconcileBobTaskSync(target, workflow(), {
    reason: "operation-hub-next",
    now,
    task: {
      setStepComplete: () => {
        completions += 1
        taskProjection += 1
      },
      toSerializable: () => taskExport(taskProjection)
    }
  })

  assert.equal(result.status, "synced")
  assert.equal(result.appliedStepCount, 1)
  assert.equal(completions, 1)
  assert.equal(target.bobTaskSync.completedThroughIndex, 1)
  assert.equal(target.bobTaskSync.completedThroughStepId, "draft")
})

test("reconcileBobTaskSync reports repairFailed when task export projection does not advance", async () => {
  const target = run(["completed", "completed", "reviewing"])
  let completions = 0
  const result = await reconcileBobTaskSync(target, workflow(), {
    reason: "operation-hub-next",
    now,
    task: {
      setStepComplete: () => { completions += 1 },
      toSerializable: () => taskExport(0)
    }
  })

  assert.equal(result.status, "repairFailed")
  assert.equal(result.appliedStepCount, 0)
  assert.equal(completions, 1)
  assert.equal(target.bobTaskSync.completedThroughIndex, 0)
  assert.match(target.bobTaskSync.drift.details, /task export still reports/i)
})

test("reconcileBobTaskSync records taskUnavailable without a live task", async () => {
  const target = run(["completed", "reviewing", "pending"])
  const result = await reconcileBobTaskSync(target, workflow(), { reason: "operation-hub-resume", now })
  assert.equal(result.status, "taskUnavailable")
  assert.equal(result.appliedStepCount, 0)
  assert.equal(target.bobTaskSync.completedThroughIndex, -1)
  assert.equal(target.bobTaskSync.drift.status, "taskUnavailable")
})

test("reconcileBobTaskSync does not rewind Bob Todo projection on retry", async () => {
  const target = run(["completed", "pending", "pending"], {
    schemaVersion: "workflow-register/bob-task-sync/v1",
    projectionVersion: 1,
    completedThroughIndex: 1,
    completedThroughStepId: "draft"
  })
  const result = await reconcileBobTaskSync(target, workflow(), {
    reason: "operation-hub-retry",
    now,
    task: { setStepComplete: () => { throw new Error("unexpected completion") } }
  })
  assert.equal(result.status, "requiresNewBobTask")
  assert.equal(target.bobTaskSync.completedThroughIndex, 1)
})

test("reconcileBobTaskSync can record an already-applied manual completion", async () => {
  const target = run(["completed", "pending", "pending"])
  let completions = 0
  const result = await reconcileBobTaskSync(target, workflow(), {
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
