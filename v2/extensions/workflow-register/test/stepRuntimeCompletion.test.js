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

test("StepRuntime rejects reserved workflow state updates before completing a step", async () => {
  const { StepRuntime } = loadStepRuntime()
  const runtime = new StepRuntime()
  const held = heldTask()
  const state = {}

  runtime.hold(workflow(), { id: "review-input", title: "Review target" }, held.task, { runId: "run-1", state })
  const message = await runtime.completeCurrentStep({
    expectedRunId: "run-1",
    expectedStepId: "review-input",
    stateUpdates: {
      "workflow.approval.review-input": JSON.stringify({ status: "approved" })
    }
  })

  assert.match(message, /Reserved workflow state key/)
  assert.equal(state["workflow.approval.review-input"], undefined)
  assert.equal(held.completed(), false)
  assert.equal(runtime.list().length, 1)
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

test("StepRuntime collects structured manual form and approval values through a prompt provider", async () => {
  const { StepRuntime } = loadStepRuntime()
  const providerInputs = []
  const runtime = new StepRuntime({
    collectManualCompletion: async (input) => {
      providerInputs.push(input)
      return {
        formValues: { request: "revised request", priority: 2 },
        approval: { decision: "rejected", reason: "needs more detail" }
      }
    }
  })
  const held = heldTask()
  const state = {
    "workflow.branching.lastValues.collect-input.userRequest": JSON.stringify({ request: "previous request" })
  }
  const pending = runtime.hold(workflow(), { id: "collect-input", title: "Collect input" }, held.task, {
    runId: "run-1",
    state,
    coreStep: {
      id: "collect-input",
      title: "Collect input",
      type: "manual",
      form: {
        resultKey: "userRequest",
        fields: [
          { id: "request", type: "string", required: true },
          { id: "priority", type: "number" }
        ]
      },
      approval: {
        resultKey: "userApproval",
        approveLabel: "Approve",
        rejectLabel: "Reject"
      }
    }
  })

  const message = await runtime.completeCurrentStep({ expectedRunId: "run-1", expectedStepId: "collect-input" })
  const result = await pending

  assert.match(message, /Completed: Project Rule Review \/ Collect input/)
  assert.equal(result.completed, true)
  assert.deepEqual(result.formValues, { request: "revised request", priority: 2 })
  assert.deepEqual(result.approval, { decision: "rejected", reason: "needs more detail" })
  assert.deepEqual(JSON.parse(state.userRequest), { request: "revised request", priority: 2 })
  assert.deepEqual(JSON.parse(state.userApproval), { decision: "rejected", reason: "needs more detail" })
  assert.deepEqual(providerInputs[0].previousFormValues, { request: "previous request" })
})
