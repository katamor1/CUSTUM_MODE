const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")
const { tempDir } = require("./helpers/workflowEngineFixtures")

test("workflow engine rejects invalid input values before running steps", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const calls = []
  const actions = new ActionRegistry()
  actions.register({ id: "sample.collect", execute: async () => calls.push("ran") })
  const engine = new WorkflowEngine({
    actions,
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore: new FileRunStateStore({ workspaceRoot, now: () => "2026-06-28T00:00:00.000Z" })
  })
  const workflow = {
    id: "workflow-register.inputs",
    name: "inputs",
    label: "Inputs",
    description: "Inputs workflow",
    schemaVersion: "workflow-register/v1",
    inputs: {
      count: { type: "number", required: true },
      mode: { type: "select", required: true, options: ["fast", "safe"] }
    },
    engineSteps: [
      { id: "collect", title: "Collect", type: "command", action: { provider: "sample.collect" } }
    ]
  }

  const run = await engine.runWorkflow(workflow, { count: "abc", mode: "unsafe" })

  assert.equal(run.status, "failed")
  assert.match(run.error, /Workflow input must be a number: count/)
  assert.match(run.error, /Workflow input has an unsupported option: mode/)
  assert.deepEqual(calls, [])
})

test("workflow engine records result-source failures in run state", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const runStore = new FileRunStateStore({ workspaceRoot, now: () => "2026-06-28T00:00:00.000Z" })
  const engine = new WorkflowEngine({
    actions: new ActionRegistry(),
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore
  })
  const workflow = {
    id: "workflow-register.missing-state",
    name: "missing-state",
    label: "Missing State",
    description: "Missing state workflow",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    engineSteps: [
      {
        id: "save",
        title: "Save",
        type: "result",
        result: {
          source: "state",
          stateKey: "missing",
          sinks: [{ type: "file", path: ".bob/workflows/runs/{{run.id}}/steps/save.txt" }]
        }
      }
    ]
  }

  const run = await engine.runWorkflow(workflow, {})
  const saved = JSON.parse(fs.readFileSync(path.join(workspaceRoot, ".bob", "workflows", "runs", run.runId, "run.json"), "utf8"))

  assert.equal(run.status, "failed")
  assert.match(run.error, /Workflow state is missing: missing/)
  assert.equal(saved.status, "failed")
  assert.equal(saved.currentStep, "save")
  assert.equal(saved.steps[0].status, "failed")
  assert.match(saved.steps[0].error, /Workflow state is missing: missing/)
})

test("workflow engine holds manual steps and resumes them", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const runStore = new FileRunStateStore({ workspaceRoot, now: () => "2026-06-28T00:00:00.000Z" })
  const engine = new WorkflowEngine({
    actions: new ActionRegistry(),
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore
  })
  const workflow = {
    id: "workflow-register.manual",
    name: "manual",
    label: "Manual",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    engineSteps: [
      { id: "approve", title: "Approve", type: "manual" },
      { id: "write", title: "Write", type: "result", result: { source: "literal", text: "done", sinks: [{ type: "file", path: ".bob/workflows/runs/{{run.id}}/steps/write.txt" }] } }
    ]
  }

  const held = await engine.runWorkflow(workflow, {})
  const resumed = await engine.resumeRun(held.runId, { workflow, completeHeldStep: true })

  assert.equal(held.status, "held")
  assert.equal(held.currentStep, "approve")
  assert.equal(resumed.status, "completed")
  assert.equal(fs.readFileSync(path.join(workspaceRoot, ".bob", "workflows", "runs", held.runId, "steps", "write.txt"), "utf8"), "done")
})

