const assert = require("node:assert/strict")
const { test } = require("node:test")

const { createAuthoringModelFromTemplate } = require("../out/core/workflowAuthoringDefaults")
const { loadAuthoringModelFromMarkdown } = require("../out/core/workflowAuthoringLoader")
const { serializeAuthoringModelToMarkdown } = require("../out/core/workflowAuthoringSerializer")
const { validateWorkflowText } = require("../out/core/workflowValidator")

test("authoring serializer writes manual step userAction and validates the result", () => {
  const model = createAuthoringModelFromTemplate({
    name: "manual-action-authoring",
    title: "Manual Action Authoring",
    description: "Author user action fields.",
    template: "simple-agent"
  })
  model.steps = [{
    id: "check-report",
    title: "Check report",
    type: "manual",
    prompt: "Confirm the generated report.",
    userAction: {
      message: "Open {{inputs.reportName}} and confirm it.",
      completeLabel: "Checked",
      confirmOnComplete: true,
      confirmMessage: "Complete {{step.id}}?"
    }
  }]

  const rendered = serializeAuthoringModelToMarkdown(model)
  assert.match(rendered.markdown, /userAction:/)
  assert.match(rendered.markdown, /message: Open \{\{inputs\.reportName\}\} and confirm it\./)
  assert.match(rendered.markdown, /completeLabel: Checked/)
  assert.match(rendered.markdown, /confirmOnComplete: true/)

  const validation = validateWorkflowText({ sourceId: "workflow-register", filePath: rendered.filePath, text: rendered.markdown })
  assert.equal(validation.ok, true, validation.diagnostics.map((item) => item.message).join("\n"))
})

test("authoring loader preserves userAction on a manual step", () => {
  const source = `---
schemaVersion: workflow-register/v1
name: existing-manual-action
description: Existing manual action workflow.
title: Existing Manual Action
steps:
  - id: check-file
    title: Check file
    type: manual
    prompt: Check the file.
    userAction:
      message: |
        Open .bob/artifacts/report.md.
      completeLabel: File checked
      confirmOnComplete: true
      confirmMessage: Mark this step complete?
---
# Existing Manual Action
`
  const loaded = loadAuthoringModelFromMarkdown({
    sourceId: "workflow-register",
    filePath: ".bob/workflows/existing-manual-action/WORKFLOW.md",
    text: source
  })

  assert.equal(loaded.model.steps[0].userAction.message.trim(), "Open .bob/artifacts/report.md.")
  assert.equal(loaded.model.steps[0].userAction.completeLabel, "File checked")
  assert.equal(loaded.model.steps[0].userAction.confirmOnComplete, true)
  assert.equal(loaded.model.steps[0].userAction.confirmMessage, "Mark this step complete?")
})

test("manual-checklist template includes userAction guidance", () => {
  const model = createAuthoringModelFromTemplate({
    name: "manual-checklist-user-action",
    title: "Manual Checklist User Action",
    description: "Manual checklist with user action.",
    template: "manual-checklist"
  })

  assert.equal(model.steps.every((step) => step.type !== "manual" || step.userAction?.message), true)
  assert.equal(model.steps.every((step) => step.type !== "manual" || step.userAction?.completeLabel), true)
})
