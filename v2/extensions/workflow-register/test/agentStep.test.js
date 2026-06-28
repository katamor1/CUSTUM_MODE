const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const extensionRoot = path.resolve(__dirname, "..")
const repoRoot = path.resolve(extensionRoot, "..", "..")

test("agent step prompt includes only the current workflow step and requested state", () => {
  const { buildWorkflowAgentPrompt } = require("../out/agentStep")

  const prompt = buildWorkflowAgentPrompt({
    workflowId: "workflow-register.bazaar-project-rule-review",
    workflowName: "bazaar-project-rule-review",
    stepIndex: 3,
    stepId: "analyze-changes",
    stepTitle: "Analyze the changes against project-specific rules.",
    stepPrompt: "Analyze the current change.",
    workflowInstructions: "Review the selected Bazaar revision.",
    stateEntries: [
      { key: "reviewContext", value: "{\"target\":\"2\"}" },
      { key: "reviewRules", value: "{\"rules\":[]}" }
    ]
  })

  assert.match(prompt, /workflow-register\.bazaar-project-rule-review/)
  assert.match(prompt, /<workflow_step index="4" id="analyze-changes">/)
  assert.match(prompt, /Analyze the current change\./)
  assert.match(prompt, /<state key="reviewContext">/)
  assert.match(prompt, /\{"target":"2"\}/)
  assert.doesNotMatch(prompt, /output-result: Produce review-result/)
})

test("subagent result extraction accepts Bob result objects and strings", () => {
  const { extractSubagentResult } = require("../out/agentStep")

  assert.equal(extractSubagentResult({ result: "analysis complete" }), "analysis complete")
  assert.equal(extractSubagentResult("plain result"), "plain result")
  assert.equal(extractSubagentResult({ result: "   " }), undefined)
  assert.equal(extractSubagentResult({ error: "failed" }), undefined)
})

test("Bazaar workflow template lets AI-agent steps complete themselves", () => {
  const { parseWorkflowMarkdown } = require("../out/core/parser")
  const workflowPath = path.join(
    repoRoot,
    "extensions",
    "bob-bazaar-review",
    "templates",
    ".bob",
    "workflows",
    "bazaar-project-rule-review",
    "WORKFLOW.md"
  )
  const workflow = fs.readFileSync(workflowPath, "utf8")
  const parsed = parseWorkflowMarkdown({ sourceId: "workflow-register", filePath: workflowPath, text: workflow })

  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  const analyze = parsed.workflow.engineSteps.find((step) => step.id === "analyze-changes")
  const output = parsed.workflow.engineSteps.find((step) => step.id === "output-result")

  assert.equal(analyze.type, "agent")
  assert.equal(analyze.resultKey, "reviewAnalysis")
  assert.deepEqual(analyze.includeState, ["reviewContext", "reviewRules"])
  assert.equal(output.type, "agent")
  assert.deepEqual(output.includeState, ["reviewContext", "reviewRules", "reviewAnalysis"])
  assert.equal(output.result.source, "agent")
  assert.equal(output.result.sinks[0].command, "bobBazaar.captureReviewResult")
})