test("workflow engine can execute a single requested step and leave the run recoverable", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const calls = []
  const actions = new ActionRegistry()
  actions.register({
    id: "sample.collect",
    execute: async (input) => {
      calls.push(["collect", input.runId, input.stepId])
      return `context-${input.inputs.revision}`
    }
  })
  actions.register({
    id: "sample.analyze",
    execute: async (input) => {
      calls.push(["analyze", input.runId, input.stepId, input.state.context])
      return `analysis-${input.state.context}`
    }
  })
  const runStore = new FileRunStateStore({ workspaceRoot, now: () => "2026-06-28T00:00:00.000Z" })
  const events = []
  const engine = new WorkflowEngine({
    actions,
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore,
    hooks: {
      onWorkflowStart: async ({ run }) => events.push(["workflow-start", run.runId]),
      onStepStart: async ({ run, step }) => events.push(["step-start", run.runId, step.id]),
      onStepCompleted: async ({ run, step }) => events.push(["step-completed", run.runId, step.id])
    }
  })
  const workflow = {
    id: "workflow-register.single-step",
    name: "single-step",
    label: "Single Step",
    schemaVersion: "workflow-register/v1",
    inputs: { revision: { type: "string", required: true } },
    engineSteps: [
      { id: "collect", title: "Collect", type: "command", action: { provider: "sample.collect" }, resultKey: "context" },
      { id: "analyze", title: "Analyze", type: "command", action: { provider: "sample.analyze" }, resultKey: "analysis" }
    ]
  }

  const first = await engine.runWorkflow(workflow, { revision: "77" }, { executionMode: "singleStep", stepId: "collect" })
  const second = await engine.runWorkflow(workflow, { revision: "77" }, { executionMode: "singleStep", stepId: "analyze" })

  assert.equal(first.runId, second.runId)
  assert.equal(first.status, "running")
  assert.equal(first.currentStep, "collect")
  assert.equal(first.steps.map((step) => step.status).join(","), "completed,pending")
  assert.equal(second.status, "completed")
  assert.equal(second.state.context, "context-77")
  assert.equal(second.state.analysis, "analysis-context-77")
  assert.deepEqual(calls.map((call) => [call[0], call[2]]), [["collect", "collect"], ["analyze", "analyze"]])
  assert.deepEqual(events.map((event) => event[0]), ["workflow-start", "step-start", "step-completed", "step-start", "step-completed"])
})

test("workflow engine rejects out-of-order single-step execution by default", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  let analyzeCalls = 0
  const actions = new ActionRegistry()
  actions.register({ id: "sample.collect", execute: async () => "context" })
  actions.register({ id: "sample.analyze", execute: async () => { analyzeCalls += 1; return "analysis" } })
  const engine = new WorkflowEngine({
    actions,
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore: new FileRunStateStore({ workspaceRoot, now: () => "2026-07-03T00:00:00.000Z" })
  })
  const workflow = {
    id: "workflow-register.ordered-single",
    name: "ordered-single",
    label: "Ordered Single",
    description: "Ordered single-step workflow.",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    engineSteps: [
      { id: "collect", title: "Collect", type: "command", action: { provider: "sample.collect" }, resultKey: "context" },
      { id: "analyze", title: "Analyze", type: "command", action: { provider: "sample.analyze" }, resultKey: "analysis" }
    ]
  }

  const run = await engine.runWorkflow(workflow, {}, { executionMode: "singleStep", stepId: "analyze" })

  assert.equal(run.status, "failed")
  assert.equal(run.currentStep, "analyze")
  assert.equal(run.steps[0].status, "pending")
  assert.equal(run.steps[1].status, "failed")
  assert.match(run.error, /cannot run before previous step 'collect' is completed/)
  assert.equal(analyzeCalls, 0)
})

test("workflow engine can explicitly allow out-of-order single-step execution", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const actions = new ActionRegistry()
  actions.register({ id: "sample.analyze", execute: async () => "analysis" })
  const engine = new WorkflowEngine({
    actions,
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore: new FileRunStateStore({ workspaceRoot, now: () => "2026-07-03T00:00:00.000Z" })
  })
  const workflow = {
    id: "workflow-register.out-of-order",
    name: "out-of-order",
    label: "Out of Order",
    description: "Out-of-order workflow.",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    engineSteps: [
      { id: "collect", title: "Collect", type: "command", action: { provider: "sample.collect" }, resultKey: "context" },
      { id: "analyze", title: "Analyze", type: "command", action: { provider: "sample.analyze" }, resultKey: "analysis" }
    ]
  }

  const run = await engine.runWorkflow(workflow, {}, { executionMode: "singleStep", stepId: "analyze", allowOutOfOrder: true })

  assert.equal(run.status, "completed")
  assert.equal(run.steps[0].status, "pending")
  assert.equal(run.steps[1].status, "completed")
  assert.equal(run.state.analysis, "analysis")
})

test("workflow engine pauses successful single-step execution for step review", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const actions = new ActionRegistry()
  actions.register({ id: "sample.collect", execute: async () => "context" })
  const engine = new WorkflowEngine({
    actions,
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore: new FileRunStateStore({ workspaceRoot, now: () => "2026-07-03T00:00:00.000Z" })
  })
  const workflow = {
    id: "workflow-register.review-gate",
    name: "review-gate",
    label: "Review Gate",
    description: "Review-gated workflow.",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    stepReview: {
      enabled: true,
      pauseAfter: "everyStep",
      requireAcceptBeforeNext: true,
      allowRetry: true,
      allowEditBeforeRetry: true,
      preserveAttempts: true
    },
    engineSteps: [
      { id: "collect", title: "Collect", type: "command", action: { provider: "sample.collect" }, resultKey: "context" },
      { id: "next", title: "Next", type: "command", action: { provider: "sample.next" } }
    ]
  }

  const run = await engine.runWorkflow(workflow, {}, { executionMode: "singleStep", stepId: "collect" })

  assert.equal(run.status, "reviewing")
  assert.equal(run.currentStep, "collect")
  assert.equal(run.steps[0].status, "reviewing")
  assert.equal(run.steps[0].completedAt, undefined)
  assert.equal(run.state.context, "context")
})

