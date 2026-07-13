const assert = require("node:assert/strict")
const fs = require("node:fs")
const Module = require("node:module")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const vscodeState = {
  executedCommands: [],
  executeCommand: async () => undefined,
  informationMessages: [],
  workspaceFolders: []
}

const vscode = {
  commands: {
    executeCommand: async (...args) => {
      vscodeState.executedCommands.push(args)
      return vscodeState.executeCommand(...args)
    }
  },
  window: {
    showErrorMessage: async () => undefined,
    showInformationMessage: async (...args) => {
      vscodeState.informationMessages.push(args)
      return undefined
    },
    showQuickPick: async (items) => items[0],
    showTextDocument: async () => undefined,
    showWarningMessage: async () => undefined
  },
  workspace: {
    get isTrusted() { return true },
    get workspaceFolders() { return vscodeState.workspaceFolders },
    openTextDocument: async () => ({})
  }
}

function loadWithVscode(modulePaths) {
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "vscode") return vscode
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    return modulePaths.map((modulePath) => {
      const resolved = require.resolve(modulePath)
      delete require.cache[resolved]
      return require(resolved)
    })
  } finally {
    Module._load = originalLoad
  }
}

const [runnerModule, commandModule, runControlModule, stepReviewModule] = loadWithVscode([
  "../out/bobWorkflowRunner.js",
  "../out/workflowRunCommands.js",
  "../out/commands/runControl.js",
  "../out/commands/stepReview.js"
])

const { BobWorkflowEngineRunner, StepRuntime, createBobWorkflow } = runnerModule
const { WorkflowRunCommandService } = commandModule
const { resumePausedRun } = runControlModule
const { acceptAndRunNextStep, acceptCurrentStep } = stepReviewModule
const { BobWorkflowGateRegistry } = require("../out/bobWorkflowGateRegistry")
const { ReviewAcceptanceCoordinator } = require("../out/reviewAcceptanceCoordinator")
const { ActionRegistry } = require("../out/core/actionRegistry")
const { FileRunControlStore } = require("../out/core/runControlStore")
const { FileRunStateStore } = require("../out/core/runStateStore")
const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
const { WorkflowEngine } = require("../out/core/engine")
const { reviewTaskRegistry } = require("../out/reviewTaskRegistry")
const { readOperationHubRunSnapshot } = require("../out/operationHubMutationTarget")

function tempRoot(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function aliasedTempRoot(t, prefix) {
  const base = tempRoot(t, prefix)
  const physicalRoot = path.join(base, "physical")
  const aliasRoot = path.join(base, "alias")
  fs.mkdirSync(physicalRoot)
  try {
    fs.symlinkSync(physicalRoot, aliasRoot, process.platform === "win32" ? "junction" : "dir")
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP", "UNKNOWN"].includes(error.code)) {
      t.skip(`directory alias unavailable: ${error.code}`)
      return undefined
    }
    throw error
  }
  return { aliasRoot, physicalRoot: fs.realpathSync(physicalRoot) }
}

function commandStep(id, provider = `sample.${id}`) {
  return {
    id,
    title: id,
    type: "command",
    action: { provider },
    resultKey: `${id}Result`
  }
}

function coreWorkflow(root, id, steps, overrides = {}) {
  return {
    id: `workflow-register.${id}`,
    name: id,
    label: id,
    description: `${id} lifecycle test`,
    schemaVersion: "workflow-register/v1",
    workflowRoot: root,
    inputs: {},
    guardrails: {},
    stepReview: {
      enabled: false,
      pauseAfter: "none",
      requireAcceptBeforeNext: false,
      allowRetry: true,
      allowEditBeforeRetry: true,
      preserveAttempts: true
    },
    stepExecution: { mode: "engineSteps", allowOutOfOrder: false, showInBob: true },
    engineSteps: steps,
    ...overrides
  }
}

function bobDefinition(workflow) {
  return {
    id: workflow.id,
    name: workflow.name,
    label: workflow.label,
    menuLabel: workflow.label,
    description: workflow.description,
    prompt: "",
    promptWithoutTodo: "",
    commandArgs: [],
    mode: "agent",
    permissions: [],
    autoApprovalEnabled: true,
    workspaceRequired: false,
    hidden: false,
    todoEnabled: true,
    todoRequired: false,
    todoSource: "",
    todoAsSteps: true,
    stepCompletion: "auto",
    stepMessage: "none",
    stepExecution: workflow.stepExecution,
    stepsById: Object.fromEntries(workflow.engineSteps.map((step) => [step.id, {
      id: step.id,
      prompt: "",
      commandArgs: [],
      sendResult: false,
      required: true,
      completeOnSuccess: true,
      runAgent: false,
      includeState: [],
      maxResultBytes: 1024,
      stateRequired: false,
      captureResult: false,
      resultCommandArgs: []
    }])),
    todos: workflow.engineSteps.map((step) => ({ id: step.id, text: step.title, raw: `${step.id}: ${step.title}` })),
    inputs: {},
    guardrails: workflow.guardrails ?? {},
    workflowRoot: workflow.workflowRoot,
    file: { fsPath: path.join(workflow.workflowRoot, "WORKFLOW.md") },
    core: workflow
  }
}

function createRunner(t, workflow, registerActions) {
  const actions = new ActionRegistry()
  registerActions(actions)
  const runStore = new FileRunStateStore({ workspaceRoot: workflow.workflowRoot, engineVersion: "gate-test" })
  const gateRegistry = new BobWorkflowGateRegistry()
  const stepRuntime = new StepRuntime()
  const runner = new BobWorkflowEngineRunner({
    definition: bobDefinition(workflow),
    coreWorkflow: workflow,
    actionRegistry: actions,
    resultSinks: () => createDefaultResultSinkRegistry({
      workspaceRoot: workflow.workflowRoot,
      executeCommand: async () => undefined
    }),
    runStore: () => runStore,
    taskSnapshotStore: () => undefined,
    preflightChecks: () => ({ bazaarRepository: async () => true }),
    stepRuntime,
    inputsProvider: async () => ({}),
    gateRegistry
  })
  return { actions, gateRegistry, runStore, runner, stepRuntime }
}

async function waitForRunStatus(runStore, status, timeoutMs = 10_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt <= timeoutMs) {
    const run = (await runStore.listRuns()).find((candidate) => candidate.status === status)
    if (run) return run
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Bob workflow did not reach ${status} within ${timeoutMs}ms.`)
}

async function waitFor(predicate, timeoutMs = 5_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt <= timeoutMs) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms.`)
}

function trackSettlement(promise) {
  const state = { settled: false, resolutions: 0, rejections: 0 }
  void promise.then(
    () => {
      state.settled = true
      state.resolutions += 1
    },
    () => {
      state.settled = true
      state.rejections += 1
    }
  )
  return state
}

async function abortExecution(registry, root, runId, execution) {
  if (typeof registry.abortPending === "function") {
    registry.abortPending(root, runId, "test cleanup")
  }
  await Promise.race([
    execution.catch(() => false),
    new Promise((resolve) => setTimeout(resolve, 250))
  ])
}

async function acceptLiveReview(root, runId, gateRegistry, silent = true) {
  const previousFolders = vscodeState.workspaceFolders
  vscodeState.workspaceFolders = [{ name: path.basename(root), uri: { fsPath: root } }]
  try {
    return await acceptCurrentStep({
      showMarkdownReport: async () => undefined,
      acceptBobWorkflowGate: (workspaceRoot, acceptedRunId, stepId) => (
        gateRegistry.accept(workspaceRoot, acceptedRunId, stepId)
      ),
      acceptBobWorkflowGateWithMetadata: (workspaceRoot, acceptedRunId, stepId) => (
        gateRegistry.acceptWithMetadata(workspaceRoot, acceptedRunId, stepId)
      ),
      coordinateReviewAcceptance: async (_workspaceRoot, _acceptedRunId, operation) => operation()
    }, runId, { silent })
  } finally {
    vscodeState.workspaceFolders = previousFolders
  }
}

