const assert = require("node:assert/strict")
const path = require("node:path")
const { test } = require("node:test")

const extensionRoot = path.resolve(__dirname, "..")
const outRoot = path.join(extensionRoot, "out")
const {
  buildWorkflowBackupPath,
  createWorkflowReplacementCandidate,
  previewFileNameForWorkflow,
  timestampForPath,
  workflowNameFromPath
} = require(path.join(outRoot, "core", "workflowReplacementPreview.js"))

const now = new Date("2026-06-28T12:34:56.789Z")

test("workflow replacement helper builds stable backup paths", () => {
  assert.equal(timestampForPath(now), "20260628T123456Z")
  assert.equal(workflowNameFromPath(".bob/workflows/review-docs/WORKFLOW.md"), "review-docs")
  assert.equal(buildWorkflowBackupPath(".bob/workflows/review-docs/WORKFLOW.md", now), ".bob/workflows/.backups/review-docs/20260628T123456Z-WORKFLOW.md")
})

test("workflow replacement helper sanitizes fallback workflow names", () => {
  assert.equal(workflowNameFromPath("C:\\workspace\\.bob\\workflows\\bad name!\\WORKFLOW.md"), "bad-name")
  assert.equal(previewFileNameForWorkflow(".bob/workflows/bad name!/WORKFLOW.md", now), "bad-name-20260628T123456Z-replacement-WORKFLOW.md")
})

test("workflow replacement candidate allows valid replacement markdown", () => {
  const candidate = createWorkflowReplacementCandidate({
    sourceId: "workflow-register",
    filePath: ".bob/workflows/sample/WORKFLOW.md",
    originalMarkdown: validWorkflow("Old description."),
    replacementMarkdown: validWorkflow("New description."),
    now
  })

  assert.equal(candidate.canApply, true, candidate.validation.diagnostics.map((item) => item.message).join("\n"))
  assert.equal(candidate.backupRelativePath, ".bob/workflows/.backups/sample/20260628T123456Z-WORKFLOW.md")
})

test("workflow replacement candidate blocks invalid replacement markdown", () => {
  const candidate = createWorkflowReplacementCandidate({
    sourceId: "workflow-register",
    filePath: ".bob/workflows/sample/WORKFLOW.md",
    originalMarkdown: validWorkflow("Old description."),
    replacementMarkdown: "# Missing front matter",
    now
  })

  assert.equal(candidate.canApply, false)
  assert.equal(candidate.validation.ok, false)
})

function validWorkflow(description) {
  return `---
schemaVersion: workflow-register/v1
name: sample
description: ${description}
---
# Sample
`
}
