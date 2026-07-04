const assert = require("node:assert/strict")
const { test } = require("node:test")

const { parseWorkflowMarkdown } = require("../out/core/parser")
const { validateWorkflowText } = require("../out/core/workflowValidator")

const workflowWithUserAction = `---
schemaVersion: workflow-register/v1
name: manual-action-sample
description: Manual action sample.
title: Manual Action Sample
inputs:
  reportName:
    type: string
    required: true
steps:
  - id: check-report
    title: Check report
    type: manual
    prompt: Confirm the generated report.
    userAction:
      message: |
        Open .bob/artifacts/{{inputs.reportName}}.md and confirm the contents.

        Press the button after the check.
      completeLabel: Check complete
      confirmOnComplete: true
      confirmMessage: Complete {{step.id}} for run {{run.id}}?
---
# Manual Action Sample
`

test("v1 workflow parser accepts manual step userAction metadata", () => {
  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: "C:/repo/.bob/workflows/manual-action-sample/WORKFLOW.md",
    text: workflowWithUserAction
  })

  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  assert.equal(parsed.workflow.engineSteps[0].type, "manual")
  assert.equal(parsed.workflow.engineSteps[0].userAction.message.includes("{{inputs.reportName}}"), true)
  assert.equal(parsed.workflow.engineSteps[0].userAction.completeLabel, "Check complete")
  assert.equal(parsed.workflow.engineSteps[0].userAction.confirmOnComplete, true)
  assert.equal(parsed.workflow.engineSteps[0].userAction.confirmMessage, "Complete {{step.id}} for run {{run.id}}?")
})

test("v1 workflow schema still rejects unknown userAction properties", () => {
  const invalid = workflowWithUserAction.replace(
    "      confirmMessage: Complete {{step.id}} for run {{run.id}}?",
    "      confirmMessage: Complete {{step.id}} for run {{run.id}}?\n      command: workflowRegister.completeCurrentStep"
  )
  const result = validateWorkflowText({
    sourceId: "workflow-register",
    filePath: "C:/repo/.bob/workflows/manual-action-sample/WORKFLOW.md",
    text: invalid
  })

  assert.equal(result.ok, false)
  assert.match(result.diagnostics.map((item) => item.message).join("\n"), /must NOT have additional properties/)
})

test("v1 workflow parser keeps workflows without userAction backward compatible", () => {
  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: "C:/repo/.bob/workflows/plain-manual/WORKFLOW.md",
    text: `---
schemaVersion: workflow-register/v1
name: plain-manual
description: Plain manual workflow.
steps:
  - id: check
    title: Check
    type: manual
    prompt: Check manually.
---
# Plain Manual
`
  })

  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  assert.equal(parsed.workflow.engineSteps[0].userAction, undefined)
})
