const assert = require("node:assert/strict")
const path = require("node:path")
const { test } = require("node:test")

const extensionRoot = path.resolve(__dirname, "..")
const outRoot = path.join(extensionRoot, "out")
const {
  validateWorkflowAiDesignOutput,
  validateWorkflowAiExplainOutput,
  validateWorkflowAiRepairOutput
} = require(path.join(outRoot, "core", "workflowAiProviderValidator.js"))

test("AI design output validator accepts minimal valid drafts", () => {
  const result = validateWorkflowAiDesignOutput({ name: "sample", description: "Sample workflow.", template: "simple-agent", notes: ["ok"] })

  assert.equal(result.ok, true)
  assert.equal(result.value.name, "sample")
  assert.equal(result.value.template, "simple-agent")
})

test("AI design output validator rejects malformed drafts", () => {
  const result = validateWorkflowAiDesignOutput({ name: "sample", template: "not-a-template", notes: "bad" })

  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes("description")))
  assert.ok(result.errors.some((error) => error.includes("unknown template")))
  assert.ok(result.errors.some((error) => error.includes("notes")))
})

test("AI repair output validator accepts report-only and replacement proposals", () => {
  const reportOnly = validateWorkflowAiRepairOutput({ summary: "Summary", notes: ["note"] })
  const replacement = validateWorkflowAiRepairOutput({ summary: "Summary", notes: [], replacementMarkdown: "# Replacement" })

  assert.equal(reportOnly.ok, true)
  assert.equal(reportOnly.value.replacementMarkdown, undefined)
  assert.equal(replacement.ok, true)
  assert.equal(replacement.value.replacementMarkdown, "# Replacement")
})

test("AI repair output validator rejects invalid field types", () => {
  const result = validateWorkflowAiRepairOutput({ summary: "Summary", notes: ["ok", 1], replacementMarkdown: 123 })

  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes("notes[1]")))
  assert.ok(result.errors.some((error) => error.includes("replacementMarkdown")))
})

test("AI explanation output validator accepts valid items", () => {
  const result = validateWorkflowAiExplainOutput({ summary: "Summary", items: [{ message: "m", explanation: "e", likelyFix: "f", repairTarget: "steps[].id" }] })

  assert.equal(result.ok, true)
  assert.equal(result.value.items[0].repairTarget, "steps[].id")
})

test("AI explanation output validator rejects malformed items", () => {
  const result = validateWorkflowAiExplainOutput({ summary: "Summary", items: [{ message: "m" }, "bad"] })

  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes("explanation")))
  assert.ok(result.errors.some((error) => error.includes("must be an object")))
})
