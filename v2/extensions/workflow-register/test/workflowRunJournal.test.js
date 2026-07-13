const assert = require("node:assert/strict")
const fs = require("node:fs")
const fsp = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const {
  appendWorkflowRunEvent,
  buildWorkflowRunEvent,
  hashWorkflowRunBytes,
  readWorkflowRunEventLog,
  serializeWorkflowRunState
} = require("../out/core/runtime/runEventLog.js")
const {
  buildWorkflowRunJournal,
  parseWorkflowRunJournal,
  readWorkflowRunJournal,
  recoverWorkflowRunJournal,
  writeWorkflowRunJournal
} = require("../out/core/runtime/runStateJournal.js")

function root(t) {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-journal-"))
  t.after(() => fs.rmSync(value, { recursive: true, force: true }))
  return value
}

function run(status, updatedAt) {
  return {
    schemaVersion: "workflow-register/run-state/v1",
    runId: "run-1",
    workflowId: "workflow.test",
    workflowName: "test",
    status,
    currentStep: "step-1",
    inputs: {},
    state: {},
    steps: [{ id: "step-1", title: "Step 1", type: "manual", status: status === "running" ? "pending" : "held" }],
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt
  }
}

function runPath(workspace) {
  return path.join(workspace, ".bob", "workflows", "runs", "run-1", "run.json")
}

async function writeRun(workspace, value) {
  await fsp.mkdir(path.dirname(runPath(workspace)), { recursive: true })
  await fsp.writeFile(runPath(workspace), serializeWorkflowRunState(value), "utf8")
}

async function readRunBytes(workspace) {
  try {
    return await fsp.readFile(runPath(workspace))
  } catch (error) {
    if (error.code === "ENOENT") return undefined
    throw error
  }
}

async function replaceRun(workspace, text) {
  await fsp.mkdir(path.dirname(runPath(workspace)), { recursive: true })
  await fsp.writeFile(runPath(workspace), text, "utf8")
}

function transaction(previous, next, previousEvent) {
  const event = buildWorkflowRunEvent({
    run: next,
    kind: "run.updated",
    occurredAt: next.updatedAt,
    eventId: "event-next",
    previousEvent,
    previousRunHash: previous ? hashWorkflowRunBytes(serializeWorkflowRunState(previous)) : undefined
  })
  return buildWorkflowRunJournal({
    transactionId: "tx-1",
    runId: next.runId,
    createdAt: next.updatedAt,
    previousRunHash: previous ? hashWorkflowRunBytes(serializeWorkflowRunState(previous)) : undefined,
    previousEventHash: previousEvent?.hash,
    nextRun: next,
    nextEvent: event
  })
}

test("journal parser validates run and event hash agreement", async (t) => {
  const previous = run("running", "2026-07-12T00:01:00.000Z")
  const next = run("paused", "2026-07-12T00:02:00.000Z")
  const journal = transaction(previous, next)
  assert.deepEqual(parseWorkflowRunJournal(journal, "run-1"), journal)

  const cases = [
    ["schema", { ...journal, schemaVersion: "workflow-register/run-journal/v2" }, /schemaVersion/],
    ["run id", { ...journal, runId: "other" }, /run id/],
    ["next run id", { ...journal, nextRun: { ...journal.nextRun, runId: "other" } }, /next run id/],
    ["next run hash", { ...journal, nextRunHash: `sha256:${"0".repeat(64)}` }, /nextRunHash/],
    ["event run hash", { ...journal, nextEvent: { ...journal.nextEvent, runHash: `sha256:${"1".repeat(64)}` } }, /event.*runHash|nextRunHash/],
    ["event head", { ...journal, previousEventHash: "sha256:head", nextEvent: { ...journal.nextEvent, previousEventHash: undefined } }, /previousEventHash/]
  ]
  for (const [name, value, pattern] of cases) {
    await t.test(name, () => assert.throws(() => parseWorkflowRunJournal(value, "run-1"), pattern))
  }
})

test("journal recovery completes every crash point exactly once", async (t) => {
  for (const crashPoint of ["journal-only", "run-written", "event-written"]) {
    await t.test(crashPoint, async (t) => {
      const workspace = root(t)
      const previous = run("running", "2026-07-12T00:01:00.000Z")
      const next = run("paused", "2026-07-12T00:02:00.000Z")
      const journal = transaction(previous, next)
      await writeRun(workspace, crashPoint === "journal-only" ? previous : next)
      if (crashPoint === "event-written") await appendWorkflowRunEvent(workspace, "run-1", journal.nextEvent)
      await writeWorkflowRunJournal(workspace, "run-1", journal)

      const result = await recoverWorkflowRunJournal({
        workspaceRoot: workspace,
        runId: "run-1",
        readRunBytes: () => readRunBytes(workspace),
        writeRunText: (text) => replaceRun(workspace, text)
      })
      assert.equal(result.recovered, true)
      assert.deepEqual(JSON.parse((await readRunBytes(workspace)).toString("utf8")), next)
      assert.equal((await readWorkflowRunEventLog(workspace, "run-1")).events.length, 1)
      assert.equal(await readWorkflowRunJournal(workspace, "run-1"), undefined)

      const second = await recoverWorkflowRunJournal({
        workspaceRoot: workspace,
        runId: "run-1",
        readRunBytes: () => readRunBytes(workspace),
        writeRunText: (text) => replaceRun(workspace, text)
      })
      assert.equal(second.recovered, false)
      assert.equal((await readWorkflowRunEventLog(workspace, "run-1")).events.length, 1)
    })
  }
})

test("journal recovery preserves evidence on materialized and event-head conflicts", async (t) => {
  const workspace = root(t)
  const previous = run("running", "2026-07-12T00:01:00.000Z")
  const next = run("paused", "2026-07-12T00:02:00.000Z")
  const journal = transaction(previous, next)
  const unrelated = run("failed", "2026-07-12T00:03:00.000Z")
  await writeRun(workspace, unrelated)
  await writeWorkflowRunJournal(workspace, "run-1", journal)

  await assert.rejects(recoverWorkflowRunJournal({
    workspaceRoot: workspace,
    runId: "run-1",
    readRunBytes: () => readRunBytes(workspace),
    writeRunText: (text) => replaceRun(workspace, text)
  }), /materialized run hash conflict/)
  assert.deepEqual(JSON.parse((await readRunBytes(workspace)).toString("utf8")), unrelated)
  assert.ok(await readWorkflowRunJournal(workspace, "run-1"))

  await writeRun(workspace, previous)
  const foreignEvent = buildWorkflowRunEvent({
    run: previous,
    kind: "run.created",
    occurredAt: previous.updatedAt,
    eventId: "foreign"
  })
  await appendWorkflowRunEvent(workspace, "run-1", foreignEvent)
  await assert.rejects(recoverWorkflowRunJournal({
    workspaceRoot: workspace,
    runId: "run-1",
    readRunBytes: () => readRunBytes(workspace),
    writeRunText: (text) => replaceRun(workspace, text)
  }), /event head conflict/)
  assert.ok(await readWorkflowRunJournal(workspace, "run-1"))
})
