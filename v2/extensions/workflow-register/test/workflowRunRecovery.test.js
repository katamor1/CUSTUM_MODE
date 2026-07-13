const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "workflow-register-recovery-"))
}

function sampleWorkflow() {
  return {
    id: "workflow-register.recovery",
    name: "recovery",
    label: "Recovery",
    description: "Recovery workflow.",
    schemaVersion: "workflow-register/v1",
    definitionHash: "definition-v1",
    filePath: ".bob/workflows/recovery/WORKFLOW.md",
    prompt: "",
    promptWithoutTodo: "",
    commandArgs: [],
    mode: "agent",
    permissions: [],
    autoApprovalEnabled: false,
    workspaceRequired: false,
    hidden: false,
    todoEnabled: false,
    todoRequired: false,
    todoAsSteps: false,
    stepCompletion: "auto",
    stepMessage: "silent",
    todos: [],
    inputs: { revision: { type: "string", required: true } },
    requires: {},
    preflight: [],
    tools: {},
    guardrails: { allowedCommands: ["sample.collect", "sample.analyze"] },
    artifacts: [],
    completion: {},
    engineSteps: [
      { id: "collect", title: "Collect", type: "command", action: { provider: "sample.collect" }, resultKey: "collectResult" },
      { id: "analyze", title: "Analyze", type: "command", action: { provider: "sample.analyze" }, resultKey: "analyzeResult" }
    ]
  }
}

test("file run state store allocates unique run ids before runs are saved", async () => {
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const workflow = sampleWorkflow()
  const runStore = new FileRunStateStore({ workspaceRoot, now: () => "2026-06-30T00:00:00.000Z", engineVersion: "test-engine" })

  const [first, second] = await Promise.all([
    runStore.createRun(workflow, { revision: "77" }),
    runStore.createRun(workflow, { revision: "77" })
  ])

  assert.notEqual(first.runId, second.runId)
})

test("file run state store retries transient rename failures while saving run state", async () => {
  const fsPromises = require("node:fs/promises")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const workflow = sampleWorkflow()
  const runStore = new FileRunStateStore({ workspaceRoot, now: () => "2026-06-30T00:00:00.000Z", engineVersion: "test-engine" })
  const run = await runStore.createRun(workflow, { revision: "77" })
  await runStore.saveRun(run)

  const originalRename = fsPromises.rename
  let renameCalls = 0
  fsPromises.rename = async (...args) => {
    renameCalls += 1
    if (renameCalls === 1) {
      const error = new Error("transient rename failure")
      error.code = "EPERM"
      throw error
    }
    return originalRename(...args)
  }

  try {
    run.status = "paused"
    await runStore.saveRun(run)
  } finally {
    fsPromises.rename = originalRename
  }

  assert.equal(renameCalls, 2)
  assert.equal((await runStore.loadRun(run.runId)).status, "paused")
})

test("workflow engine resumes a recoverable run with the same serialized inputs and state", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const workflow = sampleWorkflow()
  const inputs = { revision: "77" }
  const runStore = new FileRunStateStore({ workspaceRoot, now: () => "2026-06-30T00:00:00.000Z", engineVersion: "test-engine" })

  const interrupted = await runStore.createRun(workflow, inputs)
  interrupted.status = "running"
  interrupted.currentStep = "analyze"
  interrupted.state.collectResult = "cached-context"
  interrupted.steps[0].status = "completed"
  interrupted.steps[1].status = "running"
  await runStore.saveRun(interrupted)

  let collectCount = 0
  const actions = new ActionRegistry()
  actions.register({ id: "sample.collect", execute: async () => { collectCount += 1; return "unexpected" } })
  actions.register({ id: "sample.analyze", execute: async (input) => ({ revision: input.inputs.revision, collectResult: input.state.collectResult, resumed: true }) })

  const engine = new WorkflowEngine({ actions, resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }), runStore })
  const result = await engine.runWorkflow(workflow, { revision: "77" })

  assert.equal(result.runId, interrupted.runId)
  assert.equal(result.status, "completed")
  assert.equal(collectCount, 0)
  assert.equal(result.state.collectResult, "cached-context")
  assert.deepEqual(JSON.parse(result.state.analyzeResult), { revision: "77", collectResult: "cached-context", resumed: true })
  assert.equal((await runStore.listRuns()).length, 1)
})

