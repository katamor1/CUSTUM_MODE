const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const { parseWorkflowMarkdown } = require("../out/core/parser")

const repoRoot = path.resolve(__dirname, "..", "..", "..")
const expectedProcessWorkflows = [
  "process-code-doc-investigation",
  "process-qa-intake-analysis",
  "process-external-spec-design",
  "process-external-spec-review",
  "process-internal-spec-design",
  "process-internal-spec-review",
  "process-coding-plan",
  "process-code-precheck",
  "process-unit-test-design",
  "process-unit-test-execution-review",
  "process-functional-test-design",
  "process-functional-test-execution-review",
  "process-integration-test-design",
  "process-common-review"
]

const processCommandIds = [
  "bobProcess.validateCatalog",
  "bobProcess.loadProcessInput",
  "bobProcess.collectEvidence",
  "bobProcess.validateReviewResult",
  "bobProcess.writeProcessRecord",
  "bobProcess.generateCampaignSummary"
]

test("Phase 3 process workflow templates parse cleanly and enforce command guardrails", () => {
  for (const workflowName of expectedProcessWorkflows) {
    const workflowFile = path.join(repoRoot, ".bob", "workflows", workflowName, "WORKFLOW.md")
    const parsed = parseWorkflowMarkdown({
      sourceId: "workflow-register",
      filePath: `.bob/workflows/${workflowName}/WORKFLOW.md`,
      text: fs.readFileSync(workflowFile, "utf8")
    })

    assert.equal(parsed.ok, true, `${workflowName}\n${parsed.diagnostics.join("\n")}`)
    assert.equal(parsed.workflow.name, workflowName)
    assert.equal(parsed.workflow.schemaVersion, "workflow-register/v1")
    assert.equal(parsed.workflow.stepExecution.mode, "engineSteps")
    assert.equal(parsed.workflow.stepReview.enabled, true)
    assert.equal(parsed.workflow.stepReview.requireAcceptBeforeNext, true)
    assert.equal(parsed.workflow.requires.workspace, true)
    assert.ok(parsed.workflow.permissions.includes("todo"), `${workflowName} must be todo-driven`)
    assert.ok(parsed.workflow.guardrails.allowedCommands.includes("vscode.executeCommand"), `${workflowName} must use vscode command bridge`)
    for (const commandId of processCommandIds) {
      assert.ok(parsed.workflow.guardrails.allowedCommandIds.includes(commandId), `${workflowName} allows ${commandId}`)
    }
    assert.equal(parsed.workflow.engineSteps.some((step) => step.type === "manual" && step.approval), true, `${workflowName} has human gate`)
    assert.equal(parsed.workflow.engineSteps.some((step) => step.type === "agent"), true, `${workflowName} has agent work`)
    for (const artifact of parsed.workflow.artifacts) {
      assert.match(artifact.path, /^\.bob-process-(runs|records)\//, `${workflowName} artifact ${artifact.id} stays in process roots`)
    }
    for (const step of parsed.workflow.engineSteps.filter((item) => item.type === "command")) {
      assert.ok(parsed.workflow.guardrails.allowedCommands.includes(step.action.provider), `${workflowName}:${step.id} provider is allowlisted`)
      if (step.action.provider === "vscode.executeCommand") {
        assert.ok(parsed.workflow.guardrails.allowedCommandIds.includes(step.action.args[0]), `${workflowName}:${step.id} command id is allowlisted`)
      }
    }
    if (workflowName === "process-code-precheck") {
      const providers = parsed.workflow.engineSteps
        .filter((step) => step.type === "command")
        .map((step) => step.action.provider)
      assert.ok(providers.includes("bobCodeConsistency.preprocess"), "code precheck runs Phase 2 preprocess")
      assert.ok(providers.includes("bobCodeConsistency.validateOutput"), "code precheck validates Phase 2 output")
      assert.ok(providers.includes("bobCodeConsistency.triage"), "code precheck prepares human triage")
      const recordStep = parsed.workflow.engineSteps.find((step) => step.id === "write-process-record")
      assert.ok(recordStep.action.args[1].record.phase2Handoff, "code precheck writes Phase 2 handoff into process record")
    }
    assert.equal(parsed.diagnostics.some((line) => line.includes("- warn:")), false, `${workflowName}\n${parsed.diagnostics.join("\n")}`)
  }
})
