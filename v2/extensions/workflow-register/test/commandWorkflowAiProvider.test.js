const assert = require("node:assert/strict")
const path = require("node:path")
const { test } = require("node:test")

const extensionRoot = path.resolve(__dirname, "..")
const outRoot = path.join(extensionRoot, "out")
const { CommandWorkflowAiProvider } = require(path.join(outRoot, "core", "commandWorkflowAiProvider.js"))
const { createConfiguredWorkflowAiProvider } = require(path.join(outRoot, "core", "workflowAiProviderFactory.js"))

test("command workflow AI provider calls command with design payload and validates output", async () => {
  const calls = []
  const provider = new CommandWorkflowAiProvider({
    command: "sample.aiProvider",
    executeCommand: (command, input) => {
      calls.push({ command, input })
      return { name: "review-files", description: "Review files.", template: "review-workflow", notes: ["ok"] }
    }
  })
  const draft = await provider.designWorkflow({ goal: "review files" })

  assert.equal(provider.id, "command:sample.aiProvider")
  assert.equal(draft.name, "review-files")
  assert.equal(calls[0].command, "sample.aiProvider")
  assert.deepEqual(calls[0].input.kind, "design")
})

test("command workflow AI provider rejects invalid design output", async () => {
  const provider = new CommandWorkflowAiProvider({ command: "sample.aiProvider", executeCommand: () => ({ name: "bad", template: "missing-template" }) })
  await assert.rejects(() => provider.designWorkflow({ goal: "bad" }), /Invalid AI design output/)
})

test("command workflow AI provider validates repair and explain outputs", async () => {
  const provider = new CommandWorkflowAiProvider({
    command: "sample.aiProvider",
    executeCommand: (_command, input) => input.kind === "improve"
      ? { summary: "Repair summary", notes: ["Do not auto-apply."], replacementMarkdown: "---\nschemaVersion: workflow-register/v1\nname: sample\ndescription: Sample.\n---\n# Sample\n" }
      : { summary: "Explain summary", items: [{ message: "m", explanation: "e", likelyFix: "f", repairTarget: "steps[].id" }] }
  })
  const repair = await provider.improveWorkflow({ filePath: "WORKFLOW.md", workflowText: "", repairContext: { filePath: "WORKFLOW.md", status: "valid", problems: [] } })
  const explanation = await provider.explainDiagnostics({ filePath: "WORKFLOW.md", repairContext: { filePath: "WORKFLOW.md", status: "valid", problems: [] } })

  assert.equal(repair.summary, "Repair summary")
  assert.match(repair.replacementMarkdown, /schemaVersion/)
  assert.equal(explanation.items[0].repairTarget, "steps[].id")
})

test("configured workflow AI provider falls back to mock when command is empty", async () => {
  const provider = createConfiguredWorkflowAiProvider({ command: "", executeCommand: () => { throw new Error("should not be called") } })
  const draft = await provider.designWorkflow({ goal: "review workflow files" })

  assert.equal(provider.id, "mock-workflow-ai-provider")
  assert.equal(draft.template, "review-workflow")
})

test("configured workflow AI provider uses command provider when command is set", async () => {
  const provider = createConfiguredWorkflowAiProvider({
    command: "sample.aiProvider",
    executeCommand: () => ({ name: "sample", description: "Sample workflow.", template: "simple-agent" })
  })
  const draft = await provider.designWorkflow({ goal: "sample" })

  assert.equal(provider.id, "command:sample.aiProvider")
  assert.equal(draft.name, "sample")
})
