const assert = require("node:assert/strict")
const { test } = require("node:test")

const { ActionRegistry } = require("../out/core/actionRegistry.js")
const { WorkflowEngine } = require("../out/core/engine.js")
const { ResultSinkRegistry } = require("../out/core/resultSinkRegistry.js")

function workflow() {
  return {
    id: "workflow.checkpoint-lease",
    name: "checkpoint-lease",
    schemaVersion: "workflow-register/v1",
    engineSteps: []
  }
}

function harness() {
  let leaseDepth = 0
  let loads = 0
  const runStore = {
    workspaceRoot: "/workspace",
    createRun: async () => { throw new Error("not used") },
    saveRun: async () => { throw new Error("not used") },
    listRuns: async () => [],
    loadRun: async () => {
      loads += 1
      assert.equal(leaseDepth, 1, "checkpoint loads must execute inside the cross-process lease")
      return undefined
    },
    withRunLock: async (_runId, operation) => {
      assert.equal(leaseDepth, 0)
      leaseDepth += 1
      try {
        return await operation()
      } finally {
        leaseDepth -= 1
      }
    }
  }
  const engine = new WorkflowEngine({
    actions: new ActionRegistry(),
    resultSinks: new ResultSinkRegistry(),
    runStore
  })
  return { engine, loads: () => loads }
}

test("checkpoint approval and abort acquire the run lease before inspecting state", async () => {
  const approval = harness()
  await assert.rejects(approval.engine.approveBranchCheckpoint("run-1", workflow()), /not found/)
  assert.equal(approval.loads(), 2)

  const abort = harness()
  await assert.rejects(abort.engine.abortBranchCheckpoint("run-1", "operator abort"), /not found/)
  assert.equal(abort.loads(), 2)
})
