const assert = require("node:assert/strict")
const Module = require("node:module")
const { test } = require("node:test")

function loadStepRuntime(vscodeMock = {}) {
  const modulePath = require.resolve("../out/bobStepRuntime.js")
  delete require.cache[modulePath]
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "vscode") {
      return {
        commands: { executeCommand: async () => undefined },
        window: {
          showErrorMessage: async () => undefined,
          showQuickPick: async () => undefined,
          ...vscodeMock.window
        },
        ...vscodeMock
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    return require(modulePath)
  } finally {
    Module._load = originalLoad
  }
}

function workflow(id = "workflow.review") {
  return {
    id,
    label: "Project Rule Review",
    guardrails: {}
  }
}

function heldTask() {
  let completed = false
  return {
    task: {
      setStepComplete: () => {
        completed = true
      }
    },
    completed: () => completed
  }
}

test("StepRuntime completes the active step only when expected run and step match", async () => {
  const { StepRuntime } = loadStepRuntime()
  const runtime = new StepRuntime()
  const held = heldTask()

  runtime.hold(workflow(), { id: "review-input", title: "Review target" }, held.task, { runId: "run-1" })
  const message = await runtime.completeCurrentStep({ expectedRunId: "run-1", expectedStepId: "review-input" })

  assert.match(message, /Completed: Project Rule Review \/ Review target/)
  assert.equal(held.completed(), true)
  assert.equal(runtime.list().length, 0)
})

test("StepRuntime refuses to complete a step when the expected run does not match", async () => {
  const { StepRuntime } = loadStepRuntime()
  const runtime = new StepRuntime()
  const held = heldTask()

  runtime.hold(workflow(), { id: "review-input", title: "Review target" }, held.task, { runId: "run-1" })
  const message = await runtime.completeCurrentStep({ expectedRunId: "run-2", expectedStepId: "review-input" })

  assert.match(message, /Active Bob workflow step mismatch/)
  assert.match(message, /expected runId=run-2/)
  assert.match(message, /active runId=run-1/)
  assert.equal(held.completed(), false)
  assert.equal(runtime.list().length, 1)
})

test("StepRuntime refuses to complete a step when the expected step does not match", async () => {
  const { StepRuntime } = loadStepRuntime()
  const runtime = new StepRuntime()
  const held = heldTask()

  runtime.hold(workflow(), { id: "review-input", title: "Review target" }, held.task, { runId: "run-1" })
  const message = await runtime.completeCurrentStep({ expectedRunId: "run-1", expectedStepId: "collect-context" })

  assert.match(message, /Active Bob workflow step mismatch/)
  assert.match(message, /stepId=collect-context/)
  assert.match(message, /active .*stepId=review-input/)
  assert.equal(held.completed(), false)
  assert.equal(runtime.list().length, 1)
})

test("StepRuntime applies completion state updates only after the expected step matches", async () => {
  const { StepRuntime } = loadStepRuntime()
  const runtime = new StepRuntime()
  const held = heldTask()
  const state = {}

  runtime.hold(workflow(), { id: "review-input", title: "Review target" }, held.task, { runId: "run-1", state })
  const message = await runtime.completeCurrentStep({
    expectedRunId: "run-1",
    expectedStepId: "review-input",
    stateUpdates: {
      "bobBazaar.reviewPacket": JSON.stringify({ packetUri: "untitled:packet-1", runId: "run-1" })
    }
  })

  assert.match(message, /Completed: Project Rule Review \/ Review target/)
  assert.deepEqual(JSON.parse(state["bobBazaar.reviewPacket"]), { packetUri: "untitled:packet-1", runId: "run-1" })
})

test("StepRuntime does not apply completion state updates when the expected step mismatches", async () => {
  const { StepRuntime } = loadStepRuntime()
  const runtime = new StepRuntime()
  const held = heldTask()
  const state = {}

  runtime.hold(workflow(), { id: "review-input", title: "Review target" }, held.task, { runId: "run-1", state })
  const message = await runtime.completeCurrentStep({
    expectedRunId: "run-2",
    expectedStepId: "review-input",
    stateUpdates: {
      "bobBazaar.reviewPacket": JSON.stringify({ packetUri: "untitled:packet-1", runId: "run-2" })
    }
  })

  assert.match(message, /Active Bob workflow step mismatch/)
  assert.equal(state["bobBazaar.reviewPacket"], undefined)
  assert.equal(held.completed(), false)
})
