const assert = require("node:assert/strict")
const { test } = require("node:test")

const {
  appendWorkflowRunEvent,
  buildWorkflowRunEvent,
  parseWorkflowRunEventLog,
  readWorkflowRunEventLog,
  serializeWorkflowRunState
} = require("../out/core/runtime/runEventLog.js")

function run(overrides = {}) {
  return {
    schemaVersion: "workflow-register/run-state/v1",
    runId: "run-1",
    workflowId: "workflow.test",
    workflowName: "test",
    status: "running",
    currentStep: "step-1",
    inputs: { revision: "abc" },
    state: { context: "value" },
    steps: [{ id: "step-1", title: "Step 1", type: "manual", status: "pending" }],
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:01:00.000Z",
    ...overrides
  }
}

test("event builder creates deterministic full-snapshot hash chain entries", () => {
  const snapshot = run()
  const first = buildWorkflowRunEvent({
    run: snapshot,
    kind: "run.created",
    occurredAt: "2026-07-12T00:01:00.000Z",
    eventId: "event-1"
  })
  const secondRun = run({ status: "paused", updatedAt: "2026-07-12T00:02:00.000Z" })
  const second = buildWorkflowRunEvent({
    run: secondRun,
    kind: "run.updated",
    occurredAt: "2026-07-12T00:02:00.000Z",
    eventId: "event-2",
    previousEvent: first,
    previousRunHash: first.runHash
  })

  assert.equal(first.sequence, 1)
  assert.equal(second.sequence, 2)
  assert.equal(second.previousEventHash, first.hash)
  assert.equal(first.snapshot.status, "running")
  assert.equal(second.snapshot.status, "paused")
  assert.match(first.runHash, /^sha256:[0-9a-f]{64}$/)
  assert.match(first.hash, /^sha256:[0-9a-f]{64}$/)
  assert.equal(serializeWorkflowRunState(first.snapshot), `${JSON.stringify(first.snapshot, null, 2)}\n`)
  assert.equal(snapshot.status, "running")
})

test("event parser validates sequence, hashes, ids, snapshots and final newline", async (t) => {
  const first = buildWorkflowRunEvent({ run: run(), kind: "run.created", occurredAt: "2026-07-12T00:01:00.000Z", eventId: "event-1" })
  const second = buildWorkflowRunEvent({ run: run({ status: "paused" }), kind: "run.updated", occurredAt: "2026-07-12T00:02:00.000Z", eventId: "event-2", previousEvent: first, previousRunHash: first.runHash })
  const text = `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`
  const parsed = parseWorkflowRunEventLog(text, "run-1")
  assert.equal(parsed.events.length, 2)
  assert.equal(parsed.head.hash, second.hash)

  const cases = [
    ["truncated final line", text.trimEnd(), /final newline|truncated/],
    ["blank line", `${JSON.stringify(first)}\n\n`, /blank line/],
    ["sequence", `${JSON.stringify({ ...first, sequence: 2 })}\n`, /sequence/],
    ["duplicate id", (() => {
      const duplicate = buildWorkflowRunEvent({
        run: run({ status: "paused" }),
        kind: "run.updated",
        occurredAt: "2026-07-12T00:02:00.000Z",
        eventId: first.eventId,
        previousEvent: first,
        previousRunHash: first.runHash
      })
      return `${JSON.stringify(first)}\n${JSON.stringify(duplicate)}\n`
    })(), /duplicate event id/],
    ["run id", `${JSON.stringify({ ...first, runId: "other" })}\n`, /run id/],
    ["snapshot", `${JSON.stringify({ ...first, snapshot: { ...first.snapshot, status: "paused" } })}\n`, /runHash|event hash/],
    ["future schema", `${JSON.stringify({ ...first, schemaVersion: "workflow-register/run-event/v2" })}\n`, /schemaVersion/]
  ]
  for (const [name, candidate, pattern] of cases) {
    await t.test(name, () => assert.throws(() => parseWorkflowRunEventLog(candidate, "run-1"), pattern))
  }
})

test("event append is idempotent by event hash and preserves a valid chain", async (t) => {
  const fs = require("node:fs")
  const os = require("node:os")
  const path = require("node:path")
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-event-log-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const first = buildWorkflowRunEvent({ run: run(), kind: "run.created", occurredAt: "2026-07-12T00:01:00.000Z", eventId: "event-1" })
  await appendWorkflowRunEvent(root, first.runId, first)
  await appendWorkflowRunEvent(root, first.runId, first)

  const second = buildWorkflowRunEvent({
    run: run({ status: "paused", updatedAt: "2026-07-12T00:02:00.000Z" }),
    kind: "run.updated",
    occurredAt: "2026-07-12T00:02:00.000Z",
    eventId: "event-2",
    previousEvent: first,
    previousRunHash: first.runHash
  })
  await appendWorkflowRunEvent(root, second.runId, second)

  const state = await readWorkflowRunEventLog(root, first.runId)
  assert.equal(state.events.length, 2)
  assert.equal(state.head.hash, second.hash)
})