test("retrying a reviewing step archives the rejected attempt state", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  let count = 0
  const actions = new ActionRegistry()
  actions.register({ id: "sample.collect", execute: async () => `context-${++count}` })
  const runStore = new FileRunStateStore({ workspaceRoot, now: () => "2026-07-03T00:00:00.000Z" })
  const engine = new WorkflowEngine({
    actions,
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore
  })
  const workflow = {
    id: "workflow-register.review-retry",
    name: "review-retry",
    label: "Review Retry",
    description: "Review retry workflow.",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    stepReview: {
      enabled: true,
      pauseAfter: "everyStep",
      requireAcceptBeforeNext: true,
      allowRetry: true,
      allowEditBeforeRetry: true,
      preserveAttempts: true
    },
    engineSteps: [
      { id: "collect", title: "Collect", type: "command", action: { provider: "sample.collect" }, resultKey: "context" }
    ]
  }

  const first = await engine.runWorkflow(workflow, {}, { executionMode: "singleStep", stepId: "collect" })
  const retried = await engine.retryCurrentStep(first.runId, workflow)

  assert.equal(retried.status, "reviewing")
  assert.equal(retried.state.context, "context-2")
  assert.equal(retried.steps[0].attempt, 2)
  assert.equal(retried.steps[0].attempts.length, 1)
  assert.equal(retried.steps[0].attempts[0].status, "reviewing")
  assert.equal(retried.steps[0].attempts[0].reviewDecision, "rejected")
  assert.equal(retried.steps[0].attempts[0].stateSnapshot.context, "context-1")
})

test("workflow engine manual completion controller can complete a held step in single-step mode", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const completions = []
  const runStore = new FileRunStateStore({ workspaceRoot, now: () => "2026-06-28T00:00:00.000Z" })
  const engine = new WorkflowEngine({
    actions: new ActionRegistry(),
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore,
    manualCompletion: async ({ run, step }) => {
      completions.push([run.runId, step.id])
      return { completed: true }
    }
  })
  const workflow = {
    id: "workflow-register.manual-single",
    name: "manual-single",
    label: "Manual Single",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    engineSteps: [
      { id: "approve", title: "Approve", type: "manual" },
      { id: "next", title: "Next", type: "result", result: { source: "literal", text: "done", sinks: [{ type: "file", path: ".bob/workflows/runs/{{run.id}}/steps/next.txt" }] } }
    ]
  }

  const run = await engine.runWorkflow(workflow, {}, { executionMode: "singleStep", stepId: "approve" })

  assert.equal(run.status, "running")
  assert.equal(run.currentStep, "approve")
  assert.equal(run.steps[0].status, "completed")
  assert.equal(run.steps[1].status, "pending")
  assert.deepEqual(completions, [[run.runId, "approve"]])
})

test("workflow engine validates requiredWhen inputs and select options", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const engine = new WorkflowEngine({
    actions: new ActionRegistry(),
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore: new FileRunStateStore({ workspaceRoot, now: () => "2026-06-28T00:00:00.000Z" })
  })
  const workflow = {
    id: "workflow-register.inputs",
    name: "inputs",
    label: "Inputs",
    schemaVersion: "workflow-register/v1",
    inputs: {
      mode: { type: "select", required: true, options: ["single", "range"] },
      revision: { type: "string", requiredWhen: "inputs.mode == 'single'" }
    },
    engineSteps: []
  }

  const missing = await engine.runWorkflow(workflow, { mode: "single" })
  const invalid = await engine.runWorkflow(workflow, { mode: "bad", revision: "1" })

  assert.equal(missing.status, "failed")
  assert.match(missing.error, /revision/)
  assert.equal(invalid.status, "failed")
  assert.match(invalid.error, /unsupported option/)
})

