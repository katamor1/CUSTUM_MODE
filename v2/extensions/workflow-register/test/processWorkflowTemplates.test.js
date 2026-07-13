const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const { parseWorkflowMarkdown } = require("../out/core/parser")
const { validateWorkflowText } = require("../out/core/workflowValidator")

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
    const relativeFilePath = `.bob/workflows/${workflowName}/WORKFLOW.md`
    const workflowFile = path.join(repoRoot, ".bob", "workflows", workflowName, "WORKFLOW.md")
    const text = fs.readFileSync(workflowFile, "utf8")
    const parsed = parseWorkflowMarkdown({
      sourceId: "workflow-register",
      filePath: relativeFilePath,
      text
    })
    const validation = validateWorkflowText({
      sourceId: "workflow-register",
      filePath: relativeFilePath,
      text
    })

    assert.equal(parsed.ok, true, `${workflowName}\n${parsed.diagnostics.join("\n")}`)
    assert.equal(validation.ok, true, `${workflowName}\n${validation.diagnostics.join("\n")}`)
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
    assert.equal(parsed.workflow.branching?.enabled, true, `${workflowName} enables fail-closed branching`)
    const humanGateStep = parsed.workflow.engineSteps.find((step) => step.id === "human-gate")
    assert.equal(humanGateStep?.transition?.default, "fail", `${workflowName} rejects must stop before record writing`)
    const approvedDecision = humanGateStep?.transition?.decisions?.[0]
    assert.equal(approvedDecision?.id, "approved", `${workflowName} approval transition is explicit`)
    assert.equal(approvedDecision?.when?.stateKey, "humanGate.decision", `${workflowName} branches on the manual gate decision`)
    assert.equal(approvedDecision?.when?.equals, "approved", `${workflowName} records only after explicit approval`)
    assert.equal(approvedDecision?.goto, "write-process-record", `${workflowName} approval proceeds to record writing`)
    const recordStep = parsed.workflow.engineSteps.find((step) => step.type === "command" && step.action.args[0] === "bobProcess.writeProcessRecord")
    assert.equal(
      recordStep?.action?.args?.[1]?.record?.humanGate?.status,
      "{{json state.humanGate.decision}}",
      `${workflowName} records the manual gate decision from state`
    )
    for (const artifact of parsed.workflow.artifacts) {
      assert.match(artifact.path, /^\.bob-process-(runs|records)\//, `${workflowName} artifact ${artifact.id} stays in process roots`)
    }
    for (const [artifactId, stepId] of [
      ["evidenceIndex", "collect-evidence"],
      ["processRecord", "write-process-record"],
      ["campaignSummary", "generate-campaign-summary"]
    ]) {
      const matches = parsed.workflow.artifacts.filter((artifact) => artifact.id === artifactId)
      assert.equal(matches.length, 1, `${workflowName} declares ${artifactId} exactly once`)
      assert.equal(matches[0].producedBy, stepId, `${workflowName} assigns ${artifactId} to ${stepId}`)
    }
    const reviewArtifacts = parsed.workflow.artifacts.filter((artifact) => artifact.id === "reviewResult")
    const reviewResultStep = parsed.workflow.engineSteps.find((step) => step.id === "save-review-result")
    assert.equal(reviewArtifacts.length, 1, `${workflowName} declares reviewResult exactly once`)
    assert.equal(reviewArtifacts[0].producedBy, "save-review-result", `${workflowName} keeps reviewResult engine-owned`)
    assert.equal(reviewResultStep?.type, "result", `${workflowName} writes reviewResult through an engine result step`)
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
      const preprocessStep = parsed.workflow.engineSteps.find((step) => step.id === "phase2-preprocess")
      assert.equal(
        preprocessStep?.action?.args?.reviewInputPath,
        "{{inputs.phase2ReviewInputPath}}",
        "code precheck passes the selected Phase 2 review input path to preprocess"
      )
      assert.equal(
        Object.prototype.hasOwnProperty.call(preprocessStep?.action?.args ?? {}, "inputPath"),
        false,
        "code precheck must not use the ignored preprocess inputPath option"
      )
      assert.ok(recordStep.action.args[1].record.phase2Handoff, "code precheck writes Phase 2 handoff into process record")
    }
    assert.equal(parsed.diagnostics.some((line) => line.includes("- warn:")), false, `${workflowName}\n${parsed.diagnostics.join("\n")}`)
  }
})
