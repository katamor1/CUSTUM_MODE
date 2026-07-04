const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")
const { tempDir } = require("./helpers/workflowEngineFixtures")

const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")

test("result sink registry writes command and file sinks with allowlist enforcement", async () => {
  const workspaceRoot = tempDir()
  const calls = []
  const registry = createDefaultResultSinkRegistry({
    workspaceRoot,
    executeCommand: async (...args) => {
      calls.push(args)
      return { status: "ok" }
    },
    allowedCommandSinks: ["bobBazaar.captureReviewResult"]
  })

  const commandResult = await registry.write({
    type: "command",
    command: "bobBazaar.captureReviewResult",
    args: ["extra"]
  }, {
    workflowId: "workflow-register.sample",
    logicalWorkflowId: "workflow-register.sample",
    workflowRoot: workspaceRoot,
    runId: "run-1",
    stepId: "save",
    inputs: { revision: "77" },
    state: { reviewContext: "{\"ok\":true}" },
    text: "{\"ok\":true}"
  })
  const rejected = await registry.write({
    type: "command",
    command: "workbench.action.files.save"
  }, {
    workflowId: "workflow-register.sample",
    runId: "run-1",
    stepId: "save",
    text: "unused"
  })
  const fileResult = await registry.write({
    type: "file",
    path: ".bob/workflows/runs/{{run.id}}/steps/{{step.id}}.result.json"
  }, {
    workflowId: "workflow-register.sample",
    runId: "run-1",
    stepId: "save",
    text: "{\"ok\":true}"
  })

  assert.equal(commandResult.ok, true)
  assert.deepEqual(calls[0].slice(0, 3), ["bobBazaar.captureReviewResult", "{\"ok\":true}", "extra"])
  assert.deepEqual(calls[0][3], {
    workflowId: "workflow-register.sample",
    logicalWorkflowId: "workflow-register.sample",
    workflowRoot: workspaceRoot,
    runId: "run-1",
    stepId: "save",
    inputs: { revision: "77" },
    state: { reviewContext: "{\"ok\":true}" },
    latestAssistantText: "{\"ok\":true}",
    resultText: "{\"ok\":true}",
    artifactText: "{\"ok\":true}"
  })
  assert.equal(rejected.ok, false)
  assert.match(rejected.error, /Unsupported result command/)
  assert.equal(fileResult.ok, true)
  assert.equal(fs.readFileSync(path.join(workspaceRoot, ".bob", "workflows", "runs", "run-1", "steps", "save.result.json"), "utf8"), "{\"ok\":true}")
})

test("result sink registry blocks command and file sinks in untrusted workspaces", async () => {
  const workspaceRoot = tempDir()
  const calls = []
  const registry = createDefaultResultSinkRegistry({
    workspaceRoot,
    isWorkspaceTrusted: () => false,
    executeCommand: async (...args) => {
      calls.push(args)
      return { status: "ok" }
    },
    allowedCommandSinks: ["bobBazaar.captureReviewResult"]
  })

  const commandResult = await registry.write({
    type: "command",
    command: "bobBazaar.captureReviewResult"
  }, {
    workflowId: "workflow-register.sample",
    runId: "run-1",
    stepId: "save",
    text: "{\"ok\":true}"
  })
  const fileResult = await registry.write({
    type: "file",
    path: ".bob/workflows/runs/{{run.id}}/steps/{{step.id}}.result.json"
  }, {
    workflowId: "workflow-register.sample",
    runId: "run-1",
    stepId: "save",
    text: "{\"ok\":true}"
  })

  assert.equal(commandResult.ok, false)
  assert.match(commandResult.error, /Workspace is not trusted/)
  assert.equal(fileResult.ok, false)
  assert.match(fileResult.error, /Workspace is not trusted/)
  assert.equal(calls.length, 0)
  assert.equal(fs.existsSync(path.join(workspaceRoot, ".bob", "workflows", "runs", "run-1", "steps", "save.result.json")), false)
})
