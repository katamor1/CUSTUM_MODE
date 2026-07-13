const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { FileRunStateStore } = require("../out/core/runStateStore")

async function makeWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "workflow-run-store-boundary-"))
}

function runState(runId, marker = "initial") {
  return {
    runId,
    workflowId: "workflow-register.path-boundary",
    workflowName: "path-boundary",
    status: "failed",
    currentStep: "step",
    inputs: {},
    state: { marker },
    steps: [{ id: "step", title: "Step", type: "command", status: "failed" }],
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z"
  }
}

async function outsideRunAlias(t, workspaceRoot, runId = "run-1") {
  const runsRoot = path.join(workspaceRoot, ".bob", "workflows", "runs")
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workflow-run-store-outside-"))
  const runFile = path.join(outsideRoot, "run.json")
  const controlFile = path.join(outsideRoot, "control.json")
  const runBytes = `${JSON.stringify(runState(runId), null, 2)}\n`
  const controlBytes = `${JSON.stringify({ runId, mode: "external-control" })}\n`
  await fs.mkdir(runsRoot, { recursive: true })
  await fs.writeFile(runFile, runBytes, "utf8")
  await fs.writeFile(controlFile, controlBytes, "utf8")
  try {
    await fs.symlink(
      outsideRoot,
      path.join(runsRoot, runId),
      process.platform === "win32" ? "junction" : "dir"
    )
  } catch (error) {
    await fs.rm(outsideRoot, { recursive: true, force: true })
    if (["EPERM", "EACCES", "ENOTSUP", "UNKNOWN"].includes(error.code)) {
      t.skip(`directory alias unavailable: ${error.code}`)
      return undefined
    }
    throw error
  }
  t.after(() => fs.rm(outsideRoot, { recursive: true, force: true }))
  return { runId, runFile, controlFile, runBytes, controlBytes, outsideRoot }
}

test("FileRunStateStore rejects unsafe run-id path segments", async () => {
  const workspaceRoot = await makeWorkspace()
  const store = new FileRunStateStore({ workspaceRoot })

  for (const runId of ["../outside", ".hidden", "trailing.", "CON"]) {
    await assert.rejects(store.loadRun(runId), /run id|safe|invalid|unsupported|reserved/i)
    await assert.rejects(store.saveRun(runState(runId, "mutated")), /run id|safe|invalid|unsupported|reserved/i)
  }
})

test("FileRunStateStore rejects outside run-directory aliases for load and list", async (t) => {
  const workspaceRoot = await makeWorkspace()
  const escaped = await outsideRunAlias(t, workspaceRoot)
  if (!escaped) return
  const store = new FileRunStateStore({ workspaceRoot })

  await assert.rejects(store.loadRun(escaped.runId), /workspace|outside|symlink|contain/i)
  await assert.rejects(store.listRuns(), /workspace|outside|symlink|contain/i)
  assert.equal(await fs.readFile(escaped.runFile, "utf8"), escaped.runBytes)
  assert.equal(await fs.readFile(escaped.controlFile, "utf8"), escaped.controlBytes)
})

test("FileRunStateStore rejects outside run-directory aliases before save side effects", async (t) => {
  const workspaceRoot = await makeWorkspace()
  const escaped = await outsideRunAlias(t, workspaceRoot)
  if (!escaped) return
  const store = new FileRunStateStore({ workspaceRoot, now: () => "2026-07-12T01:00:00.000Z" })

  await assert.rejects(store.saveRun(runState(escaped.runId, "mutated")), /workspace|outside|symlink|contain/i)

  assert.equal(await fs.readFile(escaped.runFile, "utf8"), escaped.runBytes)
  assert.equal(await fs.readFile(escaped.controlFile, "utf8"), escaped.controlBytes)
  assert.deepEqual((await fs.readdir(escaped.outsideRoot)).sort(), ["control.json", "run.json"])
})

test("FileRunStateStore rejects a run-directory alias even when its target stays inside the workspace", async (t) => {
  const workspaceRoot = await makeWorkspace()
  const runsRoot = path.join(workspaceRoot, ".bob", "workflows", "runs")
  const aliasedTarget = path.join(workspaceRoot, ".bob", "aliased-run")
  await fs.mkdir(runsRoot, { recursive: true })
  await fs.mkdir(aliasedTarget, { recursive: true })
  await fs.writeFile(path.join(aliasedTarget, "run.json"), `${JSON.stringify(runState("run-1"), null, 2)}\n`)
  try {
    await fs.symlink(
      aliasedTarget,
      path.join(runsRoot, "run-1"),
      process.platform === "win32" ? "junction" : "dir"
    )
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP", "UNKNOWN"].includes(error.code)) {
      t.skip(`directory alias unavailable: ${error.code}`)
      return
    }
    throw error
  }
  const store = new FileRunStateStore({ workspaceRoot })

  await assert.rejects(store.loadRun("run-1"), /alias|junction|symlink|direct run|unsupported/i)
  await assert.rejects(store.saveRun(runState("run-1", "mutated")), /alias|junction|symlink|direct run|unsupported/i)
})

