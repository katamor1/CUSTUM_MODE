const assert = require("node:assert/strict")
const { test } = require("node:test")

test("runAgent result handoff executes the result command through an action registry", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { executeResultHandoff, resultSourceForStep } = require("../out/resultHandoff")
  const calls = []
  const actions = new ActionRegistry()
  actions.register({
    id: "bobBazaar.captureReviewResult",
    execute: (input) => {
      calls.push(input)
      return { status: "ok" }
    }
  })
  const step = {
    captureResult: true,
    runAgent: true,
    resultCommand: "bobBazaar.captureReviewResult",
    resultCommandArgs: ["extra"]
  }

  const result = await executeResultHandoff(step, "agent result json", {
    actions,
    inputs: { revision: "1234" },
    state: { reviewContext: "context" },
    workflowId: "workflow",
    runId: "run",
    stepId: "output-result"
  })

  assert.equal(resultSourceForStep(step), "agent")
  assert.equal(result.ok, true)
  assert.equal(result.command, "bobBazaar.captureReviewResult")
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args, ["agent result json", "extra"])
  assert.deepEqual(calls[0].inputs, { revision: "1234" })
  assert.deepEqual(calls[0].state, { reviewContext: "context" })
  assert.equal(calls[0].workflowId, "workflow")
  assert.equal(calls[0].runId, "run")
  assert.equal(calls[0].stepId, "output-result")
  assert.equal(calls[0].latestAssistantText, "agent result json")
  assert.equal(calls[0].resultText, "agent result json")
  assert.equal(calls[0].artifactText, "agent result json")
})

test("result handoff trims generated artifact text before passing it to providers", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { executeResultHandoff } = require("../out/resultHandoff")
  let captured
  const actions = new ActionRegistry()
  actions.register({
    id: "example.capture",
    execute: (input) => {
      captured = input
      return { status: "ok" }
    }
  })

  const result = await executeResultHandoff({
    captureResult: true,
    runAgent: false,
    resultCommand: "example.capture"
  }, "\n\n  generated artifact  \n", { actions })

  assert.equal(result.ok, true)
  assert.deepEqual(captured.args, ["generated artifact"])
  assert.equal(captured.latestAssistantText, "generated artifact")
  assert.equal(captured.resultText, "generated artifact")
  assert.equal(captured.artifactText, "generated artifact")
})

test("result handoff can recover missing artifact text from a resolver", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { executeResultHandoff } = require("../out/resultHandoff")
  let captured
  const actions = new ActionRegistry()
  actions.register({
    id: "example.capture",
    execute: (input) => {
      captured = input
      return { status: "ok" }
    }
  })

  const result = await executeResultHandoff({
    captureResult: true,
    runAgent: true,
    resultCommand: "example.capture"
  }, undefined, {
    actions,
    workflowId: "workflow",
    runId: "run-1",
    stepId: "analyze",
    recoverResultText: async (input) => {
      assert.equal(input.workflowId, "workflow")
      assert.equal(input.runId, "run-1")
      assert.equal(input.stepId, "analyze")
      assert.equal(input.reason, "missing-result-text")
      return "recovered output"
    }
  })

  assert.equal(result.ok, true)
  assert.deepEqual(captured.args, ["recovered output"])
  assert.equal(captured.runId, "run-1")
  assert.equal(captured.stepId, "analyze")
  assert.equal(captured.latestAssistantText, "recovered output")
})

test("result handoff preserves a legacy executeCommand fallback through action registry", async () => {
  const { executeResultHandoff } = require("../out/resultHandoff")
  const calls = []
  const result = await executeResultHandoff({
    captureResult: true,
    runAgent: true,
    resultCommand: "bobBazaar.captureReviewResult",
    resultCommandArgs: ["extra"]
  }, "agent result json", {
    executeCommand: async (...args) => {
      calls.push(args)
      return { status: "ok" }
    }
  })

  assert.equal(result.ok, true)
  assert.deepEqual(calls, [["bobBazaar.captureReviewResult", "agent result json", "extra"]])
})

test("result handoff is skipped when captureResult is not enabled", async () => {
  const { executeResultHandoff } = require("../out/resultHandoff")
  const calls = []

  const result = await executeResultHandoff({ captureResult: false, runAgent: true }, "unused", {
    executeCommand: async (...args) => calls.push(args)
  })

  assert.equal(result.ok, true)
  assert.equal(result.skipped, true)
  assert.deepEqual(calls, [])
})

test("missing result command providers are reported as action failures", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { executeResultHandoff } = require("../out/resultHandoff")

  const result = await executeResultHandoff({
    captureResult: true,
    runAgent: true,
    resultCommand: "example.missingResultProvider"
  }, "agent result", {
    actions: new ActionRegistry()
  })

  assert.equal(result.ok, false)
  assert.match(result.error, /Unsupported action provider/)
})

test("result handoff fails when the result command reports validation failure", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { executeResultHandoff } = require("../out/resultHandoff")
  const actions = new ActionRegistry()
  actions.register({
    id: "bobBazaar.captureReviewResult",
    execute: () => ({
      status: "error",
      issueCount: 1,
      issues: [{ path: "$.vcs", message: "Missing required object." }]
    })
  })

  const result = await executeResultHandoff({
    captureResult: true,
    runAgent: true,
    resultCommand: "bobBazaar.captureReviewResult"
  }, "invalid json", { actions })

  assert.equal(result.ok, false)
  assert.match(result.error, /result command reported an error/)
  assert.match(result.error, /\$\.vcs/)
})

test("last assistant extraction reads only assistant messages after the step start index", () => {
  const { extractLastAssistantText, resultSourceForStep } = require("../out/resultHandoff")
  const messages = [
    { role: "assistant", content: "previous step" },
    { role: "user", content: "current step prompt" },
    { role: "assistant", content: "first answer" },
    { role: "assistant", content: "final answer" }
  ]

  assert.equal(resultSourceForStep({ captureResult: true, runAgent: false }), "lastAssistant")
  assert.equal(extractLastAssistantText(messages, 1), "final answer")
})
