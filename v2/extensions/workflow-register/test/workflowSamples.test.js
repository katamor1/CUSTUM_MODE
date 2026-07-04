const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const outRoot = path.resolve(__dirname, "..", "out")
const { parseWorkflowMarkdown } = require(path.join(outRoot, "core", "parser"))

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

test("step-back branching approval sample workflow validates", () => {
  const workflowFile = path.resolve(
    __dirname,
    "..",
    "samples",
    "step-back-branching-approval",
    ".bob",
    "workflows",
    "step-back-branching-approval",
    "WORKFLOW.md"
  )
  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: ".bob/workflows/step-back-branching-approval/WORKFLOW.md",
    text: fs.readFileSync(workflowFile, "utf8")
  })

  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  assert.equal(parsed.workflow.stepExecution.mode, "engineSteps")
  assert.equal(parsed.workflow.branching.enabled, true)
  assert.equal(parsed.workflow.branching.loops[0].id, "revise-until-approved")
  assert.equal(parsed.workflow.branching.loops[0].maxIterations, 5)
  assert.deepEqual(parsed.workflow.engineSteps.map((step) => step.id), [
    "collect-user-input",
    "generate-draft",
    "preapproval-check",
    "user-approval",
    "finalize"
  ])
  assert.equal(parsed.workflow.engineSteps[0].form.resultKey, "userRequest")
  assert.equal(parsed.workflow.engineSteps[3].approval.resultKey, "userApproval")
  assert.equal(parsed.workflow.engineSteps[2].transition.decisions[0].goto, "collect-user-input")
  assert.equal(parsed.workflow.engineSteps[3].transition.decisions[0].goto, "collect-user-input")
})