async function acceptLiveReviewAndRunNext(root, runId, gateRegistry, runNextStep) {
  const previousFolders = vscodeState.workspaceFolders
  const previousExecuteCommand = vscodeState.executeCommand
  const snapshot = await readOperationHubRunSnapshot(root, runId)
  const target = {
    source: "operationHub",
    workspaceRoot: root,
    runId,
    expectedRevision: snapshot.revision
  }
  vscodeState.workspaceFolders = [{ name: path.basename(root), uri: { fsPath: root } }]
  vscodeState.executeCommand = async (command, commandTarget) => {
    if (command === "workflowRegister.runNextStep") return runNextStep(commandTarget)
    return undefined
  }
  try {
    return await acceptAndRunNextStep({
      showMarkdownReport: async () => undefined,
      acceptBobWorkflowGate: (workspaceRoot, acceptedRunId, stepId) => (
        gateRegistry.accept(workspaceRoot, acceptedRunId, stepId)
      ),
      acceptBobWorkflowGateWithMetadata: (workspaceRoot, acceptedRunId, stepId) => (
        gateRegistry.acceptWithMetadata(workspaceRoot, acceptedRunId, stepId)
      ),
      coordinateReviewAcceptance: async (_workspaceRoot, _acceptedRunId, operation) => operation()
    }, target)
  } finally {
    vscodeState.workspaceFolders = previousFolders
    vscodeState.executeCommand = previousExecuteCommand
  }
}

function realCommandService(root, workflow, actions, runStore, gateRegistry) {
  const engine = new WorkflowEngine({
    actions,
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot: root, executeCommand: async () => undefined }),
    runStore
  })
  return createCommandService(root, workflow, engine, gateRegistry, runStore).service
}

test("Bob runner remains pending when the engine returns held", async (t) => {
  const root = tempRoot(t, "workflow-register-bob-held-")
  const step = commandStep("collect")
  const workflow = coreWorkflow(root, "bob-held", [step], {
    guardrails: {
      requireApproval: [{ id: "approve-collect", when: "provider == 'sample.collect'" }]
    }
  })
  const { gateRegistry, runStore, runner } = createRunner(t, workflow, (actions) => {
    actions.register({ id: "sample.collect", execute: async () => "context" })
  })
  const execution = runner.runEngineStep("collect", 0, {
    sendMessage: async () => undefined,
    setStepComplete: () => undefined
  })
  const settlement = trackSettlement(execution)
  const held = await waitForRunStatus(runStore, "held")

  try {
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(settlement.settled, false)
    assert.deepEqual(gateRegistry.pendingForRun(root, held.runId), {
      workspaceRoot: root,
      runId: held.runId,
      stepId: "collect",
      ownerStepId: "collect",
      status: "held",
      executionMode: "singleStep"
    })
    const rejected = assert.rejects(execution, /terminal held abort/)
    assert.equal(gateRegistry.abortPending(root, held.runId, "terminal held abort"), true)
    await rejected
  } finally {
    await abortExecution(gateRegistry, root, held.runId, execution)
  }
})

test("Bob runner remains pending at a branch checkpoint", async (t) => {
  const root = tempRoot(t, "workflow-register-bob-checkpoint-")
  const step = {
    ...commandStep("loop"),
    transition: {
      decisions: [{ id: "retry", when: { stateKey: "loopResult", equals: "retry" }, goto: "loop", loop: "retry-loop" }],
      default: "next"
    }
  }
  const workflow = coreWorkflow(root, "bob-checkpoint", [step], {
    branching: {
      enabled: true,
      loops: [{ id: "retry-loop", entryStep: "loop", maxIterations: 0, extensionSize: 1 }]
    }
  })
  const { gateRegistry, runStore, runner } = createRunner(t, workflow, (actions) => {
    actions.register({ id: "sample.loop", execute: async () => "retry" })
  })
  const execution = runner.runEngineStep("loop", 0, {
    sendMessage: async () => undefined,
    setStepComplete: () => undefined
  })
  const settlement = trackSettlement(execution)
  const checkpointed = await waitForRunStatus(runStore, "checkpoint")

  try {
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(settlement.settled, false)
    assert.equal(gateRegistry.pendingForRun(root, checkpointed.runId).status, "checkpoint")
  } finally {
    await abortExecution(gateRegistry, root, checkpointed.runId, execution)
  }
})

test("Bob runner keeps the completed owner step pending when a pause points at the next step", async (t) => {
  const root = tempRoot(t, "workflow-register-bob-paused-")
  const first = commandStep("first")
  const second = commandStep("second")
  const workflow = coreWorkflow(root, "bob-paused", [first, second])
  const controlStore = new FileRunControlStore({ workspaceRoot: root })
  const { gateRegistry, runStore, runner } = createRunner(t, workflow, (actions) => {
    actions.register({
      id: "sample.first",
      execute: async ({ runId }) => {
        await controlStore.requestPause({ runId, requestedBy: "test" })
        return "first"
      }
    })
    actions.register({ id: "sample.second", execute: async () => "second" })
  })
  const execution = runner.runEngineStep("first", 0, {
    sendMessage: async () => undefined,
    setStepComplete: () => undefined
  })
  const settlement = trackSettlement(execution)
  const paused = await waitForRunStatus(runStore, "paused")

  try {
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(settlement.settled, false)
    assert.equal(paused.steps[0].status, "completed")
    assert.equal(paused.currentStep, "second")
    assert.deepEqual(gateRegistry.pendingForRun(root, paused.runId), {
      workspaceRoot: root,
      runId: paused.runId,
      stepId: "second",
      ownerStepId: "first",
      status: "paused",
      executionMode: "singleStep"
    })
  } finally {
    await abortExecution(gateRegistry, root, paused.runId, execution)
  }
})

test("StepRuntime manual hold remains the only pending primitive for a manual Bob step", async (t) => {
  const root = tempRoot(t, "workflow-register-bob-manual-")
  const step = { id: "manual", title: "manual", type: "manual" }
  const workflow = coreWorkflow(root, "bob-manual", [step])
  const { gateRegistry, runner, stepRuntime } = createRunner(t, workflow, () => undefined)
  let completed = 0
  const execution = runner.runEngineStep("manual", 0, {
    sendMessage: async () => undefined,
    setStepComplete: () => { completed += 1 }
  })
  await waitFor(() => stepRuntime.list().length === 1)
  const active = stepRuntime.list()[0]

  assert.equal(gateRegistry.isPending(root, active.runId, "manual"), false)
  assert.match(await stepRuntime.completeStepByKey(active.key), /Completed:/)
  assert.equal(await execution, true)
  assert.equal(completed, 1)
})

test("full fallback manual completion keeps its wrapper Todo pending until later providers finish", async (t) => {
  const root = tempRoot(t, "workflow-register-bob-full-manual-")
  const workflow = coreWorkflow(root, "bob-full-manual", [
    { id: "manual", title: "manual", type: "manual" },
    commandStep("followup")
  ], {
    stepExecution: { mode: "engineSteps", allowOutOfOrder: false, showInBob: false }
  })
  let followupEntered
  const followupStarted = new Promise((resolve) => { followupEntered = resolve })
  let releaseFollowup
  const followupReleased = new Promise((resolve) => { releaseFollowup = resolve })
  let followupCalls = 0
  const { runner, stepRuntime } = createRunner(t, workflow, (actions) => {
    actions.register({
      id: "sample.followup",
      execute: async () => {
        followupCalls += 1
        followupEntered()
        await followupReleased
        return "followup"
      }
    })
  })
  const [fallbackStep] = createBobWorkflow(bobDefinition(workflow), runner).getSteps()
  let wrapperTodoCompletions = 0
  const execution = fallbackStep.execution({
    sendMessage: async () => undefined,
    setStepComplete: () => { wrapperTodoCompletions += 1 }
  })
  const settlement = trackSettlement(execution)

  try {
    await waitFor(() => stepRuntime.list().length === 1)
    const active = stepRuntime.list()[0]
    assert.match(await stepRuntime.completeStepByKey(active.key), /Completed:/)
    await followupStarted

    assert.equal(wrapperTodoCompletions, 0, "an internal manual step must not complete the full wrapper Todo")
    assert.equal(settlement.settled, false)
    assert.equal(followupCalls, 1)

    releaseFollowup()
    assert.equal(await execution, true)
    assert.equal(wrapperTodoCompletions, 0)
  } finally {
    releaseFollowup()
    await execution.catch(() => undefined)
  }
})

