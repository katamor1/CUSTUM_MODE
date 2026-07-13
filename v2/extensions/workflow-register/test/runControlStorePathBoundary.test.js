const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { FileRunControlStore } = require("../out/core/runControlStore")

async function makeWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "workflow-run-control-boundary-"))
}

function controlState(runId, marker = "initial") {
  return {
    schemaVersion: "workflow-register/run-control/v1",
    runId,
    pauseRequestedAt: "2026-07-12T00:00:00.000Z",
    pauseReason: marker,
    requestedBy: "test",
    mode: "afterCurrentStep"
  }
}

async function createRunDirectoryAlias(t, workspaceRoot, targetRoot, runId = "run-1") {
  const runsRoot = path.join(workspaceRoot, ".bob", "workflows", "runs")
  await fs.mkdir(runsRoot, { recursive: true })
  try {
    await fs.symlink(
      targetRoot,
      path.join(runsRoot, runId),
      process.platform === "win32" ? "junction" : "dir"
    )
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP", "UNKNOWN"].includes(error.code)) {
      t.skip(`directory alias unavailable: ${error.code}`)
      return false
    }
    throw error
  }
  return true
}

test("FileRunControlStore rejects unsafe run ids instead of normalizing them", async () => {
  const workspaceRoot = await makeWorkspace()
  const store = new FileRunControlStore({ workspaceRoot })

  for (const runId of ["../outside", ".hidden", "trailing.", "CON"]) {
    await assert.rejects(store.loadControl(runId), /run id|safe|invalid|unsupported|reserved/i)
    await assert.rejects(store.requestPause({ runId }), /run id|safe|invalid|unsupported|reserved/i)
  }
})

test("FileRunControlStore rejects an external run-directory alias without changing external files", async (t) => {
  const workspaceRoot = await makeWorkspace()
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workflow-run-control-outside-"))
  const runId = "run-1"
  const runFile = path.join(outsideRoot, "run.json")
  const controlFile = path.join(outsideRoot, "control.json")
  const runBytes = `${JSON.stringify({ runId, state: { marker: "external" } })}\n`
  const controlBytes = `${JSON.stringify(controlState(runId), null, 2)}\n`
  await fs.writeFile(runFile, runBytes, "utf8")
  await fs.writeFile(controlFile, controlBytes, "utf8")
  t.after(() => fs.rm(outsideRoot, { recursive: true, force: true }))
  if (!await createRunDirectoryAlias(t, workspaceRoot, outsideRoot, runId)) return
  const store = new FileRunControlStore({ workspaceRoot, now: () => "2026-07-12T01:00:00.000Z" })

  await assert.rejects(store.loadControl(runId), /workspace|outside|symlink|junction|alias|direct/i)
  await assert.rejects(store.requestPause({ runId, reason: "mutated" }), /workspace|outside|symlink|junction|alias|direct/i)

  assert.equal(await fs.readFile(runFile, "utf8"), runBytes)
  assert.equal(await fs.readFile(controlFile, "utf8"), controlBytes)
  assert.deepEqual((await fs.readdir(outsideRoot)).sort(), ["control.json", "run.json"])
})

test("FileRunControlStore rejects a run-directory alias outside the canonical runs root but inside the workspace", async (t) => {
  const workspaceRoot = await makeWorkspace()
  const targetRoot = path.join(workspaceRoot, ".bob", "aliased-control")
  const runId = "run-1"
  const controlFile = path.join(targetRoot, "control.json")
  const controlBytes = `${JSON.stringify(controlState(runId), null, 2)}\n`
  await fs.mkdir(targetRoot, { recursive: true })
  await fs.writeFile(controlFile, controlBytes, "utf8")
  if (!await createRunDirectoryAlias(t, workspaceRoot, targetRoot, runId)) return
  const store = new FileRunControlStore({ workspaceRoot })

  await assert.rejects(store.loadControl(runId), /symlink|junction|alias|direct/i)
  await assert.rejects(store.clearPause(runId), /symlink|junction|alias|direct/i)

  assert.equal(await fs.readFile(controlFile, "utf8"), controlBytes)
})