test("command presentation hook failure does not replay a successful provider", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const workflow = {
    id: "workflow-register.command-observer-recovery",
    name: "command-observer-recovery",
    label: "Command Observer Recovery",
    description: "Do not replay a provider when a presentation-only command observer fails.",
    schemaVersion: "workflow-register/v1",
    definitionHash: "definition-v1",
    filePath: ".bob/workflows/command-observer-recovery/WORKFLOW.md",
    inputs: {},
    engineSteps: [
      { id: "mutate", title: "Mutate", type: "command", action: { provider: "sample.mutate" }, resultKey: "mutationResult" }
    ]
  }
  const runStore = new FileRunStateStore({ workspaceRoot, now: () => "2026-06-30T00:00:00.000Z", engineVersion: "test-engine" })
  const actions = new ActionRegistry()
  let providerCalls = 0
  actions.register({
    id: "sample.mutate",
    execute: async () => ({ call: ++providerCalls })
  })
  let failObserver = true
  const engine = new WorkflowEngine({
    actions,
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore,
    hooks: {
      onCommandResult: async () => {
        if (!failObserver) return
        failObserver = false
        throw new Error("Bob sendMessage failed")
      }
    }
  })

  let firstError
  let result
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args)
  try {
    try {
      result = await engine.runWorkflow(workflow, {})
    } catch (error) {
      firstError = error
      result = await engine.runWorkflow(workflow, {})
    }
  } finally {
    console.warn = originalWarn
  }

  assert.equal(providerCalls, 1, "presentation hook failure must not make the provider recoverable and replay it")
  assert.equal(firstError, undefined)
  assert.equal(warnings.length, 1)
  assert.match(String(warnings[0][0]), /command-result presentation hook failed/)
  assert.equal(result.status, "completed")
  assert.deepEqual(JSON.parse(result.state.mutationResult), { call: 1 })
  assert.equal((await runStore.listRuns()).length, 1)
})

test("same-run recovery cannot continue past a durable provider phase from two executors", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const workflow = {
    id: "workflow-register.command-observer-concurrency",
    name: "command-observer-concurrency",
    label: "Command Observer Concurrency",
    description: "Do not replay a provider while its presentation observer is blocked.",
    schemaVersion: "workflow-register/v1",
    definitionHash: "definition-v1",
    filePath: ".bob/workflows/command-observer-concurrency/WORKFLOW.md",
    inputs: {},
    engineSteps: [
      { id: "mutate", title: "Mutate", type: "command", action: { provider: "sample.mutate" }, resultKey: "mutationResult" },
      { id: "followup", title: "Follow up", type: "command", action: { provider: "sample.followup" }, resultKey: "followupResult" }
    ]
  }
  const runStore = new FileRunStateStore({ workspaceRoot, now: () => "2026-06-30T00:00:00.000Z", engineVersion: "test-engine" })
  const actions = new ActionRegistry()
  let providerCalls = 0
  actions.register({
    id: "sample.mutate",
    execute: async () => ({ call: ++providerCalls })
  })
  let followupCalls = 0
  actions.register({
    id: "sample.followup",
    execute: async () => ({ call: ++followupCalls })
  })
  let observerEntered
  const entered = new Promise((resolve) => { observerEntered = resolve })
  let releaseObserver
  const released = new Promise((resolve) => { releaseObserver = resolve })
  let completionCalls = 0
  const resultSinks = () => createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined })
  const firstEngine = new WorkflowEngine({
    actions,
    resultSinks: resultSinks(),
    runStore,
    hooks: {
      onCommandResult: async () => {
        observerEntered()
        await released
      },
      onStepCompleted: async () => { completionCalls += 1 }
    }
  })
  const firstExecution = firstEngine.runWorkflow(workflow, {})
  let releaseSecondStepStart = () => undefined
  let secondExecution

  try {
    await entered
    const persistedWhileBlocked = (await runStore.listRuns())[0]
    assert.equal(
      Object.keys(persistedWhileBlocked.state).some((key) => key.startsWith("workflow.commandProviderCompleted.")),
      true,
      "the first provider phase must be durable before its presentation observer returns"
    )
    let secondStepStartEntered
    const secondStepStarted = new Promise((resolve) => { secondStepStartEntered = resolve })
    const secondStepStartReleased = new Promise((resolve) => { releaseSecondStepStart = resolve })
    let secondStepStarts = 0
    const secondEngine = new WorkflowEngine({
      actions,
      resultSinks: resultSinks(),
      runStore,
      hooks: {
        onStepStart: async () => {
          secondStepStarts += 1
          secondStepStartEntered()
          await secondStepStartReleased
        },
        onStepCompleted: async () => { completionCalls += 1 }
      }
    })
    secondExecution = secondEngine.runWorkflow(workflow, {})

    await Promise.race([
      secondStepStarted,
      new Promise((resolve) => setTimeout(resolve, 1_500))
    ])
    releaseObserver()
    const firstResult = await firstExecution
    releaseSecondStepStart()
    const secondResult = await secondExecution

    assert.equal(providerCalls, 1, "a recoverable execution must reuse the durable provider completion")
    assert.equal(followupCalls, 1, "only one executor may own continuation into the next provider")
    assert.equal(secondResult.runId, persistedWhileBlocked.runId)
    assert.deepEqual(JSON.parse(secondResult.state.mutationResult), { call: 1 })
    assert.equal(firstResult.runId, secondResult.runId)
    assert.equal(firstResult.status, "completed")
    assert.equal(secondResult.status, "completed")
    assert.equal(secondStepStarts, 0, "a duplicate executor must join the active same-run execution before step hooks")
    assert.equal(completionCalls, 2, "each workflow step must complete exactly once")
    assert.equal((await runStore.listRuns()).length, 1)
  } finally {
    releaseObserver()
    releaseSecondStepStart()
    await firstExecution.catch(() => undefined)
    await secondExecution?.catch(() => undefined)
  }
})

