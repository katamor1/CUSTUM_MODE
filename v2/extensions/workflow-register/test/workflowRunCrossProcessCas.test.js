const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawn } = require("node:child_process")
const { test } = require("node:test")

const { FileRunStateStore } = require("../out/core/runStateStore.js")
const { readWorkflowRunEventLog } = require("../out/core/runtime/runEventLog.js")

function workflow() {
  return {
    id: "workflow.cross-process-cas",
    name: "cross-process-cas",
    schemaVersion: "workflow-register/v1",
    engineSteps: [{ id: "step-1", title: "Step 1", type: "manual" }]
  }
}

function waitForLine(stream, expected) {
  return new Promise((resolve, reject) => {
    let output = ""
    stream.setEncoding("utf8")
    stream.on("data", (chunk) => {
      output += chunk
      if (output.includes(expected)) resolve(output)
    })
    stream.once("error", reject)
  })
}

test("a stale run loaded in another process cannot overwrite the winning commit", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-cross-process-cas-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const createStore = new FileRunStateStore({
    workspaceRoot: root,
    now: (() => {
      const values = ["2026-07-12T00:00:00.000Z", "2026-07-12T00:01:00.000Z"]
      return () => values.shift() ?? "2026-07-12T00:01:00.000Z"
    })(),
    lockOptions: { heartbeatMs: 0 }
  })
  const created = await createStore.createRun(workflow(), {})
  await createStore.saveRun(created)

  const fixture = path.join(__dirname, "fixtures", "run-stale-writer.js")
  const child = spawn(process.execPath, [fixture, root, created.runId], {
    stdio: ["pipe", "pipe", "pipe"]
  })
  t.after(() => child.kill())
  await waitForLine(child.stdout, "READY\n")

  const winnerStore = new FileRunStateStore({
    workspaceRoot: root,
    now: () => "2026-07-12T00:02:00.000Z",
    lockOptions: { heartbeatMs: 0 }
  })
  const winner = await winnerStore.loadRun(created.runId)
  winner.state.writer = "parent"
  await winnerStore.saveRun(winner)

  let stderr = ""
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk) => { stderr += chunk })
  child.stdin.end("go\n")
  const exitCode = await new Promise((resolve) => child.once("exit", resolve))

  assert.equal(exitCode, 2)
  assert.match(stderr, /STALE:.*changed since it was loaded|stale revision/i)
  const finalRun = await new FileRunStateStore({ workspaceRoot: root, lockOptions: { heartbeatMs: 0 } }).loadRun(created.runId)
  assert.equal(finalRun.state.writer, "parent")
  assert.equal((await readWorkflowRunEventLog(root, created.runId)).events.length, 2)
})
