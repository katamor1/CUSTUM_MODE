const assert = require("node:assert/strict")
const { test } = require("node:test")

const { ReviewTaskRegistry } = require("../out/reviewTaskRegistry.js")

test("ReviewTaskRegistry completes the matching Bob review task once", () => {
  const registry = new ReviewTaskRegistry()
  let completions = 0

  registry.register("run-1", "collect", {
    setStepComplete: () => {
      completions += 1
    }
  })

  assert.equal(registry.complete("run-1", "collect"), true)
  assert.equal(completions, 1)
  assert.equal(registry.complete("run-1", "collect"), false)
  assert.equal(completions, 1)
})

test("ReviewTaskRegistry leaves other review tasks active", () => {
  const registry = new ReviewTaskRegistry()
  let collectCompleted = false
  let draftCompleted = false

  registry.register("run-1", "collect", {
    setStepComplete: () => {
      collectCompleted = true
    }
  })
  registry.register("run-1", "draft", {
    setStepComplete: () => {
      draftCompleted = true
    }
  })

  assert.equal(registry.complete("run-1", "draft"), true)
  assert.equal(collectCompleted, false)
  assert.equal(draftCompleted, true)
  assert.equal(registry.complete("run-1", "collect"), true)
  assert.equal(collectCompleted, true)
})

test("ReviewTaskRegistry can advance later Operation Hub-driven steps from the run task", () => {
  const registry = new ReviewTaskRegistry()
  let completions = 0

  registry.register("run-1", "collect", {
    setStepComplete: () => {
      completions += 1
    }
  })

  assert.equal(registry.complete("run-1", "collect"), true)
  assert.equal(registry.complete("run-1", "draft"), true)
  assert.equal(completions, 2)
})

test("ReviewTaskRegistry exposes the reviewed Bob task as an agent provider for later steps", async () => {
  const registry = new ReviewTaskRegistry()
  const prompts = []

  assert.equal(registry.register("run-1", "collect", {
    startSubagent: async (prompt) => {
      prompts.push(prompt)
      return { result: "draft-json" }
    }
  }), true)

  const provider = registry.agentProviderForRun("run-1", {
    id: "workflow-1",
    name: "Traceability",
    promptWithoutTodo: "workflow instructions",
    workflowRoot: "C:/workspace",
    workflowFile: "C:/workspace/.bob/workflows/code-review/WORKFLOW.md",
    workflowFolderName: "code-review",
    engineSteps: [{
      id: "generate-traceability-draft",
      type: "agent",
      title: "Generate traceability draft",
      prompt: "Generate the draft",
      includeState: ["traceabilityDraftPrompt"]
    }]
  })

  assert.ok(provider)
  const result = await provider.run({
    workflowId: "workflow-1",
    runId: "run-1",
    stepId: "generate-traceability-draft",
    prompt: "fallback prompt",
    inputs: {},
    state: { traceabilityDraftPrompt: "{\"status\":\"ok\"}" }
  })

  assert.equal(result, "draft-json")
  assert.equal(prompts.length, 1)
  assert.match(prompts[0], /Generate traceability draft/)
  assert.match(prompts[0], /traceabilityDraftPrompt/)
})

test("ReviewTaskRegistry keeps the Bob subagent method bound to its task", async () => {
  const registry = new ReviewTaskRegistry()

  registry.register("run-1", "collect", {
    resultText: "bound-result",
    startSubagent() {
      return this.resultText
    }
  })

  const provider = registry.agentProviderForRun("run-1", {
    id: "workflow-1",
    name: "Traceability",
    promptWithoutTodo: "workflow instructions",
    engineSteps: [{
      id: "generate-traceability-draft",
      type: "agent",
      title: "Generate traceability draft",
      prompt: "Generate the draft"
    }]
  })

  assert.equal(await provider.run({
    workflowId: "workflow-1",
    runId: "run-1",
    stepId: "generate-traceability-draft",
    prompt: "fallback prompt",
    inputs: {},
    state: {}
  }), "bound-result")
})

test("ReviewTaskRegistry is a no-op when Bob cannot mark a step complete", () => {
  const registry = new ReviewTaskRegistry()

  registry.register("run-1", "collect", {})

  assert.equal(registry.complete("run-1", "collect"), false)
})