test("queued runWorkflow captures terminal drift even when the run store aliases state objects", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const workflow = {
    id: "workflow-register.queued-run-failure",
    name: "queued-run-failure",
    label: "Queued Run Failure",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    engineSteps: [
      { id: "mutate", title: "Mutate", type: "command", action: { provider: "sample.mutate" }, resultKey: "mutationResult" }
    ]
  }
  const seedStore = new FileRunStateStore({ workspaceRoot, engineVersion: "test-engine" })
  let sharedRun = await seedStore.createRun(workflow, {})
  let recoverableLookups = 0
  const runStore = {
    workspaceRoot,
    createRun: async () => sharedRun,
    findRecoverableRun: async () => (++recoverableLookups === 1 ? undefined : sharedRun),
    loadRun: async (runId) => runId === sharedRun.runId ? sharedRun : undefined,
    saveRun: async (run) => { sharedRun = run }
  }
  const actions = new ActionRegistry()
  let providerCalls = 0
  let firstProviderEntered
  const providerEntered = new Promise((resolve) => { firstProviderEntered = resolve })
  let releaseFirstProvider = () => undefined
  const firstProviderReleased = new Promise((resolve) => { releaseFirstProvider = resolve })
  actions.register({
    id: "sample.mutate",
    execute: async () => {
      providerCalls += 1
      if (providerCalls === 1) {
        firstProviderEntered()
        await firstProviderReleased
        throw new Error("first execution failed")
      }
      return "unexpected implicit retry"
    }
  })
  const resultSinks = () => createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined })
  const firstEngine = new WorkflowEngine({ actions, resultSinks: resultSinks(), runStore })
  const secondEngine = new WorkflowEngine({ actions, resultSinks: resultSinks(), runStore })
  const firstExecution = firstEngine.runWorkflow(workflow, {})
  let secondExecution

  try {
    await providerEntered
    secondExecution = secondEngine.runWorkflow(workflow, {}, { executionMode: "singleStep", stepId: "mutate" })
    await new Promise((resolve) => setImmediate(resolve))
    releaseFirstProvider()

    const [firstResult, secondResult] = await Promise.all([firstExecution, secondExecution])
    assert.equal(firstResult.status, "failed")
    assert.equal(secondResult.status, "failed")
    assert.equal(secondResult.runId, firstResult.runId)
    assert.equal(providerCalls, 1, "a queued runWorkflow call must not turn failure into an implicit retry")
  } finally {
    releaseFirstProvider()
    await firstExecution.catch(() => undefined)
    await secondExecution?.catch(() => undefined)
  }
})

