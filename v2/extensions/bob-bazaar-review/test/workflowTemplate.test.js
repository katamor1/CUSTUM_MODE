const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const extensionRoot = path.resolve(__dirname, "..")

test("Bazaar workflow template declares v1 schema and uses revision-derived review ids", () => {
  const workflowPath = path.join(
    extensionRoot,
    "templates",
    ".bob",
    "workflows",
    "bazaar-project-rule-review",
    "WORKFLOW.md"
  )
  const workflow = fs.readFileSync(workflowPath, "utf8")

  assert.match(workflow, /^schemaVersion: workflow-register\/v1$/m)
  assert.match(workflow, /^steps:$/m)
  assert.match(workflow, /"review_id": "bazaar-r<revision>-project-rule-review"/)
  assert.match(workflow, /Replace `<revision>` with the actual Bazaar revision or range/)
  assert.match(workflow, /checklist_results\[\]\.severity` must always be exactly one of `error`, `warning`, or `info`/)
  assert.match(workflow, /Never put `N\/A`, `not_applicable`, `none`, or any status value in `severity`/)
  assert.doesNotMatch(workflow, /bazaar-r2-project-rule-review/)
  assert.doesNotMatch(workflow, /```workflow-step/)
  assert.doesNotMatch(workflow, /^## Step:/m)
})
