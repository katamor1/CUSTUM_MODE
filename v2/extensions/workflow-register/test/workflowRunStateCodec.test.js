const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const {
  CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION,
  assertWorkflowRunStateWritable,
  decodeWorkflowRunState,
  isWorkflowRunStateWritable,
  prepareWorkflowRunStateForWrite
} = require("../out/core/runtime/runStateCodec.js")

const fixtureRoot = path.join(__dirname, "fixtures", "run-state")

function readFixture(name) {
  return fs.readFileSync(path.join(fixtureRoot, name), "utf8")
}

function parseFixture(name) {
  return JSON.parse(readFixture(name))
}

test("run-state codec migrates an unversioned historical document in memory", () => {
  const original = parseFixture("v0-basic.json")
  const decoded = decodeWorkflowRunState(original, original.runId)

  assert.equal(decoded.migrated, true)
  assert.equal(decoded.readOnly, false)
  assert.equal(decoded.sourceVersion, "unversioned")
  assert.equal(decoded.run.schemaVersion, CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION)
  assert.equal(decoded.run.updatedAt, "2026-07-12T00:01:00.000Z")
  assert.deepEqual(
    Object.fromEntries(Object.entries(decoded.run).filter(([key]) => key !== "schemaVersion")),
    original
  )
})

test("run-state codec accepts current v1 without migration", () => {
  const current = parseFixture("v1-basic.json")
  const decoded = decodeWorkflowRunState(current, current.runId)

  assert.equal(decoded.migrated, false)
  assert.equal(decoded.readOnly, false)
  assert.equal(decoded.sourceVersion, CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION)
  assert.deepEqual(decoded.run, current)
})

test("future run-state versions are inspectable and read-only", () => {
  const future = {
    ...parseFixture("v1-basic.json"),
    schemaVersion: "workflow-register/run-state/v2",
    futureField: { preserved: true }
  }
  const decoded = decodeWorkflowRunState(future, future.runId)

  assert.equal(decoded.migrated, false)
  assert.equal(decoded.readOnly, true)
  assert.equal(decoded.sourceVersion, "workflow-register/run-state/v2")
  assert.equal(decoded.run.schemaVersion, "workflow-register/run-state/v2")
  assert.deepEqual(decoded.run.futureField, { preserved: true })
  assert.throws(
    () => prepareWorkflowRunStateForWrite(decoded.run),
    /read-only schemaVersion 'workflow-register\/run-state\/v2'/
  )
})

test("run-state writable boundary accepts only omitted and current versions", () => {
  const historical = parseFixture("v0-basic.json")
  const current = parseFixture("v1-basic.json")
  const future = { ...current, schemaVersion: "workflow-register/run-state/v2" }

  assert.equal(isWorkflowRunStateWritable(historical), true)
  assert.equal(isWorkflowRunStateWritable(current), true)
  assert.equal(isWorkflowRunStateWritable(future), false)
  assert.doesNotThrow(() => assertWorkflowRunStateWritable(historical))
  assert.doesNotThrow(() => assertWorkflowRunStateWritable(current))
  assert.throws(
    () => assertWorkflowRunStateWritable(future),
    /read-only schemaVersion 'workflow-register\/run-state\/v2'/
  )
})

test("write preparation normalizes only an omitted version", () => {
  const historical = parseFixture("v0-basic.json")
  const prepared = prepareWorkflowRunStateForWrite(historical)

  assert.notEqual(prepared, historical)
  assert.equal(prepared.schemaVersion, CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION)
  assert.equal(historical.schemaVersion, undefined)
  assert.deepEqual(
    Object.fromEntries(Object.entries(prepared).filter(([key]) => key !== "schemaVersion")),
    historical
  )
})

test("run-state codec rejects malformed schema discriminators", async (t) => {
  const base = parseFixture("v1-basic.json")
  const cases = [
    {
      name: "foreign schema family",
      value: "other-product/run-state/v1",
      message: /Unsupported workflow run state schemaVersion 'other-product\/run-state\/v1'/
    },
    {
      name: "zero version",
      value: "workflow-register/run-state/v0",
      message: /Unsupported workflow run state schemaVersion 'workflow-register\/run-state\/v0'/
    },
    {
      name: "number",
      value: 1,
      message: /field 'schemaVersion' must be a string/
    },
    {
      name: "null",
      value: null,
      message: /field 'schemaVersion' must be a string/
    },
    {
      name: "object",
      value: { version: 1 },
      message: /field 'schemaVersion' must be a string/
    }
  ]

  for (const item of cases) {
    await t.test(item.name, () => {
      assert.throws(
        () => decodeWorkflowRunState({ ...base, schemaVersion: item.value }, base.runId),
        item.message
      )
    })
  }
})

test("run-state codec validates the stable inspectable core", async (t) => {
  const base = parseFixture("v1-basic.json")
  const cases = [
    ["non-object document", null, /Workflow run document must be an object/],
    ["missing workflow id", { ...base, workflowId: undefined }, /field 'workflowId' must be a non-empty string/],
    ["invalid run status", { ...base, status: "unknown" }, /field 'status' has unsupported value 'unknown'/],
    ["invalid inputs", { ...base, inputs: [] }, /field 'inputs' must be an object/],
    ["invalid state value", { ...base, state: { context: { nested: true } } }, /state 'context' must be a string/],
    ["invalid steps", { ...base, steps: {} }, /field 'steps' must be an array/],
    ["invalid step type", { ...base, steps: [{ ...base.steps[0], type: "future" }] }, /step 'review' field 'type' has unsupported value 'future'/],
    ["invalid step status", { ...base, steps: [{ ...base.steps[0], status: "future" }] }, /step 'review' field 'status' has unsupported value 'future'/]
  ]

  for (const [name, value, message] of cases) {
    await t.test(name, () => assert.throws(() => decodeWorkflowRunState(value), message))
  }
})

test("run-state codec rejects a run id that disagrees with its directory", () => {
  const current = parseFixture("v1-basic.json")

  assert.throws(
    () => decodeWorkflowRunState(current, "different-run-id"),
    /Workflow run id mismatch: expected 'different-run-id', got '20260712T000000Z-history-000000000001'/
  )
})