for (const terminalStatus of ["failed", "completed"]) {
  test(`queued resumeRun treats a newly ${terminalStatus} run as terminal`, async () => {
    const { ActionRegistry } = require("../out/core/actionRegistry")
    const { WorkflowEngine } = require("../out/core/engine")
    const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
    const { FileRunStateStore } = require("../out/core/runStateStore")

    const workspaceRoot = tempDir()
    const workflow = {
      id: `workflow-register.queued-resume-${terminalStatus}`,
      name: `queued-resume-${terminalStatus}`,
      label: `Queued Resume ${terminalStatus}`,
      schemaVersion: "workflow-register/v1",
      inputs: {},
      engineSteps: [
        { id: "mutate", title: "Mutate", type: "command", action: { provider: "sample.mutate" }, resultKey: "mutationResult" }
      ]
    }
    const runStore = new FileRunStateStore({ workspaceRoot, engineVersion: "test-engine" })
    const paused = await runStore.createRun(workflow, {})
    paused.status = "paused"
    paused.currentStep = "mutate"
    await runStore.saveRun(paused)

    const actions = new ActionRegistry()
    let providerCalls = 0
    let firstProviderEntered
    const providerEntered = new Promise((resolve) => { firstProviderEntered = resolve })
    let releaseFirstProvider = () => undefined
    const firstProviderReleased = new Promise((resolve) => { releaseFirstProvider = resolve })
    actions.register({
      id: "sample.mutate",
      execute: async () => {
        providerCalls += 1
        if (providerCalls === 1) {
          firstProviderEntered()
          await firstProviderReleased
          if (terminalStatus === "failed") throw new Error("first resume failed")
          return "completed once"
        }
        return "unexpected implicit resume"
      }
    })
    const resultSinks = () => createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined })
    const firstEngine = new WorkflowEngine({ actions, resultSinks: resultSinks(), runStore })
    const secondEngine = new WorkflowEngine({ actions, resultSinks: resultSinks(), runStore })
    const firstExecution = firstEngine.resumeRun(paused.runId, { workflow, executionMode: "full" })
    let secondExecution

    try {
      await providerEntered
      secondExecution = secondEngine.resumeRun(paused.runId, { workflow, executionMode: "singleStep" })
      releaseFirstProvider()

      const [firstResult, secondResult] = await Promise.all([firstExecution, secondExecution])
      assert.equal(firstResult.status, terminalStatus)
      assert.equal(secondResult.status, terminalStatus)
      assert.equal(providerCalls, 1, `a queued resumeRun call must not re-enter a ${terminalStatus} run`)
    } finally {
      releaseFirstProvider()
      await firstExecution.catch(() => undefined)
      await secondExecution?.catch(() => undefined)
    }
  })
}

test("completing a held command clears its durable provider phase", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")
  const workspaceRoot = tempDir()
  const workflow = {
    id: "workflow-register.command-held-completion",
    name: "command-held-completion",
    label: "Command Held Completion",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    stepCompletion: "manual",
    engineSteps: [
      { id: "mutate", title: "Mutate", type: "command", action: { provider: "sample.mutate" }, resultKey: "mutationResult" }
    ]
  }
  const actions = new ActionRegistry()
  actions.register({ id: "sample.mutate", execute: async () => "mutated" })
  const runStore = new FileRunStateStore({ workspaceRoot, engineVersion: "test-engine" })
  const engine = new WorkflowEngine({
    actions,
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore,
    manualCompletion: async () => ({ completed: false })
  })

  const held = await engine.runWorkflow(workflow, {})
  assert.equal(held.status, "held")
  assert.equal(Object.keys(held.state).some((key) => key.startsWith("workflow.commandProviderCompleted.")), true)

  const completed = await engine.resumeRun(held.runId, { workflow, completeHeldStep: true })
  assert.equal(completed.status, "completed")
  assert.equal(Object.keys(completed.state).some((key) => key.startsWith("workflow.commandProviderCompleted.")), false)
})