test("workflow engine enforces preflight checks, guardrails, and artifact writes", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  fs.mkdirSync(path.join(workspaceRoot, ".bob", "skills", "sample"), { recursive: true })
  fs.writeFileSync(path.join(workspaceRoot, ".bob", "skills", "sample", "SKILL.md"), "# Sample\n")

  const actions = new ActionRegistry()
  let actionCount = 0
  actions.register({
    id: "sample.collect",
    execute: async ({ args }) => {
      actionCount += 1
      return { revision: args.revision, status: "ready" }
    }
  })
  const sinks = createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined })
  const runStore = new FileRunStateStore({ workspaceRoot, now: () => "2026-06-28T00:00:00.000Z" })
  const engine = new WorkflowEngine({
    actions,
    resultSinks: sinks,
    runStore,
    workspaceAvailable: () => true,
    fileExists: (relativePath) => fs.existsSync(path.join(workspaceRoot, relativePath)),
    preflightChecks: { workspaceOpen: () => true },
    strictPreflightChecks: true
  })
  const workflow = {
    id: "workflow-register.contract",
    name: "contract",
    label: "Contract",
    schemaVersion: "workflow-register/v1",
    inputs: { revision: { type: "string", required: true } },
    requires: { workspace: true, files: [".bob/skills/sample/SKILL.md"] },
    preflight: [{ id: "check-workspace", checks: ["workspaceOpen"], files: [".bob/skills/sample/SKILL.md"], failurePolicy: "stop" }],
    guardrails: { allowedCommands: ["sample.collect"], deniedCommands: ["shell"] },
    artifacts: [{ id: "reviewContext", producedBy: "collect", path: ".bob/workflows/runs/{{run.id}}/artifacts/review-context.json" }],
    engineSteps: [{ id: "collect", title: "Collect", type: "command", action: { provider: "sample.collect", args: { revision: "{{inputs.revision}}" } }, resultKey: "reviewContext" }]
  }

  const run = await engine.runWorkflow(workflow, { revision: "88" })
  const artifactPath = path.join(workspaceRoot, ".bob", "workflows", "runs", run.runId, "artifacts", "review-context.json")

  assert.equal(run.status, "completed")
  assert.equal(actionCount, 1)
  assert.equal(JSON.parse(fs.readFileSync(artifactPath, "utf8")).revision, "88")
})

test("workflow engine resolves artifact path placeholders from inputs and JSON state", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const actions = new ActionRegistry()
  actions.register({ id: "sample.review", execute: async ({ inputs }) => ({ review_id: `bazaar-r${inputs.revision}-project-rule-review`, status: "ok" }) })
  const engine = new WorkflowEngine({
    actions,
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore: new FileRunStateStore({ workspaceRoot, now: () => "2026-06-28T00:00:00.000Z" })
  })
  const workflow = {
    id: "workflow-register.artifact-placeholders",
    name: "artifact-placeholders",
    label: "Artifact Placeholders",
    schemaVersion: "workflow-register/v1",
    inputs: { revision: { type: "string", required: true } },
    artifacts: [{ id: "reviewResult", producedBy: "review", path: ".bob/review/results/{{review_id}}-{{inputs.revision}}.json" }],
    engineSteps: [{ id: "review", title: "Review", type: "command", action: { provider: "sample.review" }, resultKey: "reviewResult" }]
  }

  const run = await engine.runWorkflow(workflow, { revision: "123" })
  const artifactPath = path.join(workspaceRoot, ".bob", "review", "results", "bazaar-r123-project-rule-review-123.json")

  assert.equal(run.status, "completed")
  assert.equal(JSON.parse(fs.readFileSync(artifactPath, "utf8")).review_id, "bazaar-r123-project-rule-review")
})

test("workflow engine fails denied or non-allowlisted command steps before executing them", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const actions = new ActionRegistry()
  let executed = false
  actions.register({ id: "sample.collect", execute: async () => { executed = true; return {} } })
  const engine = new WorkflowEngine({
    actions,
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore: new FileRunStateStore({ workspaceRoot, now: () => "2026-06-28T00:00:00.000Z" })
  })
  const workflow = {
    id: "workflow-register.guardrails",
    name: "guardrails",
    label: "Guardrails",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    guardrails: { allowedCommands: ["sample.other"] },
    engineSteps: [{ id: "collect", title: "Collect", type: "command", action: { provider: "sample.collect" } }]
  }

  const run = await engine.runWorkflow(workflow, {})

  assert.equal(run.status, "failed")
  assert.match(run.error, /not allowed/)
  assert.equal(executed, false)
})

test("shared guardrails helper validates allowed and denied commands", () => {
  const { validateCommandGuardrails } = require("../out/core/guardrails")

  assert.equal(validateCommandGuardrails({ guardrails: { allowedCommands: ["sample.collect"] } }, "sample.collect"), undefined)
  assert.match(validateCommandGuardrails({ guardrails: { allowedCommands: ["sample.other"] } }, "sample.collect"), /not allowed/)
  assert.match(validateCommandGuardrails({ guardrails: { deniedCommands: ["sample.collect"] } }, "sample.collect"), /denied/)
})
