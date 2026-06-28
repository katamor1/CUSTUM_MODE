const assert = require("node:assert/strict")
const path = require("node:path")
const { test } = require("node:test")

const extensionRoot = path.resolve(__dirname, "..")
const outRoot = path.join(extensionRoot, "out")
const { createMockWorkflowAiProvider, chooseTemplateFromGoal } = require(path.join(outRoot, "core", "mockWorkflowAiProvider.js"))
const { formatWorkflowDiagnosticExplanation, formatWorkflowRepairProposal } = require(path.join(outRoot, "core", "workflowAiProvider.js"))
const { buildWorkflowFromDesignDraft } = require(path.join(outRoot, "core", "workflowDesignBuilder.js"))
const { buildWorkflowRepairContext } = require(path.join(outRoot, "core", "workflowRepairContext.js"))
const { validateWorkflowText } = require(path.join(outRoot, "core", "workflowValidator.js"))

test("mock workflow AI provider chooses deterministic templates from goals", () => {
  assert.equal(chooseTemplateFromGoal("review changed workflow files"), "review-workflow")
  assert.equal(chooseTemplateFromGoal("create a markdown report artifact"), "artifact-output")
  assert.equal(chooseTemplateFromGoal("collect user input parameters"), "input-driven-agent")
  assert.equal(chooseTemplateFromGoal("run a command to collect context"), "command-then-agent")
  assert.equal(chooseTemplateFromGoal("do a manual checklist"), "manual-checklist")
  assert.equal(chooseTemplateFromGoal("safe guarded command"), "guarded-command")
  assert.equal(chooseTemplateFromGoal("summarize the workspace"), "simple-agent")
})

test("mock workflow AI design output still passes through builder validation", async () => {
  const provider = createMockWorkflowAiProvider()
  const draft = await provider.designWorkflow({ goal: "review changed workflow files" })
  const result = buildWorkflowFromDesignDraft(draft, { sourceId: "workflow-register" })

  assert.equal(provider.id, "mock-workflow-ai-provider")
  assert.equal(draft.template, "review-workflow")
  assert.equal(result.ok, true, result.reportLines.join("\n"))
  assert.match(result.markdown, /schemaVersion: workflow-register\/v1/)
})

test("AI provider invalid draft is stopped by the builder safety gate", () => {
  const result = buildWorkflowFromDesignDraft({ name: "", description: "" }, { sourceId: "workflow-register" })

  assert.equal(result.ok, false)
  assert.equal(result.markdown, undefined)
  assert.ok(result.reportLines.some((line) => line.includes("Draft name is required")))
})

test("mock workflow AI repair proposal is report-only by default", async () => {
  const provider = createMockWorkflowAiProvider()
  const validation = validateWorkflowText({ sourceId: "workflow-register", filePath: ".bob/workflows/sample/WORKFLOW.md", text: invalidWorkflowText() })
  const repairContext = buildWorkflowRepairContext(".bob/workflows/sample/WORKFLOW.md", validation)
  const proposal = await provider.improveWorkflow({ filePath: repairContext.filePath, workflowText: invalidWorkflowText(), repairContext })
  const lines = formatWorkflowRepairProposal(proposal)

  assert.equal(proposal.replacementMarkdown, undefined)
  assert.match(proposal.summary, /Found 1 problem/)
  assert.ok(lines.some((line) => line.includes("AI repair proposal")))
})

test("mock workflow AI explanations include repair targets and likely fixes", async () => {
  const provider = createMockWorkflowAiProvider()
  const validation = validateWorkflowText({ sourceId: "workflow-register", filePath: ".bob/workflows/sample/WORKFLOW.md", text: invalidWorkflowText() })
  const repairContext = buildWorkflowRepairContext(".bob/workflows/sample/WORKFLOW.md", validation)
  const explanation = await provider.explainDiagnostics({ filePath: repairContext.filePath, repairContext })
  const lines = formatWorkflowDiagnosticExplanation(explanation)

  assert.equal(explanation.items[0].repairTarget, "steps[].includeState")
  assert.match(explanation.items[0].likelyFix, /resultKey/)
  assert.ok(lines.some((line) => line.includes("AI diagnostic explanation")))
})

function invalidWorkflowText() {
  return `---
schemaVersion: workflow-register/v1
name: sample
description: Sample workflow.
steps:
  - id: analyze
    title: Analyze
    type: agent
    includeState:
      - missingContext
    prompt: Analyze.
---
# Sample
`
}
