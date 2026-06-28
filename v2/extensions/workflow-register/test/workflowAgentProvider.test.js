const assert = require("node:assert/strict")
const { test } = require("node:test")

test("command agent provider forwards engine input to a configured command", async () => {
  const { createCommandAgentProvider } = require("../out/core/agentProvider")
  const calls = []
  const provider = createCommandAgentProvider({
    command: "bob.agent.run",
    executeCommand: async (command, input) => {
      calls.push({ command, input })
      return { text: `agent result for ${input.stepId}` }
    }
  })

  const result = await provider.run({
    workflowId: "workflow-register.sample",
    runId: "run-1",
    stepId: "analyze",
    prompt: "Analyze",
    inputs: { revision: "123" },
    state: { reviewContext: "{}" }
  })

  assert.equal(result, "agent result for analyze")
  assert.equal(calls[0].command, "bob.agent.run")
  assert.equal(calls[0].input.prompt, "Analyze")
  assert.equal(calls[0].input.inputs.revision, "123")
})

test("command agent provider is absent without a configured command", () => {
  const { createCommandAgentProvider } = require("../out/core/agentProvider")

  assert.equal(createCommandAgentProvider({ command: "", executeCommand: async () => "unused" }), undefined)
})

test("command agent provider rejects unsupported command return values", async () => {
  const { createCommandAgentProvider } = require("../out/core/agentProvider")
  const provider = createCommandAgentProvider({
    command: "bob.agent.run",
    executeCommand: async () => ({ status: "ok" })
  })

  await assert.rejects(
    () => provider.run({ workflowId: "w", runId: "r", stepId: "s", prompt: "p", inputs: {}, state: {} }),
    /Agent provider command must return a string/
  )
})
