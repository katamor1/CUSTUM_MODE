const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "workflow-register-artifacts-"))
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex")
}

test("workflow engine writes a manifest for produced workflow artifacts", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const workflow = {
    id: "workflow-register.artifact-manifest",
    name: "artifact-manifest",
    label: "Artifact Manifest",
    description: "Artifact manifest workflow.",
    schemaVersion: "workflow-register/v1",
    definitionHash: "definition-v1",
    filePath: ".bob/workflows/artifact-manifest/WORKFLOW.md",
    inputs: { revision: { type: "string", required: true } },
    artifacts: [
      {
        id: "context",
        producedBy: "collect",
        path: ".bob/workflows/runs/{{run.id}}/artifacts/collect/context.txt",
        schema: "text/plain"
      }
    ],
    engineSteps: [
      {
        id: "collect",
        title: "Collect",
        type: "command",
        action: { provider: "sample.collect" },
        resultKey: "context"
      }
    ]
  }
  const actions = new ActionRegistry()
  actions.register({ id: "sample.collect", execute: async (input) => `context-${input.inputs.revision}` })
  const runStore = new FileRunStateStore({ workspaceRoot, now: () => "2026-07-08T00:00:00.000Z", engineVersion: "test-engine" })
  const engine = new WorkflowEngine({
    actions,
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore
  })

  const run = await engine.runWorkflow(workflow, { revision: "77" })
  const artifactPath = path.join(workspaceRoot, ".bob", "workflows", "runs", run.runId, "artifacts", "collect", "context.txt")
  const manifestPath = path.join(workspaceRoot, ".bob", "workflows", "runs", run.runId, "artifacts", "manifest.json")
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))

  assert.equal(run.status, "completed")
  assert.equal(fs.readFileSync(artifactPath, "utf8"), "context-77")
  assert.equal(manifest.schemaVersion, "workflow-register/artifact-manifest/v1")
  assert.equal(manifest.workflowId, workflow.id)
  assert.equal(manifest.runId, run.runId)
  assert.equal(manifest.inputsHash, `sha256:${sha256(JSON.stringify({ revision: "77" }))}`)
  assert.equal(manifest.artifacts.length, 1)
  assert.deepEqual(
    {
      id: manifest.artifacts[0].id,
      stateKey: manifest.artifacts[0].stateKey,
      producedBy: manifest.artifacts[0].producedBy,
      path: manifest.artifacts[0].path,
      schema: manifest.artifacts[0].schema,
      sha256: manifest.artifacts[0].sha256,
      bytes: manifest.artifacts[0].bytes,
      source: manifest.artifacts[0].source
    },
    {
      id: "context",
      stateKey: "context",
      producedBy: "collect",
      path: `.bob/workflows/runs/${run.runId}/artifacts/collect/context.txt`,
      schema: "text/plain",
      sha256: sha256("context-77"),
      bytes: Buffer.byteLength("context-77", "utf8"),
      source: "workflow-artifact"
    }
  )
  assert.equal(JSON.parse(run.state["workflow.artifactManifest"]).artifacts[0].id, "context")
})

test("failed manifest sink does not commit manifest state", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { FileRunStateStore } = require("../out/core/runStateStore")
  const { ResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const {
    ARTIFACT_MANIFEST_PATH,
    ARTIFACT_MANIFEST_STATE_KEY
  } = require("../out/core/artifacts/artifactManifest")

  const workspaceRoot = tempDir()
  const workflow = {
    id: "workflow-register.artifact-manifest-failure",
    name: "artifact-manifest-failure",
    label: "Artifact Manifest Failure",
    description: "Do not expose a manifest whose sink failed.",
    schemaVersion: "workflow-register/v1",
    definitionHash: "definition-v1",
    filePath: ".bob/workflows/artifact-manifest-failure/WORKFLOW.md",
    inputs: {},
    artifacts: [
      {
        id: "context",
        producedBy: "collect",
        path: ".bob/workflows/runs/{{run.id}}/artifacts/collect/context.txt"
      }
    ],
    engineSteps: [
      { id: "collect", title: "Collect", type: "command", action: { provider: "sample.collect" }, resultKey: "context" }
    ]
  }
  const actions = new ActionRegistry()
  actions.register({ id: "sample.collect", execute: async () => "context" })
  const resultSinks = new ResultSinkRegistry()
  resultSinks.registerFileTransaction(async (writes) => (
    writes.some((write) => write.sink.path === ARTIFACT_MANIFEST_PATH)
      ? { ok: false, error: "forced manifest write failure" }
      : { ok: true }
  ))
  const runStore = new FileRunStateStore({ workspaceRoot, now: () => "2026-07-08T00:00:00.000Z", engineVersion: "test-engine" })
  const engine = new WorkflowEngine({ actions, resultSinks, runStore })

  const run = await engine.runWorkflow(workflow, {})
  const persisted = await runStore.loadRun(run.runId)

  assert.equal(run.status, "failed")
  assert.match(run.error, /forced manifest write failure/)
  assert.equal(run.state.context, undefined, "command result remains staged when the artifact transaction fails")
  assert.equal(run.state[ARTIFACT_MANIFEST_STATE_KEY], undefined)
  assert.equal(persisted.state[ARTIFACT_MANIFEST_STATE_KEY], undefined)
})