test("FileRunStateStore rejects a dangling run.json file symlink", async (t) => {
  const workspaceRoot = await makeWorkspace()
  const runDirectory = path.join(workspaceRoot, ".bob", "workflows", "runs", "run-1")
  const missingOutsideFile = path.join(os.tmpdir(), `workflow-missing-run-${process.pid}-${Date.now()}.json`)
  await fs.mkdir(runDirectory, { recursive: true })
  try {
    await fs.symlink(missingOutsideFile, path.join(runDirectory, "run.json"), "file")
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP", "UNKNOWN"].includes(error.code)) {
      t.skip(`file symlink unavailable: ${error.code}`)
      return
    }
    throw error
  }
  const store = new FileRunStateStore({ workspaceRoot })

  await assert.rejects(store.loadRun("run-1"), /symlink|direct regular file|alias/i)
  await assert.rejects(store.saveRun(runState("run-1", "mutated")), /symlink|direct regular file|alias/i)
  await assert.rejects(fs.readFile(missingOutsideFile), /ENOENT/)
})

test("FileRunStateStore revalidates the run directory after temp creation and before rename", async (t) => {
  const workspaceRoot = await makeWorkspace()
  const store = new FileRunStateStore({ workspaceRoot, now: () => "2026-07-12T01:00:00.000Z" })
  await store.saveRun(runState("run-1"))
  const runDirectory = path.join(workspaceRoot, ".bob", "workflows", "runs", "run-1")
  const parkedDirectory = path.join(workspaceRoot, ".bob", "workflows", "runs", "run-1-parked")
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workflow-run-store-swap-"))
  const outsideRunFile = path.join(outsideRoot, "run.json")
  const outsideBytes = `${JSON.stringify(runState("run-1", "outside"), null, 2)}\n`
  await fs.writeFile(outsideRunFile, outsideBytes, "utf8")
  const originalWriteFile = fs.writeFile
  let swapped = false
  fs.writeFile = async function swapParentAfterTemp(file, data, options) {
    const result = await originalWriteFile.call(this, file, data, options)
    if (!swapped && String(file).endsWith(".tmp")) {
      swapped = true
      await fs.rename(runDirectory, parkedDirectory)
      await fs.symlink(
        outsideRoot,
        runDirectory,
        process.platform === "win32" ? "junction" : "dir"
      )
      await originalWriteFile.call(this, path.join(outsideRoot, path.basename(String(file))), data, options)
    }
    return result
  }
  t.after(async () => {
    fs.writeFile = originalWriteFile
    await fs.rm(outsideRoot, { recursive: true, force: true })
  })

  const candidate = runState("run-1", "mutated")
  const originalUpdatedAt = candidate.updatedAt
  await assert.rejects(store.saveRun(candidate), /changed|alias|junction|symlink|workspace|identity/i)
  assert.equal(await fs.readFile(outsideRunFile, "utf8"), outsideBytes)
  assert.equal(candidate.updatedAt, originalUpdatedAt)
})

test("FileRunStateStore list ignores only owned atomic temp files in the runs root", async () => {
  const workspaceRoot = await makeWorkspace()
  const store = new FileRunStateStore({ workspaceRoot })
  await store.saveRun(runState("run-1"))
  const runsRoot = path.join(workspaceRoot, ".bob", "workflows", "runs")
  await fs.writeFile(
    path.join(runsRoot, ".run-1.123.00000000-0000-4000-8000-000000000000.tmp"),
    "incomplete",
    "utf8"
  )

  const runs = await store.listRuns()

  assert.deepEqual(runs.map((run) => run.runId), ["run-1"])
})

test("FileRunStateStore retries a contained atomic replacement detected between open and read", async (t) => {
  const workspaceRoot = await makeWorkspace()
  const store = new FileRunStateStore({ workspaceRoot })
  await store.saveRun(runState("run-1", "initial"))
  const runFile = path.join(workspaceRoot, ".bob", "workflows", "runs", "run-1", "run.json")
  const replacementFile = path.join(path.dirname(runFile), "replacement.json")
  await fs.writeFile(replacementFile, `${JSON.stringify(runState("run-1", "replacement"), null, 2)}\n`)
  const originalOpen = fs.open
  let replaced = false
  fs.open = async function replaceBeforeOpen(file, flags, mode) {
    if (!replaced && path.resolve(String(file)) === path.resolve(runFile)) {
      replaced = true
      await fs.rename(replacementFile, runFile)
    }
    return originalOpen.call(this, file, flags, mode)
  }
  t.after(() => { fs.open = originalOpen })

  const loaded = await store.loadRun("run-1")

  assert.equal(loaded.state.marker, "replacement")
})