test("full fallback after-step pause releases its completed owner before the wrapper continues", async (t) => {
  const root = tempRoot(t, "workflow-register-bob-full-pause-")
  const workflow = coreWorkflow(root, "bob-full-pause", [commandStep("source"), commandStep("target")], {
    stepExecution: { mode: "engineSteps", allowOutOfOrder: false, showInBob: false }
  })
  const controlStore = new FileRunControlStore({ workspaceRoot: root })
  let targetEntered
  const targetStarted = new Promise((resolve) => { targetEntered = resolve })
  let releaseTarget
  const targetReleased = new Promise((resolve) => { releaseTarget = resolve })
  let targetCalls = 0
  const { actions, gateRegistry, runStore, runner } = createRunner(t, workflow, (actions) => {
    actions.register({
      id: "sample.source",
      execute: async ({ runId }) => {
        await controlStore.requestPause({ runId, requestedBy: "test" })
        return "source"
      }
    })
    actions.register({
      id: "sample.target",
      execute: async () => {
        targetCalls += 1
        targetEntered()
        await targetReleased
        return "target"
      }
    })
  })
  const commandService = realCommandService(root, workflow, actions, runStore, gateRegistry)
  const [fallbackStep] = createBobWorkflow(bobDefinition(workflow), runner).getSteps()
  let wrapperTodoCompletions = 0
  const execution = fallbackStep.execution({
    sendMessage: async () => undefined,
    setStepComplete: () => { wrapperTodoCompletions += 1 }
  })
  const executionSettlement = trackSettlement(execution)
  const paused = await waitForRunStatus(runStore, "paused")
  let resumeExecution

  try {
    assert.deepEqual(gateRegistry.pendingForRun(root, paused.runId), {
      workspaceRoot: root,
      runId: paused.runId,
      stepId: "target",
      ownerStepId: "source",
      status: "paused",
      executionMode: "full"
    })

    resumeExecution = commandService.resumeRun(paused.runId)
    const resumeSettlement = trackSettlement(resumeExecution)
    await targetStarted
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(resumeSettlement.settled, true, "Resume must release the full wrapper instead of executing target itself")
    assert.equal(executionSettlement.settled, false)
    assert.equal(wrapperTodoCompletions, 0)
    assert.equal(targetCalls, 1)

    const resumed = await resumeExecution
    assert.equal(resumed.status, "running")
    releaseTarget()
    assert.equal(await execution, true)
    assert.equal(targetCalls, 1)
  } finally {
    releaseTarget()
    gateRegistry.abortPending(root, paused.runId, "test cleanup")
    await Promise.allSettled([execution, resumeExecution].filter(Boolean))
  }
})

test("full Bob wrapper owns continuation after structured accept-and-next and executes the next step once", async (t) => {
  const root = tempRoot(t, "workflow-register-bob-fallback-review-")
  fs.mkdirSync(path.join(root, ".bob"), { recursive: true })
  const workflow = coreWorkflow(root, "bob-fallback-review", [commandStep("first"), commandStep("second")], {
    stepReview: {
      enabled: true,
      pauseAfter: "everyStep",
      requireAcceptBeforeNext: true,
      allowRetry: true,
      allowEditBeforeRetry: true,
      preserveAttempts: true
    },
    stepExecution: { mode: "engineSteps", allowOutOfOrder: false, showInBob: false }
  })
  const commandCalls = []
  const { actions, gateRegistry, runStore, runner } = createRunner(t, workflow, (actions) => {
    actions.register({ id: "sample.first", execute: async () => { commandCalls.push("first"); return "first" } })
    actions.register({ id: "sample.second", execute: async () => { commandCalls.push("second"); return "second" } })
  })
  const commandService = realCommandService(root, workflow, actions, runStore, gateRegistry)
  let runNextStepCalls = 0
  const [fallbackStep] = createBobWorkflow(bobDefinition(workflow), runner).getSteps()
  assert.equal(fallbackStep.id, "runWorkflow")

  const execution = fallbackStep.execution({
    sendMessage: async () => undefined,
    setStepComplete: () => undefined
  })
  const settlement = trackSettlement(execution)
  const firstReview = await waitForRunStatus(runStore, "reviewing")

  try {
    assert.equal(firstReview.currentStep, "first")
    assert.deepEqual(commandCalls, ["first"])
    assert.equal(settlement.settled, false)

    await acceptLiveReviewAndRunNext(root, firstReview.runId, gateRegistry, async (target) => {
      runNextStepCalls += 1
      return commandService.runNextStep(target)
    })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(settlement.settled, false, "the single Bob step must not complete while the same run still has work")

    const secondReview = await waitForRunStatus(runStore, "reviewing")
    assert.equal(secondReview.runId, firstReview.runId)
    assert.equal(secondReview.currentStep, "second")
    assert.equal(runNextStepCalls, 0)
    assert.deepEqual(commandCalls, ["first", "second"])
    assert.deepEqual(gateRegistry.pendingForRun(root, firstReview.runId), {
      workspaceRoot: root,
      runId: firstReview.runId,
      stepId: "second",
      ownerStepId: "second",
      status: "reviewing",
      executionMode: "full"
    })

    await acceptLiveReview(root, firstReview.runId, gateRegistry)
    assert.equal(await execution, true)

    const completed = await runStore.loadRun(firstReview.runId)
    assert.equal(completed.status, "completed")
    assert.equal(completed.currentStep, undefined)
    assert.deepEqual(completed.steps.map((step) => step.status), ["completed", "completed"])
    assert.deepEqual(commandCalls, ["first", "second"])
    assert.deepEqual((await runStore.listRuns()).map((run) => run.runId), [firstReview.runId])
    assert.deepEqual(settlement, { settled: true, resolutions: 1, rejections: 0 })
  } finally {
    await abortExecution(gateRegistry, root, firstReview.runId, execution)
  }
})

test("full Bob wrapper shares physical root identity with Operation Hub through a workspace alias", async (t) => {
  const roots = aliasedTempRoot(t, "workflow-register-bob-root-alias-")
  if (!roots) return
  const { aliasRoot, physicalRoot } = roots
  fs.mkdirSync(path.join(physicalRoot, ".bob"), { recursive: true })
  const workflow = coreWorkflow(aliasRoot, "bob-root-alias", [commandStep("first"), commandStep("second")], {
    stepReview: {
      enabled: true,
      pauseAfter: "everyStep",
      requireAcceptBeforeNext: true,
      allowRetry: true,
      allowEditBeforeRetry: true,
      preserveAttempts: true
    },
    stepExecution: { mode: "engineSteps", allowOutOfOrder: false, showInBob: false }
  })
  const commandCalls = []
  const { gateRegistry, runStore, runner } = createRunner(t, workflow, (actions) => {
    actions.register({ id: "sample.first", execute: async () => { commandCalls.push("first"); return "first" } })
    actions.register({ id: "sample.second", execute: async () => { commandCalls.push("second"); return "second" } })
  })
  let runNextStepCalls = 0
  const [fallbackStep] = createBobWorkflow(bobDefinition(workflow), runner).getSteps()
  const task = {
    sendMessage: async () => undefined,
    setStepComplete: () => undefined
  }
  const execution = fallbackStep.execution(task)
  const firstReview = await waitForRunStatus(runStore, "reviewing")

  try {
    await acceptLiveReviewAndRunNext(aliasRoot, firstReview.runId, gateRegistry, async () => {
      runNextStepCalls += 1
      return undefined
    })

    assert.equal(runNextStepCalls, 0)
    assert.equal(reviewTaskRegistry.taskForStep(physicalRoot, firstReview.runId, "first"), task)
    assert.equal(gateRegistry.isPending(physicalRoot, firstReview.runId, "first"), false)

    const secondReview = await waitForRunStatus(runStore, "reviewing")
    assert.equal(secondReview.currentStep, "second")
    assert.deepEqual(commandCalls, ["first", "second"])
    assert.deepEqual(gateRegistry.pendingForRun(physicalRoot, firstReview.runId), {
      workspaceRoot: physicalRoot,
      runId: firstReview.runId,
      stepId: "second",
      ownerStepId: "second",
      status: "reviewing",
      executionMode: "full"
    })

    await acceptLiveReviewAndRunNext(aliasRoot, firstReview.runId, gateRegistry, async () => {
      runNextStepCalls += 1
      return undefined
    })
    assert.equal(await execution, true)
    assert.equal(runNextStepCalls, 0)
    assert.equal(gateRegistry.pendingForRun(physicalRoot, firstReview.runId), undefined)
  } finally {
    gateRegistry.abortPending(aliasRoot, firstReview.runId, "test cleanup")
    gateRegistry.abortPending(physicalRoot, firstReview.runId, "test cleanup")
    await Promise.race([
      execution.catch(() => false),
      new Promise((resolve) => setTimeout(resolve, 250))
    ])
  }
})

