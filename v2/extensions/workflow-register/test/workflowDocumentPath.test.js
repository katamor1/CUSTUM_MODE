const assert = require("node:assert/strict")
const { test } = require("node:test")

test("workflow document path accepts only immediate .bob workflow WORKFLOW.md files", () => {
  const { isWorkflowDocumentPath } = require("../out/core/workflowDocumentPath")

  assert.equal(isWorkflowDocumentPath("C:\\repo\\.bob\\workflows\\sample\\WORKFLOW.md"), true)
  assert.equal(isWorkflowDocumentPath("/repo/.bob/workflows/sample/WORKFLOW.md"), true)
  assert.equal(isWorkflowDocumentPath("/repo/README.md"), false)
  assert.equal(isWorkflowDocumentPath("/repo/.bob/workflows/sample/README.md"), false)
  assert.equal(isWorkflowDocumentPath("/repo/.bob/workflows/.previews/sample/WORKFLOW.md"), false)
  assert.equal(isWorkflowDocumentPath("/repo/.bob/workflows/sample/nested/WORKFLOW.md"), false)
  assert.equal(isWorkflowDocumentPath("/repo/.bob/workflows//WORKFLOW.md"), false)
})
