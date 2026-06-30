const test = require("node:test")
const assert = require("node:assert/strict")

const { loadAuthoringModelFromMarkdown } = require("../out/core/workflowAuthoringLoader")
const { serializeAuthoringModelToMarkdown } = require("../out/core/workflowAuthoringSerializer")
const { validateWorkflowText } = require("../out/core/workflowValidator")

const sampleWorkflow = `---
schemaVersion: workflow-register/v1
name: existing-review
description: Existing workflow loaded into GUI.
title: Existing Review
mode: agent
workspaceRequired: true
category: review
permissions:
  - read
  - mcp
inputs:
  reviewScope:
    type: select
    title: Review scope
    required: true
    options:
      - changed-files
      - full
steps:
  - id: collect-context
    title: Collect context
    type: command
    action:
      provider: vscode.executeCommand
      args:
        - example.collectContext
    resultKey: collectedContext
  - id: review
    title: Review
    type: agent
    includeState:
      - collectedContext
    resultKey: reviewReport
    prompt: Review the collected context.
artifacts:
  - id: report
    producedBy: review
    path: .bob/artifacts/review.md
---
# Existing Review

Keep this body text.
`

test("loads workflow-register/v1 markdown into an authoring model", () => {
  const loaded = loadAuthoringModelFromMarkdown({
    sourceId: "workflow-register",
    filePath: ".bob/workflows/existing-review/WORKFLOW.md",
    text: sampleWorkflow
  })

  assert.equal(loaded.model.metadata.name, "existing-review")
  assert.equal(loaded.model.metadata.title, "Existing Review")
  assert.equal(loaded.model.inputs.length, 1)
  assert.equal(loaded.model.inputs[0].id, "reviewScope")
  assert.equal(loaded.model.steps.length, 2)
  assert.equal(loaded.model.steps[0].type, "command")
  assert.equal(loaded.model.steps[1].type, "agent")
  assert.deepEqual(loaded.model.steps[1].includeState, ["collectedContext"])
  assert.equal(loaded.model.artifacts[0].producedBy, "review")
  assert.match(loaded.model.body, /Keep this body text/)
})

test("loader preserves GUI-unmanaged front matter on serialization", () => {
  const loaded = loadAuthoringModelFromMarkdown({
    sourceId: "workflow-register",
    filePath: ".bob/workflows/existing-review/WORKFLOW.md",
    text: sampleWorkflow
  })
  loaded.model.metadata.description = "Updated from GUI."
  const rendered = serializeAuthoringModelToMarkdown(loaded.model)

  assert.match(rendered.markdown, /category: review/)
  assert.match(rendered.markdown, /permissions:/)
  assert.match(rendered.markdown, /description: Updated from GUI\./)
  assert.match(rendered.markdown, /Keep this body text/)

  const validation = validateWorkflowText({ sourceId: "workflow-register", filePath: rendered.filePath, text: rendered.markdown })
  assert.equal(validation.ok, true)
})

test("loader rejects legacy workflow markdown for GUI editing", () => {
  const legacy = `---\nname: legacy-flow\ndescription: Legacy flow.\n---\n# Legacy\n`
  assert.throws(() => loadAuthoringModelFromMarkdown({ sourceId: "workflow-register", filePath: ".bob/workflows/legacy-flow/WORKFLOW.md", text: legacy }), /workflow-register\/v1 only/)
})