test("single-step Bob execution keeps structured accept-and-next dispatch and executes the next provider once", async (t) => {
  const root = tempRoot(t, "workflow-register-bob-single-step-review-")
  fs.mkdirSync(path.join(root, ".bob"), { recursive: true })
  const workflow = coreWorkflow(root, "bob-single-step-review", [commandStep("first"), commandStep("second")], {
    stepReview: {
      enabled: true,
      pauseAfter: "everyStep",
      requireAcceptBeforeNext: true,
      allowRetry: true,
      allowEditBeforeRetry: true,
      preserveAttempts: true
    }
  })
  const commandCalls = []
  const { actions, gateRegistry, runStore, runner } = createRunner(t, workflow, (actions) => {
    actions.register({ id: "sample.first", execute: async () => { commandCalls.push("first"); return "first" } })
    actions.register({ id: "sample.second", execute: async () => { commandCalls.push("second"); return "second" } })
  })
  const commandService = realCommandService(root, workflow, actions, runStore, gateRegistry)
  let runNextStepCalls = 0
  const execution = runner.runEngineStep("first", 0, {
    sendMessage: async () => undefined,
    setStepComplete: () => undefined
  })
  const firstReview = await waitForRunStatus(runStore, "reviewing")

  try {
    await acceptLiveReviewAndRunNext(root, firstReview.runId, gateRegistry, async (target) => {
      runNextStepCalls += 1
      return commandService.runNextStep(target)
    })

    assert.equal(await execution, true)
    assert.equal(runNextStepCalls, 1)
    assert.deepEqual(commandCalls, ["first", "second"])
  } finally {
    await abortExecution(gateRegistry, root, firstReview.runId, execution)
  }
})

test("full fallback wrapper does not project internal transition completion into its single Bob Todo", async (t) => {
  const root = tempRoot(t, "workflow-register-bob-full-transition-")
  fs.mkdirSync(path.join(root, ".bob"), { recursive: true })
  const first = {
    ...commandStep("first"),
    transition: { decisions: [], default: "second" }
  }
  const workflow = coreWorkflow(root, "bob-full-transition", [first, commandStep("second")], {
    stepReview: {
      enabled: true,
      pauseAfter: "everyStep",
      requireAcceptBeforeNext: true,
      allowRetry: true,
      allowEditBeforeRetry: true,
      preserveAttempts: true
    },
    stepExecution: { mode: "engineSteps", allowOutOfOrder: false, showInBob: false }
  })
  const commandCalls = []
  const { gateRegistry, runStore, runner } = createRunner(t, workflow, (actions) => {
    actions.register({ id: "sample.first", execute: async () => { commandCalls.push("first"); return "first" } })
    actions.register({ id: "sample.second", execute: async () => { commandCalls.push("second"); return "second" } })
  })
  const [fallbackStep] = createBobWorkflow(bobDefinition(workflow), runner).getSteps()
  let setStepCompleteCalls = 0
  const execution = fallbackStep.execution({
    sendMessage: async () => undefined,
    setStepComplete: () => { setStepCompleteCalls += 1 }
  })
  const settlement = trackSettlement(execution)
  const firstReview = await waitForRunStatus(runStore, "reviewing")

  try {
    vscodeState.informationMessages = []
    await acceptLiveReview(root, firstReview.runId, gateRegistry, false)
    const secondReview = await waitForRunStatus(runStore, "reviewing")

    assert.equal(secondReview.runId, firstReview.runId)
    assert.equal(secondReview.currentStep, "second")
    assert.equal(settlement.settled, false)
    assert.equal(setStepCompleteCalls, 0)
    assert.deepEqual(commandCalls, ["first", "second"])
    assert.equal(vscodeState.informationMessages.length, 1)
    assert.equal(vscodeState.informationMessages[0].length, 1)
    assert.match(vscodeState.informationMessages[0][0], /Bob ワークフローが同じ run を続行します。/)

    await acceptLiveReview(root, firstReview.runId, gateRegistry)
    assert.equal(await execution, true)
    assert.equal(setStepCompleteCalls, 0)
  } finally {
    await abortExecution(gateRegistry, root, firstReview.runId, execution)
  }
})

test("single-step explicit transition still projects one completed Bob Todo and stops at the target", async (t) => {
  const root = tempRoot(t, "workflow-register-bob-single-transition-")
  const first = {
    ...commandStep("first"),
    transition: { decisions: [], default: "second" }
  }
  const workflow = coreWorkflow(root, "bob-single-transition", [first, commandStep("second")])
  const commandCalls = []
  const { runStore, runner } = createRunner(t, workflow, (actions) => {
    actions.register({ id: "sample.first", execute: async () => { commandCalls.push("first"); return "first" } })
    actions.register({ id: "sample.second", execute: async () => { commandCalls.push("second"); return "second" } })
  })
  let setStepCompleteCalls = 0

  assert.equal(await runner.runEngineStep("first", 0, {
    sendMessage: async () => undefined,
    setStepComplete: () => { setStepCompleteCalls += 1 }
  }), true)

  const [run] = await runStore.listRuns()
  assert.equal(run.status, "running")
  assert.equal(run.currentStep, "second")
  assert.deepEqual(run.steps.map((step) => step.status), ["completed", "pending"])
  assert.equal(setStepCompleteCalls, 1)
  assert.deepEqual(commandCalls, ["first"])
})

function markerRoot(root) {
  return {
    root,
    name: path.basename(root),
    marker: ".bob",
    depth: "direct",
    workspaceFolderName: path.basename(root),
    workspaceFolderRoot: root
  }
}

function createCommandService(root, workflow, engine, gateRegistry = new BobWorkflowGateRegistry(), providedRunStore) {
  const runStore = providedRunStore ?? new FileRunStateStore({ workspaceRoot: root, engineVersion: "gate-command-test" })
  const coordinator = new ReviewAcceptanceCoordinator()
  const runtimeFactory = {
    createRunStore: () => runStore,
    createEngine: () => engine
  }
  const service = new WorkflowRunCommandService({
    coreWorkflows: new Map([[workflow.id, workflow]]),
    runtimeFactory,
    ensureWorkflowsLoaded: async () => undefined,
    workflowRootCandidates: async () => [markerRoot(root)],
    activeSteps: () => [],
    showManualStepPanel: async () => undefined,
    gateRegistry,
    coordinateGateDecision: (workspaceRoot, runId, kind, operation) => coordinator.coordinate(workspaceRoot, runId, kind, operation)
  })
  return { gateRegistry, runStore, service }
}

