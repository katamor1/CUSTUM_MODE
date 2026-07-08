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
