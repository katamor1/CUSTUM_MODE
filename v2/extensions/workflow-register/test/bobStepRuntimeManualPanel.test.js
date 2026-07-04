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

function workflow(id = "workflow.manual") {
  return {
    id,
    label: "Manual Workflow",
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

test("completeStepByKey completes only the targeted active step", async () => {
  const { StepRuntime } = loadStepRuntime()
  const runtime = new StepRuntime()
  const first = heldTask()
  const second = heldTask()

  runtime.hold(workflow(), { id: "first", title: "First" }, first.task, { runId: "run-1" })
  runtime.hold(workflow(), { id: "second", title: "Second" }, second.task, { runId: "run-2" })
  const target = runtime.list().find((step) => step.stepId === "second")

  const message = await runtime.completeStepByKey(target.key)

  assert.match(message, /Completed: Manual Workflow \/ Second/)
  assert.equal(first.completed(), false)
  assert.equal(second.completed(), true)
  assert.deepEqual(runtime.list().map((step) => step.stepId), ["first"])
})

test("completeStepByKey returns a clear message when the active key is gone", async () => {
  const { StepRuntime } = loadStepRuntime()
  const runtime = new StepRuntime()

  const message = await runtime.completeStepByKey("missing-key")

  assert.match(message, /No active Bob workflow step for key: missing-key/)
})

test("completeStepByKeyResult returns structured success for the targeted active step", async () => {
  const { StepRuntime } = loadStepRuntime()
  const runtime = new StepRuntime()
  const first = heldTask()
  const second = heldTask()

  runtime.hold(workflow(), { id: "first", title: "First" }, first.task, { runId: "run-1" })
  runtime.hold(workflow(), { id: "second", title: "Second" }, second.task, { runId: "run-2" })
  const target = runtime.list().find((step) => step.stepId === "second")

  const result = await runtime.completeStepByKeyResult(target.key, {
    expectedRunId: "run-2",
    expectedStepId: "second"
  })

  assert.equal(result.ok, true)
  assert.match(result.message, /Completed: Manual Workflow \/ Second/)
  assert.equal(first.completed(), false)
  assert.equal(second.completed(), true)
  assert.deepEqual(runtime.list().map((step) => step.stepId), ["first"])
})

test("completeStepByKeyResult refuses expected run and step mismatches", async () => {
  const { StepRuntime } = loadStepRuntime()
  const runtime = new StepRuntime()
  const held = heldTask()

  runtime.hold(workflow(), { id: "check", title: "Check" }, held.task, { runId: "run-1" })
  const target = runtime.list()[0]

  const result = await runtime.completeStepByKeyResult(target.key, {
    expectedRunId: "run-2",
    expectedStepId: "check"
  })

  assert.equal(result.ok, false)
  assert.match(result.message, /Active Bob workflow step mismatch/)
  assert.equal(held.completed(), false)
  assert.deepEqual(runtime.list().map((step) => step.stepId), ["check"])
})

test("getActiveStep returns the active step for panel rendering without exposing the full list", () => {
  const { StepRuntime } = loadStepRuntime()
  const runtime = new StepRuntime()
  const held = heldTask()

  runtime.hold(workflow(), { id: "check", title: "Check" }, held.task, { runId: "run-1" })
  const active = runtime.list()[0]

  assert.equal(runtime.getActiveStep(active.key).stepId, "check")
  assert.equal(runtime.getActiveStep("missing-key"), undefined)
})