async function saveRunWithStatus(runStore, workflow, status, currentStep, stepStatuses) {
  const run = await runStore.createRun(workflow, {})
  run.status = status
  run.currentStep = currentStep
  for (const [stepId, stepStatus] of Object.entries(stepStatuses)) {
    const step = run.steps.find((candidate) => candidate.id === stepId)
    step.status = stepStatus
  }
  await runStore.saveRun(run)
  return run
}

test("run-next command fails fast when its command step awaits a same-run retry and releases later mutations", async (t) => {
  const root = tempRoot(t, "workflow-register-run-next-reentrant-")
  const workflow = coreWorkflow(root, "run-next-reentrant", [commandStep("source")])
  const runStore = new FileRunStateStore({ workspaceRoot: root, engineVersion: "run-next-reentrant-test" })
  const actions = new ActionRegistry()
  let service
  let runId
  let actionCalls = 0
  actions.register({
    id: "sample.source",
    execute: async () => {
      actionCalls += 1
      if (actionCalls === 1) return service.retryCurrentStep(runId)
      return "retry-completed"
    }
  })
  const engine = new WorkflowEngine({
    actions,
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot: root, executeCommand: async () => undefined }),
    runStore
  })
  const context = createCommandService(root, workflow, engine, new BobWorkflowGateRegistry(), runStore)
  service = context.service
  const run = await saveRunWithStatus(runStore, workflow, "running", "source", { source: "pending" })
  runId = run.runId

  let timeout
  const boundedRunNext = Promise.race([
    service.runNextStep(runId),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("timed-out-self-wait")), 1000)
    })
  ])
  let failed
  try {
    failed = await boundedRunNext
  } finally {
    clearTimeout(timeout)
  }

  assert.equal(failed.status, "failed")
  assert.match(failed.error, /re-enter|reentrant|same run/i)
  assert.equal(actionCalls, 1)

  const recovered = await service.retryCurrentStep(runId)
  assert.equal(recovered.status, "completed")
  assert.equal(actionCalls, 2)
})

async function saveCheckpointedRun(runStore, workflow, checkpointId) {
  const run = await saveRunWithStatus(runStore, workflow, "checkpoint", "target", {
    source: "completed",
    target: "pending"
  })
  run.branching = {
    loops: {
      loop: {
        loopId: "loop",
        count: 1,
        allowed: 1,
        maxIterations: 1,
        extensionSize: 1,
        checkpointCount: 1
      }
    },
    history: [],
    checkpoint: {
      id: checkpointId,
      loopId: "loop",
      fromStepId: "source",
      toStepId: "target",
      decisionId: "retry",
      count: 1,
      allowed: 1,
      extensionSize: 1,
      message: checkpointId,
      createdAt: new Date().toISOString()
    }
  }
  await runStore.saveRun(run)
  return run
}

function createCheckpointEngine(root, runStore) {
  return new WorkflowEngine({
    actions: new ActionRegistry(),
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot: root, executeCommand: async () => undefined }),
    runStore
  })
}

test("duplicate retry commands rebind one live Promise and resolve it only after durable completion", async (t) => {
  const root = tempRoot(t, "workflow-register-gate-retry-")
  const workflow = coreWorkflow(root, "gate-retry", [commandStep("source"), commandStep("target")])
  let retryCalls = 0
  let releaseFirst
  const firstReleased = new Promise((resolve) => { releaseFirst = resolve })
  let phase = "gate"
  let runStore
  const retryOptions = []
  const engine = {
    retryCurrentStep: async (runId, _workflow, options) => {
      retryCalls += 1
      retryOptions.push(options)
      if (phase === "gate") await firstReleased
      const run = await runStore.loadRun(runId)
      if (phase === "gate") {
        run.steps[0].status = "completed"
        run.steps[1].status = "held"
        run.status = "held"
        run.currentStep = "target"
      } else {
        run.steps[1].status = "completed"
        run.status = "completed"
        run.currentStep = undefined
      }
      await runStore.saveRun(run)
      return run
    }
  }
  const context = createCommandService(root, workflow, engine)
  runStore = context.runStore
  const run = await saveRunWithStatus(runStore, workflow, "reviewing", "source", { source: "reviewing", target: "pending" })
  const gate = context.gateRegistry.waitForDecision({
    workspaceRoot: root,
    runId: run.runId,
    stepId: "source",
    ownerStepId: "source",
    status: "reviewing"
  })
  const settlement = trackSettlement(gate)

  const first = context.service.retryCurrentStep(run.runId)
  const duplicate = context.service.retryCurrentStep(run.runId)
  try {
    await waitFor(() => retryCalls > 0)
    assert.equal(retryCalls, 1)
    releaseFirst()
    const [firstResult, duplicateResult] = await Promise.all([first, duplicate])
    assert.equal(firstResult.status, "held")
    assert.equal(duplicateResult.status, "held")
    assert.equal(retryOptions[0].executionMode, "singleStep")
    assert.equal(settlement.settled, false)
    assert.deepEqual(context.gateRegistry.pendingForRun(root, run.runId), {
      workspaceRoot: root,
      runId: run.runId,
      stepId: "target",
      ownerStepId: "source",
      status: "held"
    })

    phase = "complete"
    await context.service.retryCurrentStep(run.runId)
    assert.equal(await gate, true)
    assert.deepEqual(settlement, { settled: true, resolutions: 1, rejections: 0 })
    assert.equal(retryCalls, 2)
  } finally {
    releaseFirst()
    await Promise.allSettled([first, duplicate])
    if (typeof context.gateRegistry.abortPending === "function") {
      context.gateRegistry.abortPending(root, run.runId, "test cleanup")
    } else {
      context.gateRegistry.abort(root, run.runId, "source", "test cleanup")
      context.gateRegistry.abort(root, run.runId, "target", "test cleanup")
    }
    await gate.catch(() => undefined)
  }
})

test("live held resume executes only the Bob-visible owner step", async (t) => {
  const root = tempRoot(t, "workflow-register-gate-held-resume-")
  const workflow = coreWorkflow(root, "gate-held-resume", [commandStep("source"), commandStep("target")], {
    guardrails: {
      requireApproval: [{ id: "approve-source", when: "provider == 'sample.source'" }]
    }
  })
  const actions = new ActionRegistry()
  let sourceCalls = 0
  let targetCalls = 0
  actions.register({ id: "sample.source", execute: async () => { sourceCalls += 1; return "source" } })
  actions.register({ id: "sample.target", execute: async () => { targetCalls += 1; return "target" } })
  const runStore = new FileRunStateStore({ workspaceRoot: root, engineVersion: "gate-held-resume-test" })
  const createEngine = () => new WorkflowEngine({
    actions,
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot: root, executeCommand: async () => undefined }),
    runStore
  })
  const held = await createEngine().runWorkflow(workflow, {})
  assert.equal(held.status, "held")
  const gateRegistry = new BobWorkflowGateRegistry()
  const gate = gateRegistry.waitForDecision({
    workspaceRoot: root,
    runId: held.runId,
    stepId: "source",
    ownerStepId: "source",
    status: "held"
  })
  const coordinator = new ReviewAcceptanceCoordinator()
  const service = new WorkflowRunCommandService({
    coreWorkflows: new Map([[workflow.id, workflow]]),
    runtimeFactory: { createRunStore: () => runStore, createEngine },
    ensureWorkflowsLoaded: async () => undefined,
    workflowRootCandidates: async () => [markerRoot(root)],
    activeSteps: () => [],
    showManualStepPanel: async () => undefined,
    gateRegistry,
    coordinateGateDecision: (workspaceRoot, runId, kind, operation) => coordinator.coordinate(workspaceRoot, runId, kind, operation)
  })

  const result = await service.resumeRun(held.runId)

  assert.equal(result.status, "running")
  assert.equal(result.steps[0].status, "completed")
  assert.equal(result.steps[1].status, "pending")
  assert.equal(sourceCalls, 1)
  assert.equal(targetCalls, 0)
  assert.equal(await gate, true)
})

