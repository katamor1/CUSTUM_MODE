const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const outRoot = path.resolve(__dirname, "..", "out")
const { parseWorkflowMarkdown } = require(path.join(outRoot, "core", "parser.js"))

test("review-gated step execution sample workflow validates", () => {
  const workflowFile = path.resolve(
    __dirname,
    "..",
    "samples",
    "review-gated-step-execution",
    ".bob",
    "workflows",
    "review-gated-step-execution",
    "WORKFLOW.md"
  )
  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: ".bob/workflows/review-gated-step-execution/WORKFLOW.md",
    text: fs.readFileSync(workflowFile, "utf8")
  })

  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  assert.equal(parsed.workflow.stepExecution.mode, "engineSteps")
  assert.equal(parsed.workflow.stepReview.enabled, true)
  assert.deepEqual(parsed.workflow.engineSteps.map((step) => step.id), ["collect-input", "draft-output", "save-output"])
})
