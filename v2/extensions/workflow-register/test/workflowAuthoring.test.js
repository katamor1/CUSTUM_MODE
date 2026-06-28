const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const extensionRoot = path.resolve(__dirname, "..")
const outRoot = path.join(extensionRoot, "out")
const { createWorkflowMarkdown, workflowTemplates } = require(path.join(outRoot, "core", "workflowScaffold.js"))
const { formatWorkflowDiagnostics, validateWorkflowText } = require(path.join(outRoot, "core", "workflowValidator.js"))
const { workflowV1Schema } = require(path.join(outRoot, "core", "workflowSchema.js"))

test("all workflow scaffold templates validate", () => {
  assert.deepEqual(workflowTemplates.map((template) => template.id), [
    "simple-agent",
    "command-then-agent",
    "manual-checklist",
    "input-driven-agent",
    "preflight-files",
    "artifact-output",
    "guarded-command",
    "review-workflow"
  ])
  for (const template of workflowTemplates) {
    const text = createWorkflowMarkdown({ name: template.id, title: template.label, description: `Run ${template.label}.`, template: template.id })
    const result = validateWorkflowText({ sourceId: "workflow-register", filePath: `.bob/workflows/${template.id}/WORKFLOW.md`, text })
    assert.equal(result.ok, true, `${template.id}: ${formatWorkflowDiagnostics(result).join("\n")}`)
  }
})

test("semantic validator rejects duplicate step ids", () => {
  const text = `---
schemaVersion: workflow-register/v1
name: sample
description: Sample workflow.
steps:
  - id: analyze
    title: Analyze
    type: manual
  - id: analyze
    title: Analyze again
    type: manual
---
# Sample
`
  const result = validateWorkflowText({ sourceId: "workflow-register", filePath: ".bob/workflows/sample/WORKFLOW.md", text })

  assert.equal(result.ok, false)
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.message.includes("Duplicate step id 'analyze'")))
})

test("semantic validator rejects unknown includeState keys", () => {
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
  const result = validateWorkflowText({ sourceId: "workflow-register", filePath: ".bob/workflows/sample/WORKFLOW.md", text })

  assert.equal(result.ok, false)
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.message.includes("includeState references unknown resultKey 'missingContext'")))
  assert.ok(formatWorkflowDiagnostics(result).some((line) => line.includes("hint:")))
})

test("public JSON schema mirrors runtime schema shape", () => {
  const publicSchema = JSON.parse(fs.readFileSync(path.join(extensionRoot, "schema", "workflow-register.v1.schema.json"), "utf8"))

  assert.deepEqual(publicSchema.required, workflowV1Schema.required)
  assert.deepEqual(Object.keys(publicSchema.properties).sort(), Object.keys(workflowV1Schema.properties).sort())
  assert.deepEqual(publicSchema.properties.steps.items.required, workflowV1Schema.properties.steps.items.required)
  assert.deepEqual(publicSchema.properties.steps.items.properties.type.enum, workflowV1Schema.properties.steps.items.properties.type.enum)
})