test("checkpoint approval is single-flight, durable before accept, and leaves next-step execution to Bob", async (t) => {
  const root = tempRoot(t, "workflow-register-gate-checkpoint-approve-")
  const workflow = coreWorkflow(root, "gate-checkpoint-approve", [commandStep("source"), commandStep("target")])
  let approveCalls = 0
  let resumeCalls = 0
  let releaseApprove
  const approveReleased = new Promise((resolve) => { releaseApprove = resolve })
  let runStore
  const engine = {
    approveBranchCheckpoint: async (runId) => {
      approveCalls += 1
      await approveReleased
      const run = await runStore.loadRun(runId)
      run.status = "running"
      run.currentStep = "target"
      delete run.branching.checkpoint
      await runStore.saveRun(run)
      return run
    },
    resumeRun: async () => {
      resumeCalls += 1
      throw new Error("checkpoint approval must not resume the target step")
    }
  }
  const context = createCommandService(root, workflow, engine)
  runStore = context.runStore
  const run = await saveRunWithStatus(runStore, workflow, "checkpoint", "target", { source: "completed", target: "pending" })
  run.branching = {
    loops: { loop: { loopId: "loop", count: 1, allowed: 1, maxIterations: 1, extensionSize: 1, checkpointCount: 1 } },
    history: [],
    checkpoint: { id: "checkpoint", loopId: "loop", fromStepId: "source", toStepId: "target", decisionId: "retry", count: 1, allowed: 1, extensionSize: 1, message: "approve", createdAt: new Date().toISOString() }
  }
  await runStore.saveRun(run)
  const gate = context.gateRegistry.waitForDecision({ workspaceRoot: root, runId: run.runId, stepId: "target", ownerStepId: "source", status: "checkpoint" })
  const durableStatus = gate.then(
    async () => (await runStore.loadRun(run.runId)).status,
    () => "aborted"
  )

  const first = context.service.approveBranchCheckpoint(run.runId)
  const duplicate = context.service.approveBranchCheckpoint(run.runId)
  try {
    await waitFor(() => approveCalls > 0)
    assert.equal(approveCalls, 1)
    releaseApprove()
    const results = await Promise.all([first, duplicate])

    assert.equal(results[0].status, "running")
    assert.equal(results[1].status, "running")
    assert.equal(await durableStatus, "running")
    assert.equal(resumeCalls, 0)
    assert.equal(context.gateRegistry.pendingForRun(root, run.runId), undefined)
  } finally {
    releaseApprove()
    await Promise.allSettled([first, duplicate])
    if (typeof context.gateRegistry.abortPending === "function") {
      context.gateRegistry.abortPending(root, run.runId, "test cleanup")
    } else {
      context.gateRegistry.abort(root, run.runId, "source", "test cleanup")
    }
    await gate.catch(() => undefined)
  }
})

test("checkpoint abort durably fails the run before rejecting the live gate with a stable error", async (t) => {
  const root = tempRoot(t, "workflow-register-gate-checkpoint-abort-")
  const workflow = coreWorkflow(root, "gate-checkpoint-abort", [commandStep("source"), commandStep("target")])
  let runStore
  let abortCalls = 0
  let receivedReason
  let markAbortStarted
  const abortStarted = new Promise((resolve) => { markAbortStarted = resolve })
  let releaseAbort
  const abortReleased = new Promise((resolve) => { releaseAbort = resolve })
  const engine = {
    abortBranchCheckpoint: async (runId, reason) => {
      abortCalls += 1
      receivedReason = reason
      markAbortStarted()
      await abortReleased
      const run = await runStore.loadRun(runId)
      run.status = "failed"
      run.error = reason
      await runStore.saveRun(run)
      return run
    }
  }
  const context = createCommandService(root, workflow, engine)
  runStore = context.runStore
  const run = await saveRunWithStatus(runStore, workflow, "checkpoint", "target", { source: "completed", target: "pending" })
  const gate = context.gateRegistry.waitForDecision({ workspaceRoot: root, runId: run.runId, stepId: "target", ownerStepId: "source", status: "checkpoint" })
  const rejected = assert.rejects(gate, /Bob workflow run aborted at branch checkpoint\./)

  try {
    const first = context.service.abortBranchCheckpoint(run.runId)
    const duplicate = context.service.abortBranchCheckpoint(run.runId)
    await abortStarted
    assert.equal(abortCalls, 1)
    releaseAbort()
    const [result, duplicateResult] = await Promise.all([first, duplicate])

    assert.equal(receivedReason, "Bob workflow run aborted at branch checkpoint.")
    await rejected
    assert.equal(result.status, "failed")
    assert.equal(duplicateResult.status, "failed")
    assert.equal((await runStore.loadRun(run.runId)).error, receivedReason)
    assert.equal(context.gateRegistry.pendingForRun(root, run.runId), undefined)
  } finally {
    releaseAbort()
    if (typeof context.gateRegistry.abortPending === "function") {
      context.gateRegistry.abortPending(root, run.runId, "Bob workflow run aborted at branch checkpoint.")
    } else {
      context.gateRegistry.abort(root, run.runId, "source", "Bob workflow run aborted at branch checkpoint.")
    }
    await rejected
  }
})

test("sequential checkpoint approval reuses one durable decision and rejects a later abort", async (t) => {
  const root = tempRoot(t, "workflow-register-gate-checkpoint-sequential-approve-")
  const workflow = coreWorkflow(root, "gate-checkpoint-sequential-approve", [commandStep("source"), commandStep("target")])
  const runStore = new FileRunStateStore({ workspaceRoot: root, engineVersion: "checkpoint-decision-test" })
  const engine = createCheckpointEngine(root, runStore)
  const context = createCommandService(root, workflow, engine, new BobWorkflowGateRegistry(), runStore)
  const run = await saveCheckpointedRun(runStore, workflow, "checkpoint-sequential-approve")
  const gate = context.gateRegistry.waitForDecision({
    workspaceRoot: root,
    runId: run.runId,
    stepId: "target",
    ownerStepId: "source",
    status: "checkpoint"
  })

  const first = await context.service.approveBranchCheckpoint(run.runId)
  assert.equal(await gate, true)
  const firstPersisted = await runStore.loadRun(run.runId)
  const firstLoop = { ...firstPersisted.branching.loops.loop }

  const duplicate = await context.service.approveBranchCheckpoint(run.runId)
  const duplicatePersisted = await runStore.loadRun(run.runId)

  assert.equal(first.status, "running")
  assert.equal(duplicate.status, "running")
  assert.deepEqual(duplicatePersisted.branching.loops.loop, firstLoop)
  assert.equal(Array.isArray(duplicatePersisted.branching.checkpointDecisions), true)
  assert.equal(duplicatePersisted.branching.checkpointDecisions.length, 1)
  assert.deepEqual(duplicatePersisted.branching.checkpointDecisions[0], firstPersisted.branching.checkpointDecisions[0])
  assert.deepEqual(duplicatePersisted.branching.checkpointDecisions[0], {
    checkpointId: "checkpoint-sequential-approve",
    outcome: "approved",
    loopId: "loop",
    ownerStepId: "source",
    targetStepId: "target",
    transitionDecisionId: "retry",
    decidedAt: duplicatePersisted.branching.checkpointDecisions[0].decidedAt
  })
  assert.match(duplicatePersisted.branching.checkpointDecisions[0].decidedAt, /^\d{4}-\d{2}-\d{2}T/)
  await assert.rejects(
    context.service.abortBranchCheckpoint(run.runId),
    /already approved|conflicting checkpoint decision/i
  )
})

