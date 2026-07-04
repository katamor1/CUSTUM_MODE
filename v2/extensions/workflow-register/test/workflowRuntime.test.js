const assert = require("node:assert/strict")
const fs = require("node:fs")
const fsp = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const extensionRoot = path.resolve(__dirname, "..")
const outRoot = path.join(extensionRoot, "out")
const { ActionRegistry } = require(path.join(outRoot, "core", "actionRegistry.js"))
const { WorkflowEngine } = require(path.join(outRoot, "core", "engine.js"))
const { createDefaultResultSinkRegistry, ResultSinkRegistry } = require(path.join(outRoot, "core", "resultSinkRegistry.js"))
const { FileRunStateStore } = require(path.join(outRoot, "core", "runStateStore.js"))
const { buildWorkflowRunDiagnosticReport, formatWorkflowRunDiagnostics, workflowRunFailureHint } = require(path.join(outRoot, "core", "runDiagnostics.js"))

function workflow(overrides = {}) {
  return {
    id: "workflow-register.sample",
    name: "sample",
    label: "Sample",
    menuLabel: "Sample",
    description: "Sample workflow.",
    schemaVersion: "workflow-register/v1",
    filePath: ".bob/workflows/sample/WORKFLOW.md",
    prompt: "Sample workflow.",
    promptWithoutTodo: "Sample workflow.",
    commandArgs: [],
    mode: "agent",
    permissions: ["read", "mcp", "skill"],
    autoApprovalEnabled: true,
    workspaceRequired: true,
    hidden: false,
    todoEnabled: false,
    todoRequired: false,
    todoAsSteps: false,
    stepCompletion: "auto",
    stepMessage: "current",
    todos: [],
    inputs: {},
    requires: {},
    preflight: [],
    tools: {},
    guardrails: {},
    artifacts: [],
    completion: {},
    engineSteps: [],
    ...overrides
  }
}

async function tempRoot() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "workflow-register-test-"))
}

test("workflow engine renders input placeholders into agent prompts", async () => {
  const root = await tempRoot()
  let capturedPrompt = ""
  const runStore = new FileRunStateStore({ workspaceRoot: root, now: fixedNow })
  const engine = new WorkflowEngine({
    actions: new ActionRegistry(),
    resultSinks: new ResultSinkRegistry(),
    runStore,
    agentProvider: { run: (input) => { capturedPrompt = input.prompt; return "agent-result" } }
  })
  const run = await engine.runWorkflow(workflow({
    inputs: { target: { type: "string", required: true } },
    engineSteps: [{ id: "analyze", title: "Analyze", type: "agent", prompt: "Target={{inputs.target}}", resultKey: "analysis" }]
  }), { target: "src/core/engine.ts" })

  assert.equal(run.status, "completed")
  assert.equal(capturedPrompt, "Target=src/core/engine.ts")
  assert.equal(run.state.analysis, "agent-result")
})

test("workflow engine fails before execution when required files are missing", async () => {
  const root = await tempRoot()
  const runStore = new FileRunStateStore({ workspaceRoot: root, now: fixedNow })
  const engine = new WorkflowEngine({
    actions: new ActionRegistry(),
    resultSinks: new ResultSinkRegistry(),
    runStore,
    agentProvider: { run: () => "should-not-run" }
  })
  const run = await engine.runWorkflow(workflow({
    requires: { files: ["missing-required-file.txt"] },
    engineSteps: [{ id: "analyze", title: "Analyze", type: "agent", prompt: "Analyze." }]
  }), {})

  assert.equal(run.status, "failed")
  assert.match(run.error, /Workflow preflight failed/)
  assert.match(run.error, /missing-required-file\.txt/)
})

test("workflow engine writes agent output through a file result sink", async () => {
  const root = await tempRoot()
  const runStore = new FileRunStateStore({ workspaceRoot: root, now: fixedNow })
  const engine = new WorkflowEngine({
    actions: new ActionRegistry(),
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot: root, executeCommand: () => undefined }),
    runStore,
    agentProvider: { run: () => "# Report\n\nGenerated." }
  })
  const run = await engine.runWorkflow(workflow({
    engineSteps: [
      { id: "analyze", title: "Analyze", type: "agent", prompt: "Analyze.", resultKey: "analysisReport" },
      { id: "write-report", title: "Write report", type: "result", result: { source: "state", stateKey: "analysisReport", sinks: [{ type: "file", path: ".bob/artifacts/report.md" }] } }
    ]
  }), {})
  const reportPath = path.join(root, ".bob", "artifacts", "report.md")

  assert.equal(run.status, "completed")
  assert.equal(fs.readFileSync(reportPath, "utf8"), "# Report\n\nGenerated.")
})

