const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
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

test("workflow document path validator accepts only workspace-local workflow documents", (t) => {
  const { validateWorkflowDocumentPath } = require("../out/core/workflowDocumentPath")
  const workspaceRoot = tempDir(t)

  const valid = validateWorkflowDocumentPath({ workspaceRoot, filePath: workflowPath(workspaceRoot, "sample") })
  assert.deepEqual(valid, { ok: true, workflowName: "sample", relativePath: ".bob/workflows/sample/WORKFLOW.md" })

  assertInvalidReason(
    validateWorkflowDocumentPath({ workspaceRoot, filePath: workflowPath(workspaceRoot, "CON") }),
    /reserved/
  )
  assertInvalidReason(
    validateWorkflowDocumentPath({ workspaceRoot, filePath: workflowPath(workspaceRoot, "sample.") }),
    /end with dot or space/
  )
  assertInvalidReason(
    validateWorkflowDocumentPath({ workspaceRoot, filePath: workflowPath(workspaceRoot, "sample ") }),
    /end with dot or space/
  )
  assertInvalidReason(
    validateWorkflowDocumentPath({ workspaceRoot, filePath: workflowPath(workspaceRoot, "bad name") }),
    /unsupported characters/
  )
  assertInvalidReason(
    validateWorkflowDocumentPath({ workspaceRoot, filePath: path.join(workspaceRoot, ".bob", "workflows", "sample", "README.md") }),
    /must be \.bob\/workflows\/<name>\/WORKFLOW\.md/
  )
  assertInvalidReason(
    validateWorkflowDocumentPath({ workspaceRoot, filePath: path.join(workspaceRoot, ".bob", "workflows", "sample", "nested", "WORKFLOW.md") }),
    /must be \.bob\/workflows\/<name>\/WORKFLOW\.md/
  )
  assertInvalidReason(
    validateWorkflowDocumentPath({ workspaceRoot, filePath: workflowPath(path.dirname(workspaceRoot), "sample") }),
    /inside the workspace root/
  )
})

test("workflow document path validator rejects symlink escapes when the platform allows them", (t) => {
  const { validateWorkflowDocumentPath } = require("../out/core/workflowDocumentPath")
  const workspaceRoot = tempDir(t)
  const outsideRoot = tempDir(t)
  const workflowsRoot = path.join(workspaceRoot, ".bob", "workflows")
  fs.mkdirSync(workflowsRoot, { recursive: true })

  const linkPath = path.join(workflowsRoot, "linked")
  try {
    fs.symlinkSync(outsideRoot, linkPath, "junction")
  } catch (error) {
    if (error && ["EPERM", "EACCES", "EINVAL"].includes(error.code)) {
      t.skip(`symlink creation is unavailable: ${error.code}`)
      return
    }
    throw error
  }

  const result = validateWorkflowDocumentPath({ workspaceRoot, filePath: path.join(linkPath, "WORKFLOW.md") })
  assertInvalidReason(result, /resolves outside the workspace root/)
})

function workflowPath(workspaceRoot, workflowName) {
  return path.join(workspaceRoot, ".bob", "workflows", workflowName, "WORKFLOW.md")
}

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-document-path-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function assertInvalidReason(result, pattern) {
  assert.equal(result.ok, false)
  assert.match(result.reason, pattern)
}