test("sequential checkpoint abort reuses one durable decision and rejects a later approval", async (t) => {
  const root = tempRoot(t, "workflow-register-gate-checkpoint-sequential-abort-")
  const workflow = coreWorkflow(root, "gate-checkpoint-sequential-abort", [commandStep("source"), commandStep("target")])
  const runStore = new FileRunStateStore({ workspaceRoot: root, engineVersion: "checkpoint-decision-test" })
  const engine = createCheckpointEngine(root, runStore)
  const context = createCommandService(root, workflow, engine, new BobWorkflowGateRegistry(), runStore)
  const run = await saveCheckpointedRun(runStore, workflow, "checkpoint-sequential-abort")
  const gate = context.gateRegistry.waitForDecision({
    workspaceRoot: root,
    runId: run.runId,
    stepId: "target",
    ownerStepId: "source",
    status: "checkpoint"
  })
  const gateRejected = assert.rejects(gate, /Bob workflow run aborted at branch checkpoint\./)

  const first = await context.service.abortBranchCheckpoint(run.runId)
  await gateRejected
  const firstPersisted = await runStore.loadRun(run.runId)
  const firstLoop = { ...firstPersisted.branching.loops.loop }

  const duplicate = await context.service.abortBranchCheckpoint(run.runId)
  const duplicatePersisted = await runStore.loadRun(run.runId)

  assert.equal(first.status, "failed")
  assert.equal(duplicate.status, "failed")
  assert.deepEqual(duplicatePersisted.branching.loops.loop, firstLoop)
  assert.equal(Array.isArray(duplicatePersisted.branching.checkpointDecisions), true)
  assert.equal(duplicatePersisted.branching.checkpointDecisions.length, 1)
  assert.deepEqual(duplicatePersisted.branching.checkpointDecisions[0], firstPersisted.branching.checkpointDecisions[0])
  assert.deepEqual(duplicatePersisted.branching.checkpointDecisions[0], {
    checkpointId: "checkpoint-sequential-abort",
    outcome: "aborted",
    loopId: "loop",
    ownerStepId: "source",
    targetStepId: "target",
    transitionDecisionId: "retry",
    decidedAt: duplicatePersisted.branching.checkpointDecisions[0].decidedAt,
    reason: "Bob workflow run aborted at branch checkpoint."
  })
  assert.match(duplicatePersisted.branching.checkpointDecisions[0].decidedAt, /^\d{4}-\d{2}-\d{2}T/)
  await assert.rejects(
    context.service.approveBranchCheckpoint(run.runId),
    /already aborted|conflicting checkpoint decision/i
  )
})

test("concurrent checkpoint approval then abort waits for persistence and rejects the abort", async (t) => {
  const root = tempRoot(t, "workflow-register-gate-checkpoint-race-approve-")
  const workflow = coreWorkflow(root, "gate-checkpoint-race-approve", [commandStep("source"), commandStep("target")])
  const runStore = new FileRunStateStore({ workspaceRoot: root, engineVersion: "checkpoint-race-test" })
  const realEngine = createCheckpointEngine(root, runStore)
  let approveCalls = 0
  let abortCalls = 0
  let markApproveStarted
  const approveStarted = new Promise((resolve) => { markApproveStarted = resolve })
  let releaseApprove
  const approveReleased = new Promise((resolve) => { releaseApprove = resolve })
  const engine = {
    approveBranchCheckpoint: async (...args) => {
      approveCalls += 1
      markApproveStarted()
      await approveReleased
      return realEngine.approveBranchCheckpoint(...args)
    },
    abortBranchCheckpoint: async (...args) => {
      abortCalls += 1
      return realEngine.abortBranchCheckpoint(...args)
    }
  }
  const context = createCommandService(root, workflow, engine, new BobWorkflowGateRegistry(), runStore)
  const run = await saveCheckpointedRun(runStore, workflow, "checkpoint-race-approve")
  const gate = context.gateRegistry.waitForDecision({
    workspaceRoot: root,
    runId: run.runId,
    stepId: "target",
    ownerStepId: "source",
    status: "checkpoint"
  })

  const winner = context.service.approveBranchCheckpoint(run.runId)
  await approveStarted
  const loser = context.service.abortBranchCheckpoint(run.runId)
  const loserConflict = assert.rejects(loser, /already approved|conflicting checkpoint decision/i)

  try {
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(abortCalls, 0)
    releaseApprove()
    const approved = await winner
    await loserConflict
    assert.equal(approved.status, "running")
    assert.equal(await gate, true)
    assert.equal(approveCalls, 1)
    assert.equal(abortCalls, 1)
    const persisted = await runStore.loadRun(run.runId)
    assert.equal(persisted.branching.checkpointDecisions.length, 1)
    assert.equal(persisted.branching.checkpointDecisions[0].outcome, "approved")
  } finally {
    releaseApprove()
    await Promise.allSettled([winner, loser, loserConflict])
    context.gateRegistry.abortPending(root, run.runId, "test cleanup")
    await gate.catch(() => undefined)
  }
})

test("concurrent checkpoint abort then approval waits for persistence and rejects the approval", async (t) => {
  const root = tempRoot(t, "workflow-register-gate-checkpoint-race-abort-")
  const workflow = coreWorkflow(root, "gate-checkpoint-race-abort", [commandStep("source"), commandStep("target")])
  const runStore = new FileRunStateStore({ workspaceRoot: root, engineVersion: "checkpoint-race-test" })
  const realEngine = createCheckpointEngine(root, runStore)
  let approveCalls = 0
  let abortCalls = 0
  let markAbortStarted
  const abortStarted = new Promise((resolve) => { markAbortStarted = resolve })
  let releaseAbort
  const abortReleased = new Promise((resolve) => { releaseAbort = resolve })
  const engine = {
    approveBranchCheckpoint: async (...args) => {
      approveCalls += 1
      return realEngine.approveBranchCheckpoint(...args)
    },
    abortBranchCheckpoint: async (...args) => {
      abortCalls += 1
      markAbortStarted()
      await abortReleased
      return realEngine.abortBranchCheckpoint(...args)
    }
  }
  const context = createCommandService(root, workflow, engine, new BobWorkflowGateRegistry(), runStore)
  const run = await saveCheckpointedRun(runStore, workflow, "checkpoint-race-abort")
  const gate = context.gateRegistry.waitForDecision({
    workspaceRoot: root,
    runId: run.runId,
    stepId: "target",
    ownerStepId: "source",
    status: "checkpoint"
  })
  const gateRejected = assert.rejects(gate, /Bob workflow run aborted at branch checkpoint\./)

  const winner = context.service.abortBranchCheckpoint(run.runId)
  await abortStarted
  const loser = context.service.approveBranchCheckpoint(run.runId)
  const loserConflict = assert.rejects(loser, /already aborted|conflicting checkpoint decision/i)

  try {
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(approveCalls, 0)
    releaseAbort()
    const aborted = await winner
    await gateRejected
    await loserConflict
    assert.equal(aborted.status, "failed")
    assert.equal(abortCalls, 1)
    assert.equal(approveCalls, 1)
    const persisted = await runStore.loadRun(run.runId)
    assert.equal(persisted.branching.checkpointDecisions.length, 1)
    assert.equal(persisted.branching.checkpointDecisions[0].outcome, "aborted")
  } finally {
    releaseAbort()
    await Promise.allSettled([winner, loser, loserConflict, gateRejected])
    context.gateRegistry.abortPending(root, run.runId, "Bob workflow run aborted at branch checkpoint.")
    await gate.catch(() => undefined)
  }
})

test("live pause resume releases a completed owner without running the next step", async (t) => {
  const root = tempRoot(t, "workflow-register-gate-pause-live-")
  const workflow = coreWorkflow(root, "gate-pause-live", [commandStep("source"), commandStep("target")])
  let resumeCalls = 0
  let runStore
  const engine = {
    resumeRun: async (runId) => {
      resumeCalls += 1
      const run = await runStore.loadRun(runId)
      run.status = "completed"
      run.currentStep = undefined
      run.steps[1].status = "completed"
      await runStore.saveRun(run)
      return run
    }
  }
  const context = createCommandService(root, workflow, engine)
  runStore = context.runStore
  const run = await saveRunWithStatus(context.runStore, workflow, "paused", "target", { source: "completed", target: "pending" })
  const controlStore = new FileRunControlStore({ workspaceRoot: root })
  await controlStore.requestPause({ runId: run.runId, requestedBy: "test" })
  const gate = context.gateRegistry.waitForDecision({ workspaceRoot: root, runId: run.runId, stepId: "target", ownerStepId: "source", status: "paused" })

  try {
    const result = await context.service.resumeRun(run.runId)

    assert.equal(resumeCalls, 0)
    assert.equal(result.status, "running")
    assert.equal(result.currentStep, "target")
    assert.equal(await gate, true)
    assert.equal(await controlStore.isPauseRequested(run.runId), false)
  } finally {
    if (typeof context.gateRegistry.abortPending === "function") {
      context.gateRegistry.abortPending(root, run.runId, "test cleanup")
    } else {
      context.gateRegistry.abort(root, run.runId, "source", "test cleanup")
    }
    await gate.catch(() => undefined)
  }
})

