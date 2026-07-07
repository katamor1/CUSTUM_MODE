const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const { parseWorkflowMarkdown } = require("../out/core/parser")
const { validateWorkflowText } = require("../out/core/workflowValidator")

function readFixture(...segments) {
  return fs.readFileSync(path.join(__dirname, "fixtures", ...segments), "utf8")
}

function parseAndValidateFixture(relativeFilePath, text) {
  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: relativeFilePath,
    text
  })
  const validation = validateWorkflowText({
    sourceId: "workflow-register",
    filePath: relativeFilePath,
    text
  })
  return { parsed, validation }
}

test("v1 workflow parser accepts inputs, execution contract metadata, typed steps, and result sinks", () => {
  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: "C:/repo/.bob/workflows/sample/WORKFLOW.md",
    text: `---
schemaVersion: workflow-register/v1
name: sample
description: Sample workflow.
title: Sample Workflow
mode: sample-reviewer
category: code-review
requires:
  workspace: true
inputs:
  revision:
    type: string
    title: Revision
    required: true
guardrails:
  allowedCommands:
    - sample.collect
artifacts:
  - id: reviewContext
    producedBy: collect
    path: .bob/workflows/runs/{{run.id}}/steps/collect.json
steps:
  - id: collect
    title: Collect context
    type: command
    action:
      provider: sample.collect
    resultKey: reviewContext
  - id: save
    title: Save context
    type: result
    result:
      source: state
      stateKey: reviewContext
      sinks:
        - type: file
          path: ".bob/workflows/runs/{{run.id}}/steps/save.result.json"
---
# Sample
`
  })

  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  assert.equal(parsed.workflow.schemaVersion, "workflow-register/v1")
  assert.equal(parsed.workflow.mode, "sample-reviewer")
  assert.equal(parsed.workflow.category, "code-review")
  assert.equal(parsed.workflow.requires.workspace, true)
  assert.equal(parsed.workflow.inputs.revision.type, "string")
  assert.equal(parsed.workflow.guardrails.allowedCommands[0], "sample.collect")
  assert.equal(parsed.workflow.artifacts[0].id, "reviewContext")
  assert.equal(parsed.workflow.engineSteps.length, 2)
  assert.equal(parsed.workflow.engineSteps[0].type, "command")
  assert.equal(parsed.workflow.engineSteps[1].type, "result")
})

test("local code consistency workflow fixture is clean for strict registration", () => {
  const relativeFilePath = "test/fixtures/code-consistency-workflow/WORKFLOW.md"
  const text = readFixture("code-consistency-workflow", "WORKFLOW.md")
  const { parsed, validation } = parseAndValidateFixture(relativeFilePath, text)

  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  assert.equal(validation.ok, true, validation.diagnostics.join("\n"))
  assert.deepEqual(parsed.diagnostics.filter((line) => line.trimStart().startsWith("- warn:")), [])
})

test("local packaged code consistency template fixture keeps traceability workflow contract", () => {
  const relativeFilePath = "test/fixtures/bob-code-consistency-review-template/WORKFLOW.md"
  const text = readFixture("bob-code-consistency-review-template", "WORKFLOW.md")
  const { parsed, validation } = parseAndValidateFixture(relativeFilePath, text)

  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  assert.equal(validation.ok, true, validation.diagnostics.join("\n"))
  assert.deepEqual(parsed.diagnostics.filter((line) => line.trimStart().startsWith("- warn:")), [])
  assert.ok(parsed.workflow.guardrails.allowedCommands.includes("bobCodeConsistency.captureAiTraceabilityDraft"))
  assert.ok(parsed.workflow.guardrails.allowedCommands.includes("bobCodeConsistency.createReviewInputFromTraceability"))
  assert.deepEqual(
    [
      "collect-document-candidates",
      "generate-traceability-draft",
      "apply-traceability-draft",
      "approve-traceability-catalog",
      "create-review-input-from-traceability"
    ].filter((stepId) => !parsed.workflow.engineSteps.some((step) => step.id === stepId)),
    []
  )
})

test("legacy workflow parser records a definition hash", () => {
  const text = `---
name: legacy
description: Legacy workflow.
---
# Legacy

Do the legacy workflow.
`
  const changedText = text.replace("Do the legacy workflow.", "Do the changed legacy workflow.")
  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: "C:/repo/.bob/workflows/legacy/WORKFLOW.md",
    text
  })
  const changed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: "C:/repo/.bob/workflows/legacy/WORKFLOW.md",
    text: changedText
  })

  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  assert.equal(changed.ok, true, changed.diagnostics.join("\n"))
  assert.match(parsed.workflow.definitionHash, /^sha256:[0-9a-f]{64}$/)
  assert.notEqual(parsed.workflow.definitionHash, changed.workflow.definitionHash)
})

test("v1 workflow parser reports schema validation errors", () => {
  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: "C:/repo/.bob/workflows/bad/WORKFLOW.md",
    text: `---
schemaVersion: workflow-register/v1
name: bad
steps:
  - id: missing-title
    type: command
---
# Bad
`
  })

  assert.equal(parsed.ok, false)
  assert.match(parsed.diagnostics.join("\n"), /description/)
  assert.match(parsed.diagnostics.join("\n"), /action/)
})