test("artifact manifest transaction restores an existing artifact when manifest commit fails", async (t) => {
  const fsPromises = require("node:fs/promises")
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { writeProducedArtifacts } = require("../out/core/engine/resultWriters")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }))
  const step = { id: "collect", title: "Collect", type: "command", action: { provider: "sample.collect" }, resultKey: "context" }
  const workflow = {
    id: "workflow-register.artifact-manifest-rollback",
    name: "artifact-manifest-rollback",
    label: "Artifact Manifest Rollback",
    description: "Restore prior artifact bytes when manifest publication fails.",
    schemaVersion: "workflow-register/v1",
    definitionHash: "definition-v1",
    filePath: ".bob/workflows/artifact-manifest-rollback/WORKFLOW.md",
    workflowRoot: workspaceRoot,
    inputs: {},
    artifacts: [{
      id: "context",
      producedBy: "collect",
      path: ".bob/workflows/runs/{{run.id}}/artifacts/collect/context.txt",
      schema: "text/plain"
    }],
    engineSteps: [step]
  }
  const actions = new ActionRegistry()
  actions.register({ id: "sample.collect", execute: async () => "old context" })
  const runStore = new FileRunStateStore({ workspaceRoot, now: () => "2026-07-08T00:00:00.000Z", engineVersion: "test-engine" })
  const resultSinks = createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined })
  const run = await new WorkflowEngine({ actions, resultSinks, runStore }).runWorkflow(workflow, {})
  const artifactPath = path.join(workspaceRoot, ".bob", "workflows", "runs", run.runId, "artifacts", "collect", "context.txt")
  const manifestPath = path.join(workspaceRoot, ".bob", "workflows", "runs", run.runId, "artifacts", "manifest.json")
  const oldManifestFile = fs.readFileSync(manifestPath, "utf8")
  const oldManifestState = run.state["workflow.artifactManifest"]

  const originalRename = fsPromises.rename
  let injected = false
  fsPromises.rename = async (source, target) => {
    if (!injected && path.resolve(target) === path.resolve(manifestPath) && String(source).includes(".workflow-txn-")) {
      injected = true
      throw new Error("forced manifest commit failure")
    }
    return originalRename(source, target)
  }

  let result
  try {
    result = await writeProducedArtifacts({ workflow, run, step, resultSinks, stateOverlay: { context: "new context" } })
  } finally {
    fsPromises.rename = originalRename
  }

  assert.equal(injected, true)
  assert.equal(result.ok, false)
  assert.match(result.error, /forced manifest commit failure/)
  assert.equal(fs.readFileSync(artifactPath, "utf8"), "old context")
  assert.equal(fs.readFileSync(manifestPath, "utf8"), oldManifestFile)
  assert.equal(run.state["workflow.artifactManifest"], oldManifestState)
})