test("workflow run recovery does not reuse a cache for different inputs", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const workflow = sampleWorkflow()
  const runStore = new FileRunStateStore({ workspaceRoot, now: () => "2026-06-30T00:00:00.000Z", engineVersion: "test-engine" })

  const interrupted = await runStore.createRun(workflow, { revision: "77" })
  interrupted.status = "running"
  interrupted.currentStep = "analyze"
  interrupted.state.collectResult = "old-context"
  interrupted.steps[0].status = "completed"
  interrupted.steps[1].status = "running"
  await runStore.saveRun(interrupted)

  const actions = new ActionRegistry()
  actions.register({ id: "sample.collect", execute: async (input) => `fresh-context-${input.inputs.revision}` })
  actions.register({ id: "sample.analyze", execute: async (input) => input.state.collectResult })

  const engine = new WorkflowEngine({ actions, resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }), runStore })
  const result = await engine.runWorkflow(workflow, { revision: "88" })

  assert.notEqual(result.runId, interrupted.runId)
  assert.equal(result.status, "completed")
  assert.equal(result.state.collectResult, "fresh-context-88")
  assert.equal(result.state.analyzeResult, "fresh-context-88")
  assert.equal((await runStore.listRuns()).length, 2)
})

test("single-step retry reuses a failed current step with prior workflow state", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const workflow = {
    id: "workflow-register.failed-single-step",
    name: "failed-single-step",
    label: "Failed Single Step",
    schemaVersion: "workflow-register/v1",
    definitionHash: "definition-v1",
    filePath: ".bob/workflows/failed-single-step/WORKFLOW.md",
    inputs: {},
    engineSteps: [
      { id: "collect-context", title: "Collect", type: "command", action: { provider: "sample.collect" }, resultKey: "reviewContext" },
      { id: "load-rules", title: "Rules", type: "command", action: { provider: "sample.rules" }, resultKey: "reviewRules" },
      {
        id: "output-result",
        title: "Output",
        type: "agent",
        includeState: ["reviewContext", "reviewRules"],
        stateRequired: true,
        resultKey: "reviewResultJson",
        result: { source: "agent", sinks: [{ type: "command", command: "bobBazaar.captureReviewResult" }] }
      }
    ]
  }
  let now = "2026-06-30T00:00:00.000Z"
  const runStore = new FileRunStateStore({ workspaceRoot, now: () => now, engineVersion: "test-engine" })
  const failed = await runStore.createRun(workflow, {})
  failed.status = "failed"
  failed.currentStep = "output-result"
  failed.error = "result command reported an error"
  failed.state.reviewContext = "context"
  failed.state.reviewRules = "rules"
  failed.state.reviewResultJson = "markdown checklist output"
  failed.steps[0].status = "completed"
  failed.steps[1].status = "completed"
  failed.steps[2].status = "failed"
  failed.steps[2].error = failed.error
  await runStore.saveRun(failed)

  now = "2026-06-30T00:00:01.000Z"
  const emptyFailed = await runStore.createRun(workflow, {})
  emptyFailed.status = "failed"
  emptyFailed.currentStep = "output-result"
  emptyFailed.error = "empty retry should not be reused"
  emptyFailed.steps[2].status = "failed"
  emptyFailed.steps[2].error = emptyFailed.error
  await runStore.saveRun(emptyFailed)

  let captureContext
  const engine = new WorkflowEngine({
    actions: new ActionRegistry(),
    resultSinks: createDefaultResultSinkRegistry({
      workspaceRoot,
      executeCommand: async (_command, _text, context) => {
        captureContext = context
        return { status: "ok", jsonText: "normalized review-result json" }
      }
    }),
    runStore,
    agentProvider: { run: async () => { throw new Error("agent should not rerun for failed handoff retry") } }
  })

  const retried = await engine.runWorkflow(workflow, {}, { executionMode: "singleStep", stepId: "output-result" })

  assert.equal(retried.runId, failed.runId)
  assert.equal(retried.status, "completed")
  assert.equal(retried.state.reviewContext, "context")
  assert.equal(retried.state.reviewRules, "rules")
  assert.equal(retried.state.reviewResultJson, "normalized review-result json")
  assert.equal(captureContext.state.reviewContext, "context")
  assert.equal((await runStore.listRuns()).length, 2)
})