test("pause resume keeps the standalone engine path when there is no live Bob gate", async (t) => {
  const root = tempRoot(t, "workflow-register-gate-pause-standalone-")
  const workflow = coreWorkflow(root, "gate-pause-standalone", [commandStep("source")])
  let resumeCalls = 0
  let runStore
  const resumeOptions = []
  const engine = {
    resumeRun: async (runId, options) => {
      resumeCalls += 1
      resumeOptions.push(options)
      const run = await runStore.loadRun(runId)
      run.status = "completed"
      run.currentStep = undefined
      run.steps[0].status = "completed"
      await runStore.saveRun(run)
      return run
    }
  }
  const context = createCommandService(root, workflow, engine)
  runStore = context.runStore
  const run = await saveRunWithStatus(runStore, workflow, "paused", "source", { source: "pending" })
  reviewTaskRegistry.registerTask(root, run.runId, "source", { setStepComplete: () => undefined })

  const result = await context.service.resumeRun(run.runId)

  assert.equal(result.status, "completed")
  assert.equal(resumeCalls, 1)
  assert.equal(resumeOptions[0].executionMode, undefined)
})

test("resumePausedRun delegates before clearing pause state so the service owns the decision", async (t) => {
  const root = tempRoot(t, "workflow-register-run-control-pause-")
  fs.mkdirSync(path.join(root, ".bob"), { recursive: true })
  const workflow = coreWorkflow(root, "run-control-pause", [commandStep("source")])
  const runStore = new FileRunStateStore({ workspaceRoot: root })
  const run = await saveRunWithStatus(runStore, workflow, "paused", "source", { source: "pending" })
  const controlStore = new FileRunControlStore({ workspaceRoot: root })
  await controlStore.requestPause({ runId: run.runId, requestedBy: "test" })
  vscodeState.workspaceFolders = [{ name: "workspace", uri: { fsPath: root } }]
  let delegatedControl
  vscodeState.executeCommand = async (command, runId) => {
    assert.equal(command, "workflowRegister.resumeRun")
    assert.equal(runId, run.runId)
    delegatedControl = await controlStore.loadControl(runId)
    return "delegated"
  }

  try {
    assert.equal(await resumePausedRun({ showMarkdownReport: async () => undefined }, run.runId), "delegated")
    assert.ok(delegatedControl.pauseRequestedAt)
    assert.equal(delegatedControl.clearedAt, undefined)
  } finally {
    vscodeState.executeCommand = async () => undefined
    vscodeState.workspaceFolders = []
  }
})

test("disposing the service-owned registry rejects held, checkpoint, and paused gates", async () => {
  const registry = new BobWorkflowGateRegistry()
  const gates = ["held", "checkpoint", "paused"].map((status) => registry.waitForDecision({
    workspaceRoot: "C:\\workspace",
    runId: `run-${status}`,
    stepId: status,
    ownerStepId: status,
    status
  }))
  const rejected = gates.map((gate) => assert.rejects(gate, /disposed/i))

  registry.dispose()

  await Promise.all(rejected)
  for (const status of ["held", "checkpoint", "paused"]) {
    assert.equal(registry.pendingForRun("C:\\workspace", `run-${status}`), undefined)
  }
})

test("task snapshot import fails fast while the run is executing and preserves the owner state", async (t) => {
  const { coordinateWorkflowRunExecution } = require("../out/core/engine/runExecutionCoordinator")
  const { FileTaskSnapshotStore } = require("../out/core/taskSnapshots")
  const root = tempRoot(t, "workflow-register-import-coordination-")
  const workflow = coreWorkflow(root, "import-coordination", [{
    id: "draft",
    title: "Draft",
    type: "agent",
    prompt: "Draft",
    resultKey: "draft"
  }], {
    definitionHash: "definition-v1",
    artifacts: [{
      id: "draft",
      producedBy: "draft",
      path: ".bob/workflows/runs/{{run.id}}/artifacts/draft.md"
    }]
  })
  const delegate = new FileRunStateStore({ workspaceRoot: root, engineVersion: "import-coordination-test" })
  const run = await delegate.createRun(workflow, {})
  await delegate.saveRun(run)
  await new FileTaskSnapshotStore({ workspaceRoot: root }).saveSnapshot({
    schemaVersion: "workflow-register/task-snapshot/v1",
    createdAt: "2026-07-12T00:00:00.000Z",
    reason: "agent-output",
    runId: run.runId,
    workflowId: workflow.id,
    workflowDefinitionHash: workflow.definitionHash,
    stepId: "draft",
    lastAssistantText: "recovered draft"
  })

  const deferred = () => {
    let resolve
    const promise = new Promise((done) => { resolve = done })
    return { promise, resolve }
  }
  const staleCaptured = deferred()
  const ownerMaySave = deferred()
  const ownerSaved = deferred()
  const ownerMayFinish = deferred()
  const gateKinds = []
  const runStore = {
    workspaceRoot: root,
    createRun: (...args) => delegate.createRun(...args),
    loadRun: (...args) => delegate.loadRun(...args),
    saveRun: (...args) => delegate.saveRun(...args),
    findRecoverableRun: (...args) => delegate.findRecoverableRun(...args),
    listRuns: async () => {
      const stale = await delegate.listRuns()
      staleCaptured.resolve()
      await ownerSaved.promise
      return stale
    }
  }
  const owner = coordinateWorkflowRunExecution(runStore, run.runId, "test-owner", async () => {
    await ownerMaySave.promise
    const current = await delegate.loadRun(run.runId)
    current.status = "completed"
    current.currentStep = undefined
    current.steps[0].status = "completed"
    current.state.engineWinner = "preserved"
    await delegate.saveRun(current)
    ownerSaved.resolve()
    await ownerMayFinish.promise
  })
  const service = new WorkflowRunCommandService({
    coreWorkflows: new Map([[workflow.id, workflow]]),
    runtimeFactory: { createRunStore: () => runStore, createEngine: () => ({}) },
    ensureWorkflowsLoaded: async () => undefined,
    workflowRootCandidates: async () => [markerRoot(root)],
    activeSteps: () => [],
    showManualStepPanel: async () => undefined,
    gateRegistry: new BobWorkflowGateRegistry(),
    coordinateGateDecision: async (_workspaceRoot, _runId, kind, operation) => {
      gateKinds.push(kind)
      return operation()
    }
  })

  const importing = service.importArtifactsFromTaskSnapshots(run.runId)
  try {
    await staleCaptured.promise
    ownerMaySave.resolve()
    await ownerSaved.promise
    await assert.rejects(importing, /while workflow run is executing/)
    ownerMayFinish.resolve()
    await owner

    const persisted = await delegate.loadRun(run.runId)
    assert.deepEqual(gateKinds, [], "a running engine must be rejected before entering a nested mutation queue")
    assert.equal(persisted.status, "completed")
    assert.equal(persisted.currentStep, undefined)
    assert.equal(persisted.steps[0].status, "completed")
    assert.equal(persisted.state.engineWinner, "preserved")
    assert.equal(persisted.state.draft, undefined)
  } finally {
    ownerMaySave.resolve()
    ownerSaved.resolve()
    ownerMayFinish.resolve()
    await Promise.allSettled([owner, importing])
  }
})