test("artifact transaction rolls files and in-memory state back when durable run save fails", async (t) => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")
  const workspaceRoot = tempDir()
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }))
  const step = { id: "collect", title: "Collect", type: "command", action: { provider: "sample.collect" }, resultKey: "context" }
  const workflow = {
    id: "workflow-register.artifact-run-save-rollback",
    name: "artifact-run-save-rollback",
    label: "Artifact Run Save Rollback",
    schemaVersion: "workflow-register/v1",
    workflowRoot: workspaceRoot,
    inputs: {},
    artifacts: [{ id: "context", producedBy: "collect", path: ".bob/workflows/runs/{{run.id}}/artifacts/context.txt" }],
    engineSteps: [step]
  }
  const actions = new ActionRegistry()
  let providerValue = "old context"
  actions.register({ id: "sample.collect", execute: async () => providerValue })
  const delegate = new FileRunStateStore({ workspaceRoot, engineVersion: "test-engine" })
  let failProviderPhaseSave = false
  const runStore = {
    workspaceRoot,
    createRun: (...args) => delegate.createRun(...args),
    loadRun: (...args) => delegate.loadRun(...args),
    listRuns: (...args) => delegate.listRuns(...args),
    findRecoverableRun: (...args) => delegate.findRecoverableRun(...args),
    saveRun: async (candidate) => {
      if (failProviderPhaseSave && Object.keys(candidate.state).some((key) => key.startsWith("workflow.commandProviderCompleted."))) {
        failProviderPhaseSave = false
        throw new Error("forced durable run save failure")
      }
      return delegate.saveRun(candidate)
    }
  }
  const resultSinks = createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined })
  const engine = new WorkflowEngine({ actions, resultSinks, runStore })
  const original = await engine.runWorkflow(workflow, {})
  const artifactPath = path.join(workspaceRoot, ".bob", "workflows", "runs", original.runId, "artifacts", "context.txt")
  const manifestPath = path.join(workspaceRoot, ".bob", "workflows", "runs", original.runId, "artifacts", "manifest.json")
  const oldManifestFile = fs.readFileSync(manifestPath, "utf8")
  const oldManifestState = original.state["workflow.artifactManifest"]
  original.status = "running"
  original.currentStep = "collect"
  original.steps[0].status = "pending"
  original.steps[0].completedAt = undefined
  await delegate.saveRun(original)

  providerValue = "new context"
  failProviderPhaseSave = true
  const failed = await engine.resumeRun(original.runId, { workflow })

  assert.equal(failed.status, "failed")
  assert.match(failed.error, /forced durable run save failure/)
  assert.equal(fs.readFileSync(artifactPath, "utf8"), "old context")
  assert.equal(fs.readFileSync(manifestPath, "utf8"), oldManifestFile)
  assert.equal(failed.state.context, "old context")
  assert.equal(failed.state["workflow.artifactManifest"], oldManifestState)
  assert.equal(Object.keys(failed.state).some((key) => key.startsWith("workflow.commandProviderCompleted.")), false)
})

test("artifact transaction falls back to a registered legacy file sink", async (t) => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { ResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")
  const workspaceRoot = tempDir()
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }))
  const workflow = {
    id: "workflow-register.legacy-file-sink",
    name: "legacy-file-sink",
    label: "Legacy File Sink",
    schemaVersion: "workflow-register/v1",
    workflowRoot: workspaceRoot,
    inputs: {},
    artifacts: [{
      id: "context",
      producedBy: "collect",
      path: ".bob/workflows/runs/{{run.id}}/artifacts/context.txt"
    }],
    engineSteps: [{
      id: "collect",
      title: "Collect",
      type: "command",
      action: { provider: "sample.collect" },
      resultKey: "context"
    }]
  }
  const actions = new ActionRegistry()
  actions.register({ id: "sample.collect", execute: async () => "legacy context" })
  const resultSinks = new ResultSinkRegistry()
  const fileCalls = []
  resultSinks.register("file", async (sink, input) => {
    fileCalls.push({ path: sink.path, text: input.text })
    return { ok: true }
  })
  const runStore = new FileRunStateStore({ workspaceRoot, engineVersion: "test-engine" })
  const run = await new WorkflowEngine({ actions, resultSinks, runStore }).runWorkflow(workflow, {})

  assert.equal(run.status, "completed")
  assert.equal(run.state.context, "legacy context")
  assert.equal(fileCalls.length, 2, "legacy file handler receives the artifact and manifest writes")
  assert.equal(fileCalls[0].text, "legacy context")
  assert.match(fileCalls[1].path, /manifest\.json$/)
  assert.equal(JSON.parse(run.state["workflow.artifactManifest"]).artifacts[0].id, "context")
})

test("legacy file transaction commits state only after every file handler succeeds", async () => {
  const { ResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const resultSinks = new ResultSinkRegistry()
  let fileCalls = 0
  let stateCommitted = false
  resultSinks.register("file", async () => {
    fileCalls += 1
    return fileCalls === 2
      ? { ok: false, error: "second legacy write failed" }
      : { ok: true }
  })

  const result = await resultSinks.writeFileTransaction([
    { sink: { type: "file", path: "first.txt" }, input: { text: "first" } },
    { sink: { type: "file", path: "second.txt" }, input: { text: "second" } }
  ], () => { stateCommitted = true })

  assert.equal(result.ok, false)
  assert.match(result.error, /second legacy write failed/)
  assert.equal(fileCalls, 2)
  assert.equal(stateCommitted, false)
})
