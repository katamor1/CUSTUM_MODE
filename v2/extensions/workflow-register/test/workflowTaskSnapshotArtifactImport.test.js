const assert = require("node:assert/strict")
const { test } = require("node:test")

function workflow() {
  return {
    id: "workflow-register.snapshot-import",
    name: "snapshot-import",
    label: "Snapshot Import",
    description: "Snapshot import workflow.",
    schemaVersion: "workflow-register/v1",
    definitionHash: "definition-v1",
    filePath: ".bob/workflows/snapshot-import/WORKFLOW.md",
    inputs: {},
    artifacts: [
      {
        id: "draft",
        producedBy: "draft",
        path: ".bob/workflows/runs/{{run.id}}/artifacts/draft/draft.md",
        schema: "text/markdown"
      }
    ],
    engineSteps: [
      { id: "draft", title: "Draft", type: "agent", prompt: "Draft", resultKey: "draft" }
    ]
  }
}

function run() {
  return {
    runId: "run-1",
    workflowId: "workflow-register.snapshot-import",
    workflowName: "Snapshot Import",
    status: "completed",
    inputs: {},
    state: {},
    steps: [{ id: "draft", title: "Draft", type: "agent", status: "completed" }],
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:01.000Z"
  }
}

function snapshot(text = "Recovered draft") {
  return {
    schemaVersion: "workflow-register/task-snapshot/v1",
    createdAt: "2026-07-08T00:00:02.000Z",
    reason: "agent-output",
    runId: "run-1",
    workflowId: "workflow-register.snapshot-import",
    workflowDefinitionHash: "definition-v1",
    stepId: "draft",
    lastAssistantText: text
  }
}

test("task snapshot import writes artifacts and creates a manifest", async () => {
  const {
    TASK_SNAPSHOT_IMPORT_STATE_KEY,
    importArtifactsFromTaskSnapshots
  } = require("../out/core/artifacts/taskSnapshotImport")
  const { ARTIFACT_MANIFEST_STATE_KEY } = require("../out/core/artifacts/artifactManifest")
  const targetRun = run()
  const writes = new Map()
  const snapshotStore = {
    findLatestSnapshot: async (_runId, predicate) => {
      const candidate = snapshot()
      return predicate(candidate) ? candidate : undefined
    }
  }

  const result = await importArtifactsFromTaskSnapshots({
    workflow: workflow(),
    run: targetRun,
    snapshotStore,
    writeFile: async (relativePath, text) => writes.set(relativePath, text),
    now: () => "2026-07-08T00:00:03.000Z"
  })

  assert.equal(result.ok, true, result.issues.map((issue) => issue.message).join("\n"))
  assert.equal(result.importedCount, 1)
  assert.equal(targetRun.state.draft, "Recovered draft")
  assert.equal(writes.get(".bob/workflows/runs/run-1/artifacts/draft/draft.md"), "Recovered draft")
  assert.ok(writes.has(".bob/workflows/runs/run-1/artifacts/manifest.json"))
  const manifest = JSON.parse(targetRun.state[ARTIFACT_MANIFEST_STATE_KEY])
  assert.equal(manifest.artifacts[0].source, "task-snapshot")
  assert.equal(manifest.artifacts[0].id, "draft")
  const provenance = JSON.parse(targetRun.state[TASK_SNAPSHOT_IMPORT_STATE_KEY])
  assert.equal(provenance.schemaVersion, "workflow-register/task-snapshot-import/v1")
  assert.equal(provenance.imported[0].artifactId, "draft")
  assert.equal(provenance.imported[0].snapshotReason, "agent-output")
})

test("task snapshot import falls back to taskExport text and does not overwrite state by default", async () => {
  const { importArtifactsFromTaskSnapshots } = require("../out/core/artifacts/taskSnapshotImport")
  const targetRun = run()
  targetRun.state.draft = "already imported"
  const snapshotStore = {
    findLatestSnapshot: async (_runId, predicate) => {
      const candidate = { ...snapshot(undefined), lastAssistantText: undefined, taskExport: { resultText: "from export" } }
      return predicate(candidate) ? candidate : undefined
    }
  }

  const skipped = await importArtifactsFromTaskSnapshots({
    workflow: workflow(),
    run: targetRun,
    snapshotStore,
    writeFile: async () => undefined
  })
  assert.equal(skipped.ok, false)
  assert.equal(skipped.importedCount, 0)
  assert.match(skipped.issues.map((issue) => issue.message).join("\n"), /already exists/)

  const overwritten = await importArtifactsFromTaskSnapshots({
    workflow: workflow(),
    run: targetRun,
    snapshotStore,
    writeFile: async () => undefined,
    overwrite: true
  })
  assert.equal(overwritten.ok, true, overwritten.issues.map((issue) => issue.message).join("\n"))
  assert.equal(targetRun.state.draft, "from export")
})
