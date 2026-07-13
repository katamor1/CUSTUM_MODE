const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const fsp = require("node:fs/promises")
const Module = require("node:module")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const outRoot = path.resolve(__dirname, "..", "out")

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-run-read-only-boundary-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function workflow(root) {
  return {
    id: "workflow-register.read-only-boundary",
    name: "read-only-boundary",
    label: "Read-only boundary",
    menuLabel: "Read-only boundary",
    description: "Do not mutate a future run-state document.",
    schemaVersion: "workflow-register/v1",
    definitionHash: "sha256:read-only-boundary",
    filePath: ".bob/workflows/read-only-boundary/WORKFLOW.md",
    workflowRoot: root,
    inputs: {},
    stepReview: { allowRetry: true },
    stepExecution: { mode: "engineSteps", allowOutOfOrder: false, showInBob: true },
    artifacts: [],
    engineSteps: [{ id: "review", title: "Review", type: "manual" }]
  }
}

function futureRun(root, status = "running") {
  const definition = workflow(root)
  return {
    schemaVersion: "workflow-register/run-state/v2",
    runId: `20260712T000000Z-read-only-${status}`,
    workflowId: definition.id,
    workflowName: definition.name,
    workflowSchemaVersion: definition.schemaVersion,
    workflowDefinitionHash: definition.definitionHash,
    workflowFile: definition.filePath,
    status,
    currentStep: "review",
    inputs: {},
    state: {},
    steps: [{
      id: "review",
      title: "Review",
      type: "manual",
      status: status === "reviewing" ? "reviewing" : "pending"
    }],
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:01:00.000Z"
  }
}

async function writeRun(root, run) {
  const runDirectory = path.join(root, ".bob", "workflows", "runs", run.runId)
  await fsp.mkdir(runDirectory, { recursive: true })
  const bytes = `${JSON.stringify(run, null, 2)}\n`
  const runFile = path.join(runDirectory, "run.json")
  await fsp.writeFile(runFile, bytes, "utf8")
  return {
    runFile,
    controlFile: path.join(runDirectory, "control.json"),
    revision: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`
  }
}

function markerRoot(root) {
  return {
    root,
    name: path.basename(root),
    marker: ".bob",
    depth: "direct",
    workspaceFolderName: path.basename(root),
    workspaceFolderRoot: root
  }
}

function vscodeStub(root) {
  return {
    commands: { executeCommand: async () => undefined },
    extensions: { getExtension: () => undefined },
    Uri: { file: (filePath) => ({ fsPath: path.resolve(filePath) }) },
    window: {
      showErrorMessage: async () => undefined,
      showInformationMessage: async () => undefined,
      showQuickPick: async (items) => items[0],
      showWarningMessage: async () => undefined
    },
    workspace: {
      isTrusted: true,
      workspaceFolders: [{ name: path.basename(root), uri: { fsPath: root } }]
    }
  }
}

function loadWithVscode(relativePath, vscode) {
  const modulePath = path.join(outRoot, relativePath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "vscode") return vscode
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    delete require.cache[require.resolve(modulePath)]
    return require(modulePath)
  } finally {
    Module._load = originalLoad
  }
}

test("Operation Hub exposes only non-mutating run detail for a future run-state version", () => {
  const { summarizeRunForHub } = require("../out/gui/operationHubModel.js")
  const root = path.resolve("C:/workspace")
  const summary = summarizeRunForHub(root, futureRun(root), undefined, "sha256:revision")

  assert.deepEqual(summary.primaryActions.map((action) => action.id), ["inspectRunControl"])
})

test("runNextStep rejects an explicit future run even when a matching current run exists", async (t) => {
  const root = tempRoot(t)
  const run = futureRun(root)
  const current = {
    ...futureRun(root),
    schemaVersion: "workflow-register/run-state/v1",
    runId: "20260712T000000Z-current-peer",
    updatedAt: "2026-07-12T00:00:30.000Z"
  }
  await writeRun(root, run)
  await writeRun(root, current)
  const vscode = vscodeStub(root)
  const { ActionRegistry } = require("../out/core/actionRegistry.js")
  const { WorkflowEngine } = require("../out/core/engine.js")
  const { ResultSinkRegistry } = require("../out/core/resultSinkRegistry.js")
  const { FileRunStateStore } = require("../out/core/runStateStore.js")
  const { WorkflowRunCommandService } = loadWithVscode("workflowRunCommands.js", vscode)
  const definition = workflow(root)
  const service = new WorkflowRunCommandService({
    coreWorkflows: new Map([[definition.id, definition]]),
    runtimeFactory: {
      createRunStore: (workspaceRoot) => new FileRunStateStore({ workspaceRoot }),
      createEngine: (workspaceRoot) => new WorkflowEngine({
        actions: new ActionRegistry(),
        resultSinks: new ResultSinkRegistry(),
        runStore: new FileRunStateStore({ workspaceRoot })
      })
    },
    ensureWorkflowsLoaded: async () => undefined,
    workflowRootCandidates: async () => [markerRoot(root)],
    activeSteps: () => [],
    showManualStepPanel: async () => undefined,
    gateRegistry: {
      pendingForRun: () => undefined,
      acceptPending: () => false,
      abortPending: () => false,
      rebind: () => undefined
    },
    coordinateGateDecision: (_workspaceRoot, _runId, _kind, operation) => operation()
  })

  await assert.rejects(
    service.runNextStep(run.runId),
    /read-only schemaVersion 'workflow-register\/run-state\/v2'/
  )
  const persisted = await new FileRunStateStore({ workspaceRoot: root }).listRuns()
  assert.deepEqual(persisted.map((candidate) => candidate.runId).sort(), [current.runId, run.runId].sort())
  assert.equal(persisted.find((candidate) => candidate.runId === current.runId).status, "running")
  assert.equal(persisted.find((candidate) => candidate.runId === current.runId).steps[0].status, "pending")
})

test("pause command rejects a future run before writing control.json", async (t) => {
  const root = tempRoot(t)
  const run = futureRun(root)
  const paths = await writeRun(root, run)
  const { pauseCurrentRun } = loadWithVscode("commands/runControl.js", vscodeStub(root))

  await assert.rejects(
    pauseCurrentRun({ showMarkdownReport: async () => undefined }, run.runId),
    /read-only schemaVersion 'workflow-register\/run-state\/v2'/
  )
  assert.equal(fs.existsSync(paths.controlFile), false)
})

test("pause command still writes control state for a current v1 run", async (t) => {
  const root = tempRoot(t)
  const run = {
    ...futureRun(root),
    schemaVersion: "workflow-register/run-state/v1",
    runId: "20260712T000000Z-current-running"
  }
  const paths = await writeRun(root, run)
  const { pauseCurrentRun } = loadWithVscode("commands/runControl.js", vscodeStub(root))

  await pauseCurrentRun({ showMarkdownReport: async () => undefined }, run.runId)

  const control = JSON.parse(fs.readFileSync(paths.controlFile, "utf8"))
  assert.equal(control.schemaVersion, "workflow-register/run-control/v1")
  assert.equal(control.runId, run.runId)
  assert.equal(control.pauseRequestedAt !== undefined, true)
})