test("workflow run diagnostics include failed step and suggested fix", () => {
  const run = {
    runId: "20260628T000000Z-sample",
    workflowId: "workflow-register.sample",
    workflowName: "sample",
    status: "failed",
    currentStep: "collect",
    inputs: {},
    state: {},
    steps: [
      { id: "collect", title: "Collect", type: "command", status: "failed", error: "Unsupported action provider: example.collect" }
    ],
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:01.000Z",
    error: "Unsupported action provider: example.collect"
  }

  assert.match(workflowRunFailureHint(run.error), /Register an ActionProvider/)
  assert.ok(formatWorkflowRunDiagnostics(run).some((line) => line.includes("suggested fix")))
  assert.equal(buildWorkflowRunDiagnosticReport([run]).summary, "1 run(s); 1 failed; 0 reviewing; 0 held; 0 archived attempt(s).")
})

test("workflow run diagnostics include task snapshot evidence and mismatch warnings", () => {
  const run = {
    runId: "20260630T000000Z-sample",
    workflowId: "workflow-register.sample",
    workflowName: "sample",
    workflowDefinitionHash: "hash-current",
    status: "failed",
    currentStep: "analyze",
    inputs: {},
    state: {},
    steps: [
      { id: "analyze", title: "Analyze", type: "agent", status: "failed", error: "Result sink failed" }
    ],
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:01.000Z",
    error: "Result sink failed"
  }

  const report = buildWorkflowRunDiagnosticReport([run], {
    snapshotsByRunId: {
      [run.runId]: [
        {
          fileName: "20260630T000000000Z-analyze-agent-output.json",
          createdAt: "2026-06-30T00:00:00.000Z",
          reason: "agent-output",
          workflowId: run.workflowId,
          workflowDefinitionHash: "hash-old",
          stepId: "collect",
          hasLastAssistantText: true,
          handoffError: "capture failed"
        }
      ]
    }
  })

  assert.ok(report.lines.some((line) => line.includes("Task snapshots:")))
  assert.ok(report.lines.some((line) => line.includes("agent-output")))
  assert.ok(report.lines.some((line) => line.includes("workflow hash mismatch")))
  assert.ok(report.lines.some((line) => line.includes("step mismatch")))
  assert.ok(report.lines.some((line) => line.includes("lastAssistantText=yes")))
  assert.ok(report.lines.some((line) => line.includes("handoffError=capture failed")))
})

test("workflow run diagnostics include branch loops, checkpoint, and history", () => {
  const run = {
    runId: "20260701T000000Z-branching",
    workflowId: "workflow-register.branching",
    workflowName: "branching",
    status: "checkpoint",
    currentStep: "collect",
    inputs: {},
    state: {},
    branching: {
      loops: {
        "retry-loop": {
          loopId: "retry-loop",
          count: 1,
          allowed: 1,
          maxIterations: 1,
          extensionSize: 2,
          checkpointCount: 1,
          lastTransitionAt: "2026-07-01T00:00:01.000Z"
        }
      },
      checkpoint: {
        id: "checkpoint-1",
        loopId: "retry-loop",
        fromStepId: "review",
        toStepId: "collect",
        decisionId: "retry",
        count: 1,
        allowed: 1,
        extensionSize: 2,
        message: "Review before retry.",
        createdAt: "2026-07-01T00:00:02.000Z"
      },
      history: [
        {
          id: "history-1",
          loopId: "retry-loop",
          decisionId: "retry",
          fromStepId: "review",
          toStepId: "collect",
          action: "checkpoint",
          loopCount: 1,
          createdAt: "2026-07-01T00:00:02.000Z"
        }
      ]
    },
    steps: [
      { id: "collect", title: "Collect", type: "manual", status: "pending" },
      { id: "review", title: "Review", type: "manual", status: "completed" }
    ],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:02.000Z"
  }

  const lines = formatWorkflowRunDiagnostics(run)

  assert.ok(lines.some((line) => line.includes("Branch loops:")))
  assert.ok(lines.some((line) => line.includes("retry-loop: count=1; allowed=1; maxIterations=1; extensionSize=2; checkpoints=1")))
  assert.ok(lines.some((line) => line.includes("Branch checkpoint:")))
  assert.ok(lines.some((line) => line.includes("transition: review -> collect")))
  assert.ok(lines.some((line) => line.includes("Branching history:")))
  assert.ok(lines.some((line) => line.includes("checkpoint: retry; review -> collect; loop=retry-loop; count=1")))
})

function fixedNow() {
  return "2026-06-28T00:00:00.000Z"
}
