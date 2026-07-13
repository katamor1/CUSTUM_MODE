const assert = require("node:assert/strict")
const fs = require("node:fs")
const fsp = require("node:fs/promises")
const { spawn } = require("node:child_process")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const {
  CURRENT_WORKFLOW_RUN_LOCK_SCHEMA_VERSION,
  parseWorkflowRunLock,
  serializeWorkflowRunLock,
  withWorkflowRunLock
} = require("../out/core/runtime/runLock.js")
const {
  readRunDurabilityFile,
  replaceRunDurabilityFile
} = require("../out/core/runtime/runDurabilityPath.js")

function root(t) {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-lock-"))
  t.after(() => fs.rmSync(value, { recursive: true, force: true }))
  return value
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function owner(overrides = {}) {
  return {
    schemaVersion: "workflow-register/run-lock/v1",
    runId: "run-1",
    token: "owner-token",
    pid: 999999,
    hostname: os.hostname(),
    createdAt: "2026-07-12T00:00:00.000Z",
    heartbeatAt: "2026-07-12T00:00:00.000Z",
    ...overrides
  }
}

test("lock parser validates the persisted owner contract", async (t) => {
  const value = owner()
  assert.deepEqual(parseWorkflowRunLock(value, "run-1"), value)
  assert.equal(JSON.parse(serializeWorkflowRunLock(value)).schemaVersion, CURRENT_WORKFLOW_RUN_LOCK_SCHEMA_VERSION)
  const cases = [
    ["schema", { ...value, schemaVersion: "workflow-register/run-lock/v2" }, /schemaVersion/],
    ["run id", { ...value, runId: "other" }, /run id/],
    ["token", { ...value, token: "" }, /token/],
    ["pid", { ...value, pid: 0 }, /pid/],
    ["heartbeat", { ...value, heartbeatAt: 1 }, /heartbeatAt/]
  ]
  for (const [name, candidate, pattern] of cases) {
    await t.test(name, () => assert.throws(() => parseWorkflowRunLock(candidate, "run-1"), pattern))
  }
})

test("same-run callers serialize while different runs and roots remain independent", async (t) => {
  const workspaceA = root(t)
  const workspaceB = root(t)
  const firstStarted = deferred()
  const releaseFirst = deferred()
  const otherRunStarted = deferred()
  const otherRootStarted = deferred()
  const order = []

  const first = withWorkflowRunLock(workspaceA, "run-1", async () => {
    order.push("first:start")
    firstStarted.resolve()
    await releaseFirst.promise
    order.push("first:end")
  }, { timeoutMs: 1_000, heartbeatMs: 0 })
  await firstStarted.promise
  const second = withWorkflowRunLock(workspaceA, "run-1", async () => order.push("second"), { timeoutMs: 1_000, heartbeatMs: 0, pollMs: 5 })
  const otherRun = withWorkflowRunLock(workspaceA, "run-2", async () => otherRunStarted.resolve(), { heartbeatMs: 0 })
  const otherRoot = withWorkflowRunLock(workspaceB, "run-1", async () => otherRootStarted.resolve(), { heartbeatMs: 0 })
  await Promise.all([otherRunStarted.promise, otherRootStarted.promise])
  assert.deepEqual(order, ["first:start"])
  releaseFirst.resolve()
  await Promise.all([first, second, otherRun, otherRoot])
  assert.deepEqual(order, ["first:start", "first:end", "second"])
})

test("same async chain re-enters one lock without deadlock", async (t) => {
  const workspace = root(t)
  const result = await withWorkflowRunLock(workspace, "run-1", () => (
    withWorkflowRunLock(workspace, "run-1", async () => "nested", { timeoutMs: 10, heartbeatMs: 0 })
  ), { timeoutMs: 10, heartbeatMs: 0 })
  assert.equal(result, "nested")
})

test("a child process prevents a second process from acquiring an active lease", async (t) => {
  const workspace = root(t)
  const fixture = path.join(__dirname, "fixtures", "run-lock-holder.js")
  const child = spawn(process.execPath, [fixture, workspace, "run-1"], { stdio: ["pipe", "pipe", "pipe"] })
  t.after(() => child.kill())
  await new Promise((resolve, reject) => {
    let output = ""
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      output += chunk
      if (output.includes("READY\n")) resolve()
    })
    child.once("exit", (code) => reject(new Error(`lock holder exited early: ${code}`)))
  })
  await assert.rejects(
    withWorkflowRunLock(workspace, "run-1", async () => undefined, { timeoutMs: 75, pollMs: 5, heartbeatMs: 0 }),
    /busy|locked by/i
  )
  child.stdin.end("\n")
  assert.equal(await new Promise((resolve) => child.once("exit", resolve)), 0)
})

