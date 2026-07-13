const assert = require("node:assert/strict")
const fs = require("node:fs")
const fsp = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { FileRunStateStore } = require("../out/core/runStateStore.js")

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-run-recovery-preference-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function workflow() {
  return {
    id: "workflow-register.recovery-preference",
    name: "recovery-preference",
    definitionHash: "sha256:recovery-preference",
    filePath: ".bob/workflows/recovery-preference/WORKFLOW.md",
    engineSteps: [{ id: "review", title: "Review", type: "manual" }]
  }
}

async function writeRun(root, run) {
  const directory = path.join(root, ".bob", "workflows", "runs", run.runId)
  await fsp.mkdir(directory, { recursive: true })
  await fsp.writeFile(path.join(directory, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8")
}

function run(runId, schemaVersion, updatedAt) {
  const definition = workflow()
  return {
    schemaVersion,
    runId,
    workflowId: definition.id,
    workflowName: definition.name,
    workflowDefinitionHash: definition.definitionHash,
    workflowFile: definition.filePath,
    status: "running",
    currentStep: "review",
    inputs: {},
    state: {},
    steps: [{ id: "review", title: "Review", type: "manual", status: "pending" }],
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt
  }
}

async function prepareRuns(t) {
  const root = tempRoot(t)
  const current = run(
    "20260712T000000Z-current-recovery",
    "workflow-register/run-state/v1",
    "2026-07-12T00:01:00.000Z"
  )
  const future = run(
    "20260712T000000Z-future-evidence",
    "workflow-register/run-state/v2",
    "2026-07-12T00:02:00.000Z"
  )
  await writeRun(root, current)
  await writeRun(root, future)
  return { root, current, future }
}

test("single-step recovery returns a current run even when newer future evidence also matches", async (t) => {
  const { root, current } = await prepareRuns(t)
  const store = new FileRunStateStore({ workspaceRoot: root })

  const selected = await store.findRecoverableRun(workflow(), {}, {
    executionMode: "singleStep",
    stepId: "review"
  })

  assert.equal(selected.runId, current.runId)
})

test("single-step recovery preserves an explicitly loaded future run target", async (t) => {
  const { root, future } = await prepareRuns(t)
  const store = new FileRunStateStore({ workspaceRoot: root })
  const selectedFuture = await store.loadRun(future.runId)

  await assert.rejects(
    store.findRecoverableRun(workflow(), selectedFuture.inputs, {
      executionMode: "singleStep",
      stepId: "review"
    }),
    /read-only schemaVersion 'workflow-register\/run-state\/v2'/
  )
})
