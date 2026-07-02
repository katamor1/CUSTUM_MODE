const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")
const { tempDir } = require("./helpers/workflowEngineFixtures")

test("workflow engine runs command and file-result steps without Bob and persists run state", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const actions = new ActionRegistry()
  actions.register({
    id: "sample.collect",
    execute: async ({ args }) => ({ revision: args.revision, status: "ready" })
  })
  const sinks = createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined })
  const runStore = new FileRunStateStore({ workspaceRoot, now: () => "2026-06-28T00:00:00.000Z", engineVersion: "test-engine" })
  const engine = new WorkflowEngine({ actions, resultSinks: sinks, runStore })

  const workflow = {
    id: "workflow-register.sample",
    name: "sample",
    label: "Sample",
    schemaVersion: "workflow-register/v1",
    definitionHash: "sha256:test-hash",
    filePath: ".bob/workflows/sample/WORKFLOW.md",
    inputs: { revision: { type: "string", required: true } },
    engineSteps: [
      {
        id: "collect",
        title: "Collect",
        type: "command",
        action: { provider: "sample.collect", args: { revision: "{{inputs.revision}}" } },
        resultKey: "reviewContext"
      },
      {
        id: "save",
        title: "Save",
        type: "result",
        result: {
          source: "state",
          stateKey: "reviewContext",
          sinks: [{ type: "file", path: ".bob/workflows/runs/{{run.id}}/steps/save.result.json" }]
        }
      }
    ]
  }

  const run = await engine.runWorkflow(workflow, { revision: "77" })
  const saved = JSON.parse(fs.readFileSync(path.join(workspaceRoot, ".bob", "workflows", "runs", run.runId, "run.json"), "utf8"))
  const resultPath = path.join(workspaceRoot, ".bob", "workflows", "runs", run.runId, "steps", "save.result.json")

  assert.equal(run.status, "completed")
  assert.equal(saved.status, "completed")
  assert.equal(saved.workflowSchemaVersion, "workflow-register/v1")
  assert.equal(saved.workflowDefinitionHash, "sha256:test-hash")
  assert.equal(saved.workflowFile, ".bob/workflows/sample/WORKFLOW.md")
  assert.equal(saved.engineVersion, "test-engine")
  assert.equal(saved.steps.map((step) => step.status).join(","), "completed,completed")
  assert.equal(JSON.parse(fs.readFileSync(resultPath, "utf8")).revision, "77")
})

test("workflow engine fails command steps when providers return structured error results", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const actions = new ActionRegistry()
  actions.register({
    id: "sample.validate",
    execute: async () => ({ status: "error", errors: ["Invalid YAML: missing bob-output.yaml"] })
  })
  const sinks = createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined })
  const runStore = new FileRunStateStore({ workspaceRoot, now: () => "2026-06-28T00:00:00.000Z", engineVersion: "test-engine" })
  const engine = new WorkflowEngine({ actions, resultSinks: sinks, runStore })

  const workflow = {
    id: "workflow-register.structured-error",
    name: "structured-error",
    label: "Structured Error",
    schemaVersion: "workflow-register/v1",
    filePath: ".bob/workflows/structured-error/WORKFLOW.md",
    inputs: {},
    engineSteps: [
      { id: "validate", title: "Validate", type: "command", action: { provider: "sample.validate" }, resultKey: "validationResult" },
      { id: "next", title: "Next", type: "command", action: { provider: "sample.next" } }
    ]
  }

  const run = await engine.runWorkflow(workflow, {})

  assert.equal(run.status, "failed")
  assert.equal(run.currentStep, "validate")
  assert.equal(run.steps[0].status, "failed")
  assert.equal(run.steps[1].status, "pending")
  assert.match(run.error, /Invalid YAML: missing bob-output.yaml/)
  assert.equal(run.state.validationResult, undefined)
})

test("workflow engine runs agent steps through an AgentProvider and can hand off the agent text", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const runStore = new FileRunStateStore({ workspaceRoot, now: () => "2026-06-28T00:00:00.000Z" })
  const agentCalls = []
  const engine = new WorkflowEngine({
    actions: new ActionRegistry(),
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore,
    agentProvider: {
      run: async (input) => {
        agentCalls.push(input)
        return `agent output for ${input.inputs.revision}`
      }
    }
  })
  const workflow = {
    id: "workflow-register.agent",
    name: "agent",
    label: "Agent",
    description: "Agent workflow",
    schemaVersion: "workflow-register/v1",
    inputs: { revision: { type: "string", required: true } },
    engineSteps: [
      {
        id: "analyze",
        title: "Analyze",
        type: "agent",
        prompt: "Analyze {{inputs.revision}}",
        resultKey: "analysis",
        result: { source: "agent", sinks: [{ type: "file", path: ".bob/workflows/runs/{{run.id}}/steps/analyze.txt" }] }
      }
    ]
  }

  const run = await engine.runWorkflow(workflow, { revision: "88" })
  const outputPath = path.join(workspaceRoot, ".bob", "workflows", "runs", run.runId, "steps", "analyze.txt")

  assert.equal(run.status, "completed")
  assert.equal(run.state.analysis, "agent output for 88")
  assert.equal(agentCalls[0].prompt, "Analyze 88")
  assert.equal(fs.readFileSync(outputPath, "utf8"), "agent output for 88")
})

test("workflow engine can replace agent result state with command sink artifact text", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const normalizedJson = "{\"status\":\"ok\"}"
  const engine = new WorkflowEngine({
    actions: new ActionRegistry(),
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => ({ status: "ok", jsonText: normalizedJson }) }),
    runStore: new FileRunStateStore({ workspaceRoot, now: () => "2026-06-28T00:00:00.000Z" }),
    agentProvider: { run: async () => "markdown checklist output" }
  })
  const workflow = {
    id: "workflow-register.agent-normalized-result",
    name: "agent-normalized-result",
    label: "Agent Normalized Result",
    description: "Agent workflow",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    artifacts: [{ id: "reviewResultJson", producedBy: "output-result", path: ".bob/workflows/runs/{{run.id}}/review-result.json" }],
    engineSteps: [
      {
        id: "output-result",
        title: "Output",
        type: "agent",
        prompt: "Output",
        resultKey: "reviewResultJson",
        result: { source: "agent", sinks: [{ type: "command", command: "bobBazaar.captureReviewResult" }] }
      }
    ]
  }

  const run = await engine.runWorkflow(workflow, {})
  const artifactPath = path.join(workspaceRoot, ".bob", "workflows", "runs", run.runId, "review-result.json")

  assert.equal(run.status, "completed")
  assert.equal(run.state.reviewResultJson, normalizedJson)
  assert.equal(fs.readFileSync(artifactPath, "utf8"), normalizedJson)
})