test("single-step later step without recoverable state fails before running the agent", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  let agentCalls = 0
  const workflow = {
    id: "workflow-register.missing-single-step-state",
    name: "missing-single-step-state",
    label: "Missing Single Step State",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    engineSteps: [
      { id: "collect-context", title: "Collect", type: "command", action: { provider: "sample.collect" }, resultKey: "reviewContext" },
      {
        id: "output-result",
        title: "Output",
        type: "agent",
        includeState: ["reviewContext"],
        stateRequired: true,
        resultKey: "reviewResultJson"
      }
    ]
  }
  const engine = new WorkflowEngine({
    actions: new ActionRegistry(),
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore: new FileRunStateStore({ workspaceRoot, now: () => "2026-06-30T00:00:00.000Z", engineVersion: "test-engine" }),
    agentProvider: { run: async () => { agentCalls += 1; return "unexpected" } }
  })

  const run = await engine.runWorkflow(workflow, {}, { executionMode: "singleStep", stepId: "output-result" })

  assert.equal(run.status, "failed")
  assert.equal(run.currentStep, "output-result")
  assert.equal(run.steps[0].status, "pending")
  assert.equal(run.steps[1].status, "failed")
  assert.match(run.error, /cannot run before previous step 'collect-context' is completed/)
  assert.equal(agentCalls, 0)
})

test("retrying an agent handoff failure can reuse recovered text without rerunning the agent", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const workflow = {
    id: "workflow-register.agent-recovery",
    name: "agent-recovery",
    label: "Agent Recovery",
    description: "Agent recovery workflow.",
    schemaVersion: "workflow-register/v1",
    definitionHash: "definition-v1",
    filePath: ".bob/workflows/agent-recovery/WORKFLOW.md",
    inputs: {},
    engineSteps: [
      {
        id: "analyze",
        title: "Analyze",
        type: "agent",
        prompt: "Analyze",
        resultKey: "analysis",
        result: {
          source: "agent",
          sinks: [{ type: "file", path: ".bob/workflows/runs/{{run.id}}/steps/analyze.txt" }]
        }
      }
    ]
  }
  const runStore = new FileRunStateStore({ workspaceRoot, now: () => "2026-06-30T00:00:00.000Z", engineVersion: "test-engine" })
  const failed = await runStore.createRun(workflow, {})
  failed.status = "failed"
  failed.currentStep = "analyze"
  failed.error = "Result sink failed: capture"
  failed.steps[0].status = "failed"
  failed.steps[0].error = failed.error
  await runStore.saveRun(failed)

  const engine = new WorkflowEngine({
    actions: new ActionRegistry(),
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore,
    agentProvider: { run: async () => { throw new Error("agent should not rerun") } },
    recoverResultText: async ({ run, step }) => run.runId === failed.runId && step.id === "analyze" ? "recovered analysis" : undefined
  })
  const retried = await engine.retryCurrentStep(failed.runId, workflow)
  const output = fs.readFileSync(path.join(workspaceRoot, ".bob", "workflows", "runs", failed.runId, "steps", "analyze.txt"), "utf8")

  assert.equal(retried.status, "completed")
  assert.equal(retried.state.analysis, "recovered analysis")
  assert.equal(output, "recovered analysis")
})

test("retrying a failed agent step reruns the agent instead of recovering stale assistant text", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const workflow = {
    id: "workflow-register.agent-retry-rerun",
    name: "agent-retry-rerun",
    label: "Agent Retry Rerun",
    description: "Agent retry rerun workflow.",
    schemaVersion: "workflow-register/v1",
    definitionHash: "definition-v1",
    filePath: ".bob/workflows/agent-retry-rerun/WORKFLOW.md",
    inputs: {},
    engineSteps: [
      {
        id: "analyze",
        title: "Analyze",
        type: "agent",
        prompt: "Analyze",
        resultKey: "analysis"
      }
    ]
  }
  const runStore = new FileRunStateStore({ workspaceRoot, now: () => "2026-06-30T00:00:00.000Z", engineVersion: "test-engine" })
  const failed = await runStore.createRun(workflow, {})
  failed.status = "failed"
  failed.currentStep = "analyze"
  failed.error = "Agent provider failed"
  failed.steps[0].status = "failed"
  failed.steps[0].error = failed.error
  await runStore.saveRun(failed)

  const recoveryReasons = []
  let agentCalls = 0
  const engine = new WorkflowEngine({
    actions: new ActionRegistry(),
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore,
    agentProvider: {
      run: async () => {
        agentCalls += 1
        return "fresh analysis"
      }
    },
    recoverResultText: async ({ reason }) => {
      recoveryReasons.push(reason)
      return "stale analysis"
    }
  })

  const retried = await engine.retryCurrentStep(failed.runId, workflow)

  assert.equal(retried.status, "completed")
  assert.equal(agentCalls, 1)
  assert.deepEqual(recoveryReasons, [])
  assert.equal(retried.state.analysis, "fresh analysis")
})
