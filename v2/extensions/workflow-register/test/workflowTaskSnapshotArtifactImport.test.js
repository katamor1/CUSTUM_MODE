const assert = require("node:assert/strict")
const fs = require("node:fs")
const fsPromises = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
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
    writeFiles: async (batch, commitState) => {
      for (const write of batch) writes.set(write.relativePath, write.text)
      await commitState()
    },
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
    writeFiles: async () => undefined
  })
  assert.equal(skipped.ok, false)
  assert.equal(skipped.importedCount, 0)
  assert.match(skipped.issues.map((issue) => issue.message).join("\n"), /already exists/)

  const overwritten = await importArtifactsFromTaskSnapshots({
    workflow: workflow(),
    run: targetRun,
    snapshotStore,
    writeFiles: async (_writes, commitState) => commitState(),
    overwrite: true
  })
  assert.equal(overwritten.ok, true, overwritten.issues.map((issue) => issue.message).join("\n"))
  assert.equal(targetRun.state.draft, "from export")
})

test("task snapshot import does not commit state when the manifest write fails", async () => {
  const {
    TASK_SNAPSHOT_IMPORT_STATE_KEY,
    importArtifactsFromTaskSnapshots
  } = require("../out/core/artifacts/taskSnapshotImport")
  const {
    ARTIFACT_MANIFEST_PATH,
    ARTIFACT_MANIFEST_STATE_KEY
  } = require("../out/core/artifacts/artifactManifest")
  const targetRun = run()
  targetRun.state.sentinel = "preserved"
  const snapshotStore = {
    findLatestSnapshot: async (_runId, predicate) => {
      const candidate = snapshot()
      return predicate(candidate) ? candidate : undefined
    }
  }

  await assert.rejects(
    importArtifactsFromTaskSnapshots({
      workflow: workflow(),
      run: targetRun,
      snapshotStore,
      writeFiles: async (writes) => {
        if (writes.some((write) => write.relativePath === ARTIFACT_MANIFEST_PATH.replace("{{run.id}}", targetRun.runId))) {
          throw new Error("forced manifest write failure")
        }
      }
    }),
    /forced manifest write failure/
  )

  assert.deepEqual(targetRun.state, { sentinel: "preserved" })
  assert.equal(targetRun.state.draft, undefined)
  assert.equal(targetRun.state[ARTIFACT_MANIFEST_STATE_KEY], undefined)
  assert.equal(targetRun.state[TASK_SNAPSHOT_IMPORT_STATE_KEY], undefined)
})

test("task snapshot import restores an existing artifact and manifest when batch commit fails", async (t) => {
  const {
    importArtifactsFromTaskSnapshots
  } = require("../out/core/artifacts/taskSnapshotImport")
  const {
    ARTIFACT_MANIFEST_STATE_KEY,
    createWorkflowArtifactManifestEntry,
    updateWorkflowArtifactManifest
  } = require("../out/core/artifacts/artifactManifest")
  const { writeWorkspaceFilesAtomically } = require("../out/core/runtime/workspaceFileTransaction")
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-register-snapshot-transaction-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const targetWorkflow = { ...workflow(), workflowRoot: root }
  const targetRun = run()
  const artifact = targetWorkflow.artifacts[0]
  const step = targetWorkflow.engineSteps[0]
  const artifactRelative = artifact.path.replace("{{run.id}}", targetRun.runId)
  const manifestRelative = `.bob/workflows/runs/${targetRun.runId}/artifacts/manifest.json`
  const artifactPath = path.join(root, artifactRelative)
  const manifestPath = path.join(root, manifestRelative)
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true })
  fs.writeFileSync(artifactPath, "old draft")
  targetRun.state.draft = "old draft"
  const oldEntry = createWorkflowArtifactManifestEntry({
    artifact,
    step,
    path: artifactRelative,
    text: "old draft",
    now: () => "2026-07-08T00:00:01.000Z"
  })
  const oldManifest = updateWorkflowArtifactManifest({
    workflow: targetWorkflow,
    run: targetRun,
    entries: [oldEntry],
    now: () => "2026-07-08T00:00:01.000Z"
  })
  const oldManifestFile = `${JSON.stringify(oldManifest, null, 2)}\n`
  const oldManifestState = targetRun.state[ARTIFACT_MANIFEST_STATE_KEY]
  fs.writeFileSync(manifestPath, oldManifestFile)
  const snapshotStore = {
    findLatestSnapshot: async (_runId, predicate) => {
      const candidate = snapshot("new draft")
      return predicate(candidate) ? candidate : undefined
    }
  }

  const originalRename = fsPromises.rename
  let injected = false
  fsPromises.rename = async (source, target) => {
    if (!injected && path.resolve(target) === path.resolve(manifestPath) && String(source).includes(".workflow-txn-")) {
      injected = true
      throw new Error("forced snapshot manifest commit failure")
    }
    return originalRename(source, target)
  }

  try {
    await assert.rejects(
      importArtifactsFromTaskSnapshots({
        workflow: targetWorkflow,
        run: targetRun,
        snapshotStore,
        overwrite: true,
        writeFiles: (writes, commitState) => writeWorkspaceFilesAtomically(root, writes, commitState)
      }),
      /forced snapshot manifest commit failure/
    )
  } finally {
    fsPromises.rename = originalRename
  }

  assert.equal(injected, true)
  assert.equal(fs.readFileSync(artifactPath, "utf8"), "old draft")
  assert.equal(fs.readFileSync(manifestPath, "utf8"), oldManifestFile)
  assert.equal(targetRun.state.draft, "old draft")
  assert.equal(targetRun.state[ARTIFACT_MANIFEST_STATE_KEY], oldManifestState)
})

