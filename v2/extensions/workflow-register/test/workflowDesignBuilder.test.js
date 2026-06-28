const assert = require("node:assert/strict")
const path = require("node:path")
const { test } = require("node:test")

const extensionRoot = path.resolve(__dirname, "..")
const outRoot = path.join(extensionRoot, "out")
const { buildWorkflowFromDesignDraft, chooseTemplate } = require(path.join(outRoot, "core", "workflowDesignBuilder.js"))
const { validateWorkflowDesignDraft } = require(path.join(outRoot, "core", "workflowDesignDraft.js"))
const { buildWorkflowRepairContext, formatWorkflowRepairContext } = require(path.join(outRoot, "core", "workflowRepairContext.js"))
const { validateWorkflowText } = require(path.join(outRoot, "core", "workflowValidator.js"))

test("workflow design builder generates a valid input-driven workflow", () => {
  const result = buildWorkflowFromDesignDraft({
    name: "review docs",
    title: "Review Docs",
    description: "Review the selected documentation target.",
    inputs: [{ id: "target", type: "string", required: true }]
  }, { sourceId: "workflow-register" })

  assert.equal(result.ok, true, result.reportLines.join("\n"))
  assert.equal(result.name, "review-docs")
  assert.equal(result.template, "input-driven-agent")
  assert.match(result.markdown, /schemaVersion: workflow-register\/v1/)
})

test("workflow design builder chooses artifact-output for artifact drafts", () => {
  assert.equal(chooseTemplate({ name: "report", description: "Create report.", artifacts: [{ id: "report", path: ".bob/artifacts/report.md" }] }), "artifact-output")
})

test("workflow design draft validation rejects invalid select input", () => {
  const validation = validateWorkflowDesignDraft({
    name: "bad-input",
    description: "Bad input draft.",
    inputs: [{ id: "style", type: "select" }]
  })

  assert.equal(validation.ok, false)
  assert.ok(validation.errors.some((error) => error.includes("select but has no options")))
})

test("workflow design builder refuses invalid drafts before writing workflow markdown", () => {
  const result = buildWorkflowFromDesignDraft({ name: "", description: "" }, { sourceId: "workflow-register" })

  assert.equal(result.ok, false)
  assert.equal(result.markdown, undefined)
  assert.ok(result.errors.some((error) => error.includes("Draft name is required")))
})

test("workflow repair context maps diagnostics to likely fixes", () => {
  const text = `---
schemaVersion: workflow-register/v1
name: sample
description: Sample workflow.
steps:
  - id: analyze
    title: Analyze
    type: agent
    includeState:
      - missingContext
    prompt: Analyze.
---
# Sample
`
  const validation = validateWorkflowText({ sourceId: "workflow-register", filePath: ".bob/workflows/sample/WORKFLOW.md", text })
  const context = buildWorkflowRepairContext(".bob/workflows/sample/WORKFLOW.md", validation)
  const lines = formatWorkflowRepairContext(context)

  assert.equal(context.status, "invalid")
  assert.equal(context.problems[0].repairTarget, "steps[].includeState")
  assert.match(context.problems[0].likelyFix, /resultKey/)
  assert.ok(lines.some((line) => line.includes("Repair context JSON")))
})
