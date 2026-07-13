const assert = require("node:assert/strict")
const path = require("node:path")
const { test } = require("node:test")

const { resolveWorkflowSchemaVersion } = require(path.resolve(
  __dirname,
  "..",
  "out",
  "core",
  "parser",
  "workflowSchemaVersion.js"
))

const unsupportedMessage = (value) =>
  `unsupported schemaVersion ${JSON.stringify(value)}; supported values are 'workflow-register/v1' and 'legacy', or omit the field for legacy workflows.`

const nonStringMessage =
  "field 'schemaVersion' must be a string when provided; supported values are 'workflow-register/v1' and 'legacy'."

test("schema version resolver routes only omitted, legacy, and v1 values", () => {
  assert.equal(resolveWorkflowSchemaVersion(undefined), "legacy")
  assert.equal(resolveWorkflowSchemaVersion("legacy"), "legacy")
  assert.equal(resolveWorkflowSchemaVersion("workflow-register/v1"), "workflow-register/v1")
})

test("schema version resolver does not normalize unsupported strings", () => {
  for (const value of [
    "",
    " ",
    "Legacy",
    "workflow-register/V1",
    " workflow-register/v1",
    "workflow-register/v1 ",
    "workflow-register/v2",
    "workflow-register/v2\npreview"
  ]) {
    assert.throws(
      () => resolveWorkflowSchemaVersion(value),
      (error) => error instanceof Error && error.message === unsupportedMessage(value),
      JSON.stringify(value)
    )
  }
})

test("schema version resolver rejects every non-string explicit value", () => {
  for (const value of [null, 1, false, [], {}, { version: "v1" }]) {
    assert.throws(
      () => resolveWorkflowSchemaVersion(value),
      (error) => error instanceof Error && error.message === nonStringMessage,
      JSON.stringify(value)
    )
  }
})
