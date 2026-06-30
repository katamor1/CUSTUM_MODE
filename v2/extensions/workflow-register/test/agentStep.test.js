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
    workflowRoot: "C:\\Users\\st\\source\\repos\\workspace",
    workflowFile: "C:\\Users\\st\\source\\repos\\workspace\\.bob\\workflows\\bazaar-project-rule-review\\WORKFLOW.md",
    workflowFolderName: "bazaar-project-rule-review",
    stepIndex: 3,
    stepId: "analyze-changes",
    stepTitle: "Analyze the changes against project-specific rules.",
    stepPrompt: "Analyze the current change.",
    workflowInstructions: "Review the selected Bazaar revision.",
    stateEntries: [
      { key: "reviewContext", value: "{\"target\":\"2\",\"workspacePath\":\"C:/Users/st/source/repos/bazaar_test/banch2\"}" },
      { key: "reviewRules", value: "{\"rules\":[]}" }
    ]
  })

  assert.match(prompt, /workflow-register\.bazaar-project-rule-review/)
  assert.match(prompt, /<workflow_context>/)
  assert.match(prompt, /<workflow_root>C:\\Users\\st\\source\\repos\\workspace<\/workflow_root>/)
  assert.match(prompt, /<bazaar_repository_root>C:\/Users\/st\/source\/repos\/bazaar_test\/banch2<\/bazaar_repository_root>/)
  assert.match(prompt, /Do not search parent directories, sibling workspace folders, or full workspace trees for \.bob/)
  assert.match(prompt, /<workflow_step index="4" id="analyze-changes">/)
  assert.match(prompt, /Analyze the current change\./)
  assert.match(prompt, /<state key="reviewContext">/)
  assert.match(prompt, /"target":"2"/)
  assert.doesNotMatch(prompt, /output-result: Produce review-result/)
})

test("agent step prompt treats identical workflow and Bazaar roots as resolved roles", () => {
  const { buildWorkflowAgentPrompt } = require("../out/agentStep")
  const root = "C:\\Users\\st\\source\\repos\\workspace"

  const prompt = buildWorkflowAgentPrompt({
    workflowId: "workflow-register.bazaar-project-rule-review",
    workflowName: "bazaar-project-rule-review",
    workflowRoot: root,
    workflowFile: `${root}\\.bob\\workflows\\bazaar-project-rule-review\\WORKFLOW.md`,
    workflowFolderName: "bazaar-project-rule-review",
    stepIndex: 4,
    stepId: "output-result",
    stepTitle: "review-result JSON と Markdown チェックリストを作成",
    stepPrompt: "Create the final result.",
    workflowInstructions: "Use .bob/review/results for output.",
    stateEntries: [
      { key: "reviewContext", value: JSON.stringify({ workspacePath: root, target: "2" }) }
    ]
  })

  assert.ok(prompt.includes(`<workflow_root>${root}</workflow_root>`))
  assert.ok(prompt.includes(`<bazaar_repository_root>${root}</bazaar_repository_root>`))
  assert.match(prompt, /Normal reads and writes inside workflow_root are allowed/)
  assert.match(prompt, /workflow_root and bazaar_repository_root may be the same path/)
  assert.doesNotMatch(prompt, /Do not search[^.]*workflow_root/)
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
