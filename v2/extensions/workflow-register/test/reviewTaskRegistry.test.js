const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { ReviewTaskRegistry } = require("../out/reviewTaskRegistry.js")
const workspaceRoot = path.resolve("workspace")

test("ReviewTaskRegistry keeps identical run and step ids isolated by workspace root", () => {
  const registry = new ReviewTaskRegistry()
  const rootA = path.resolve("workspace-a")
  const rootB = path.resolve("workspace-b")
  let completionsA = 0
  let completionsB = 0
  const taskA = { setStepComplete: () => { completionsA += 1 } }
  const taskB = { setStepComplete: () => { completionsB += 1 } }

  assert.equal(registry.register(rootA, "shared-run", "review", taskA), true)
  assert.equal(registry.register(rootB, "shared-run", "review", taskB), true)
  assert.equal(registry.taskForRun(rootA, "shared-run"), taskA)
  assert.equal(registry.taskForRun(rootB, "shared-run"), taskB)
  assert.equal(registry.taskForStep(rootA, "shared-run", "review"), taskA)
  assert.equal(registry.taskForStep(rootB, "shared-run", "review"), taskB)

  assert.equal(registry.complete(rootA, "shared-run", "review"), true)
  assert.equal(completionsA, 1)
  assert.equal(completionsB, 0)
  assert.equal(registry.complete(rootA, "shared-run", "review"), false)
  assert.equal(registry.complete(rootB, "shared-run", "review"), true)
  assert.equal(completionsA, 1)
  assert.equal(completionsB, 1)
})

test("ReviewTaskRegistry normalizes equivalent workspace roots", () => {
  const registry = new ReviewTaskRegistry()
  const workspaceRoot = path.resolve("workspace-normalized")
  const equivalentRoot = path.join(workspaceRoot, "nested", "..")
  const lookupRoot = process.platform === "win32" ? equivalentRoot.toUpperCase() : equivalentRoot
  let completions = 0
  const task = { setStepComplete: () => { completions += 1 } }

  assert.equal(registry.register(workspaceRoot, "shared-run", "review", task), true)
  assert.equal(registry.taskForRun(lookupRoot, "shared-run"), task)
  assert.equal(registry.taskForStep(lookupRoot, "shared-run", "review"), task)
  assert.equal(registry.complete(lookupRoot, "shared-run", "review"), true)
  assert.equal(completions, 1)
})

test("ReviewTaskRegistry treats a workspace alias and its physical root as one identity", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-register-task-root-alias-"))
  t.after(() => fs.rmSync(base, { recursive: true, force: true }))
  const physicalRoot = path.join(base, "physical")
  const aliasRoot = path.join(base, "alias")
  fs.mkdirSync(physicalRoot)
  try {
    fs.symlinkSync(physicalRoot, aliasRoot, process.platform === "win32" ? "junction" : "dir")
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP", "UNKNOWN"].includes(error.code)) {
      t.skip(`directory alias unavailable: ${error.code}`)
      return
    }
    throw error
  }
  const registry = new ReviewTaskRegistry()
  const task = { setStepComplete: () => undefined }

  assert.equal(registry.register(aliasRoot, "shared-run", "review", task), true)
  assert.equal(registry.taskForRun(physicalRoot, "shared-run"), task)
  assert.equal(registry.taskForStep(physicalRoot, "shared-run", "review"), task)
})

test("ReviewTaskRegistry selects the agent provider by workspace root", async () => {
  const registry = new ReviewTaskRegistry()
  const rootA = path.resolve("workspace-agent-a")
  const rootB = path.resolve("workspace-agent-b")
  const workflow = {
    id: "workflow-1",
    name: "Traceability",
    engineSteps: [{
      id: "generate-traceability-draft",
      type: "agent",
      title: "Generate traceability draft",
      prompt: "Generate the draft"
    }]
  }

  assert.equal(registry.register(rootA, "shared-run", "collect", {
    startSubagent: async () => ({ result: "workspace-a" })
  }), true)
  assert.equal(registry.register(rootB, "shared-run", "collect", {
    startSubagent: async () => ({ result: "workspace-b" })
  }), true)

  const providerA = registry.agentProviderForRun(rootA, "shared-run", workflow)
  const providerB = registry.agentProviderForRun(rootB, "shared-run", workflow)
  const input = {
    workflowId: workflow.id,
    runId: "shared-run",
    stepId: "generate-traceability-draft",
    prompt: "fallback prompt",
    inputs: {},
    state: {}
  }

  assert.equal(await providerA.run(input), "workspace-a")
  assert.equal(await providerB.run(input), "workspace-b")
})

test("ReviewTaskRegistry completes the matching Bob review task once", () => {
  const registry = new ReviewTaskRegistry()
  let completions = 0

  registry.register(workspaceRoot, "run-1", "collect", {
    setStepComplete: () => {
      completions += 1
    }
  })

  assert.equal(registry.complete(workspaceRoot, "run-1", "collect"), true)
  assert.equal(completions, 1)
  assert.equal(registry.complete(workspaceRoot, "run-1", "collect"), false)
  assert.equal(completions, 1)
})

test("ReviewTaskRegistry leaves other review tasks active", () => {
  const registry = new ReviewTaskRegistry()
  let collectCompleted = false
  let draftCompleted = false

  registry.register(workspaceRoot, "run-1", "collect", {
    setStepComplete: () => {
      collectCompleted = true
    }
  })
  registry.register(workspaceRoot, "run-1", "draft", {
    setStepComplete: () => {
      draftCompleted = true
    }
  })

  assert.equal(registry.complete(workspaceRoot, "run-1", "draft"), true)
  assert.equal(collectCompleted, false)
  assert.equal(draftCompleted, true)
  assert.equal(registry.complete(workspaceRoot, "run-1", "collect"), true)
  assert.equal(collectCompleted, true)
})

test("ReviewTaskRegistry can advance later Operation Hub-driven steps from the run task", () => {
  const registry = new ReviewTaskRegistry()
  let completions = 0

  registry.register(workspaceRoot, "run-1", "collect", {
    setStepComplete: () => {
      completions += 1
    }
  })

  assert.equal(registry.complete(workspaceRoot, "run-1", "collect"), true)
  assert.equal(registry.complete(workspaceRoot, "run-1", "draft"), true)
  assert.equal(completions, 2)
})

test("ReviewTaskRegistry exposes the reviewed Bob task as an agent provider for later steps", async () => {
  const registry = new ReviewTaskRegistry()
  const prompts = []

  assert.equal(registry.register(workspaceRoot, "run-1", "collect", {
    startSubagent: async (prompt) => {
      prompts.push(prompt)
      return { result: "draft-json" }
    }
  }), true)

  const provider = registry.agentProviderForRun(workspaceRoot, "run-1", {
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

  registry.register(workspaceRoot, "run-1", "collect", {
    resultText: "bound-result",
    startSubagent() {
      return this.resultText
    }
  })

  const provider = registry.agentProviderForRun(workspaceRoot, "run-1", {
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

  registry.register(workspaceRoot, "run-1", "collect", {})

  assert.equal(registry.complete(workspaceRoot, "run-1", "collect"), false)
})