test("task snapshot import rolls files and in-memory state back when durable run save fails", async (t) => {
  const { importArtifactsFromTaskSnapshots } = require("../out/core/artifacts/taskSnapshotImport")
  const { writeWorkspaceFilesAtomically } = require("../out/core/runtime/workspaceFileTransaction")
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-register-snapshot-save-rollback-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const targetWorkflow = { ...workflow(), workflowRoot: root }
  const targetRun = run()
  targetRun.state.sentinel = "preserved"
  const artifactRelative = targetWorkflow.artifacts[0].path.replace("{{run.id}}", targetRun.runId)
  const manifestRelative = `.bob/workflows/runs/${targetRun.runId}/artifacts/manifest.json`
  const snapshotStore = {
    findLatestSnapshot: async (_runId, predicate) => {
      const candidate = snapshot("new draft")
      return predicate(candidate) ? candidate : undefined
    }
  }

  await assert.rejects(
    importArtifactsFromTaskSnapshots({
      workflow: targetWorkflow,
      run: targetRun,
      snapshotStore,
      writeFiles: async (writes, commitState) => {
        assert.equal(typeof commitState, "function", "snapshot batch must provide its state commit callback")
        await writeWorkspaceFilesAtomically(root, writes, async () => {
          await commitState()
          throw new Error("forced snapshot run save failure")
        })
      }
    }),
    /forced snapshot run save failure/
  )

  assert.deepEqual(targetRun.state, { sentinel: "preserved" })
  assert.equal(fs.existsSync(path.join(root, artifactRelative)), false)
  assert.equal(fs.existsSync(path.join(root, manifestRelative)), false)
})

test("task snapshot import durably restores prior state when run save reports failure after replacement", async (t) => {
  const { importArtifactsFromTaskSnapshots } = require("../out/core/artifacts/taskSnapshotImport")
  const { writeWorkspaceFilesAtomically } = require("../out/core/runtime/workspaceFileTransaction")
  const { FileRunStateStore } = require("../out/core/runStateStore")
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-register-snapshot-post-save-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const targetWorkflow = { ...workflow(), workflowRoot: root }
  const targetRun = run()
  targetRun.state.sentinel = "preserved"
  const runStore = new FileRunStateStore({ workspaceRoot: root })
  await runStore.saveRun(targetRun)
  const snapshotStore = {
    findLatestSnapshot: async (_runId, predicate) => {
      const candidate = snapshot("new draft")
      return predicate(candidate) ? candidate : undefined
    }
  }

  await assert.rejects(
    importArtifactsFromTaskSnapshots({
      workflow: targetWorkflow,
      run: targetRun,
      snapshotStore,
      persistStateRollback: () => runStore.saveRun(targetRun),
      writeFiles: (writes, commitState) => writeWorkspaceFilesAtomically(root, writes, async () => {
        await commitState()
        await runStore.saveRun(targetRun)
        throw new Error("post-replacement run save failure")
      })
    }),
    /post-replacement run save failure/
  )

  const persisted = await runStore.loadRun(targetRun.runId)
  assert.deepEqual(targetRun.state, { sentinel: "preserved" })
  assert.deepEqual(persisted.state, { sentinel: "preserved" })
  assert.equal(fs.existsSync(path.join(root, `.bob/workflows/runs/${targetRun.runId}/artifacts/draft/draft.md`)), false)
  assert.equal(fs.existsSync(path.join(root, `.bob/workflows/runs/${targetRun.runId}/artifacts/manifest.json`)), false)
})