test("stale ownership is reclaimed only under the documented rules", async (t) => {
  const cases = [
    {
      name: "dead same-host pid",
      lock: owner(),
      mtime: Date.now(),
      options: { processAlive: () => false },
      acquired: true
    },
    {
      name: "live same-host pid",
      lock: owner(),
      mtime: Date.now() - 60_000,
      options: { processAlive: () => true },
      acquired: false
    },
    {
      name: "stale foreign host",
      lock: owner({ hostname: "other-host" }),
      mtime: Date.now() - 60_000,
      options: { processAlive: () => false },
      acquired: true
    }
  ]
  for (const item of cases) {
    await t.test(item.name, async (t) => {
      const workspace = root(t)
      await replaceRunDurabilityFile(workspace, "run-1", "run.lock.json", serializeWorkflowRunLock(item.lock))
      const lockPath = (await readRunDurabilityFile(workspace, "run-1", "run.lock.json")).filePath
      await fsp.utimes(lockPath, item.mtime / 1000, item.mtime / 1000)
      const operation = withWorkflowRunLock(workspace, "run-1", async () => "acquired", {
        timeoutMs: 40,
        pollMs: 5,
        heartbeatMs: 0,
        staleMs: 1_000,
        now: () => new Date("2026-07-12T00:01:00.000Z"),
        hostname: os.hostname(),
        ...item.options
      })
      if (item.acquired) assert.equal(await operation, "acquired")
      else await assert.rejects(operation, /busy|locked by/i)
    })
  }
})

test("malformed recent locks are preserved while malformed stale locks are reclaimable", async (t) => {
  for (const [name, ageMs, acquired] of [["recent", 0, false], ["stale", 60_000, true]]) {
    await t.test(name, async (t) => {
      const workspace = root(t)
      await replaceRunDurabilityFile(workspace, "run-1", "run.lock.json", "{invalid\n")
      const snapshot = await readRunDurabilityFile(workspace, "run-1", "run.lock.json")
      const when = Date.now() - ageMs
      await fsp.utimes(snapshot.filePath, when / 1000, when / 1000)
      const operation = withWorkflowRunLock(workspace, "run-1", async () => "acquired", {
        timeoutMs: 40,
        pollMs: 5,
        heartbeatMs: 0,
        staleMs: 1_000
      })
      if (acquired) assert.equal(await operation, "acquired")
      else await assert.rejects(operation, /busy|locked by/i)
    })
  }
})

test("release never deletes a replacement owner token", async (t) => {
  const workspace = root(t)
  await withWorkflowRunLock(workspace, "run-1", async () => {
    const replacement = owner({ token: "replacement-token", pid: process.pid, heartbeatAt: new Date().toISOString() })
    await replaceRunDurabilityFile(workspace, "run-1", "run.lock.json", serializeWorkflowRunLock(replacement))
  }, { heartbeatMs: 0 })
  const remaining = await readRunDurabilityFile(workspace, "run-1", "run.lock.json")
  assert.equal(parseWorkflowRunLock(JSON.parse(remaining.bytes.toString("utf8")), "run-1").token, "replacement-token")
})
