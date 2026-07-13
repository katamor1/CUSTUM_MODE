const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const fsp = require("node:fs/promises")
const Module = require("node:module")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const outRoot = path.resolve(__dirname, "..", "out")

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

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-read-only-artifact-source-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function workflow(root) {
  return {
    id: "workflow-register.artifact-source",
    name: "artifact-source",
    label: "Artifact source",
    menuLabel: "Artifact source",
    description: "Artifact source workflow.",
    schemaVersion: "workflow-register/v1",
    definitionHash: "sha256:artifact-source",
    filePath: ".bob/workflows/artifact-source/WORKFLOW.md",
    workflowRoot: root,
    inputs: {},
    stepExecution: { mode: "engineSteps", allowOutOfOrder: false, showInBob: true },
    stepReview: { allowRetry: true },
    artifacts: [],
    engineSteps: [{ id: "review", title: "Review", type: "manual" }]
  }
}

async function writeFutureSourceRun(root, definition) {
  const runId = "20260712T000000Z-future-artifact-source"
  const inputsHash = `sha256:${crypto.createHash("sha256").update("{}").digest("hex")}`
  const manifest = {
    schemaVersion: "workflow-register/artifact-manifest/v1",
    workflowId: definition.id,
    workflowDefinitionHash: definition.definitionHash,
    workflowFile: definition.filePath,
    runId,
    inputsHash,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    artifacts: []
  }
  const run = {
    schemaVersion: "workflow-register/run-state/v2",
    runId,
    workflowId: definition.id,
    workflowName: definition.name,
    workflowSchemaVersion: definition.schemaVersion,
    workflowDefinitionHash: definition.definitionHash,
    workflowFile: definition.filePath,
    status: "completed",
    inputs: {},
    state: { "workflow.artifactManifest": JSON.stringify(manifest) },
    steps: [{ id: "review", title: "Review", type: "manual", status: "completed" }],
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:01:00.000Z"
  }
  const directory = path.join(root, ".bob", "workflows", "runs", runId)
  await fsp.mkdir(directory, { recursive: true })
  await fsp.writeFile(path.join(directory, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8")
  return run
}

function vscodeStub(root) {
  return {
    commands: { executeCommand: async () => undefined },
    extensions: { getExtension: () => undefined },
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

test("startFromStepWithArtifacts rejects a future run-state source before creating a target run", async (t) => {
  const root = tempRoot(t)
  const definition = workflow(root)
  const source = await writeFutureSourceRun(root, definition)
  const { FileRunStateStore } = require("../out/core/runStateStore.js")
  const { WorkflowRunCommandService } = loadWithVscode("workflowRunCommands.js", vscodeStub(root))
  let engineCreations = 0
  const service = new WorkflowRunCommandService({
    coreWorkflows: new Map([[definition.id, definition]]),
    runtimeFactory: {
      createRunStore: (workspaceRoot) => new FileRunStateStore({ workspaceRoot }),
      createEngine: () => {
        engineCreations += 1
        return { resumeRun: async () => { throw new Error("engine must not start from a future source run") } }
      }
    },
    ensureWorkflowsLoaded: async () => undefined,
    workflowRootCandidates: async () => [{
      root,
      name: path.basename(root),
      marker: ".bob",
      depth: "direct",
      workspaceFolderName: path.basename(root),
      workspaceFolderRoot: root
    }],
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
    service.startFromStepWithArtifacts(definition.id, "review", source.runId, {}),
    /read-only schemaVersion 'workflow-register\/run-state\/v2'/
  )

  assert.equal(engineCreations, 0)
  const runs = await new FileRunStateStore({ workspaceRoot: root }).listRuns()
  assert.deepEqual(runs.map((run) => run.runId), [source.runId])
})
