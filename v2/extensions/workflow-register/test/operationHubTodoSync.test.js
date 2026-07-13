const assert = require("node:assert/strict")
const fs = require("node:fs")
const Module = require("node:module")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")
const { readSrc } = require("./helpers/sourceReader")

function loadStepReview(workspaceRoot) {
  const modulePath = require.resolve("../out/commands/stepReview.js")
  delete require.cache[modulePath]
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "vscode") {
      return {
        commands: { executeCommand: async () => undefined },
        Uri: { file: (fsPath) => ({ fsPath }) },
        window: {
          showInformationMessage: async () => undefined,
          showQuickPick: async () => undefined,
          showWarningMessage: async () => undefined
        },
        workspace: {
          workspaceFolders: [{ name: "workspace", uri: { fsPath: workspaceRoot } }]
        }
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    return require(modulePath)
  } finally {
    Module._load = originalLoad
  }
}

function reviewingWorkflow() {
  return {
    id: "workflow-register.concurrent-review",
    name: "concurrent-review",
    label: "Concurrent Review",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    engineSteps: [{ id: "review", title: "Review", type: "command" }]
  }
}

function synchronizeConcurrentReviewSelections(t, FileRunStateStore) {
  const originalListRuns = FileRunStateStore.prototype.listRuns
  let listed = 0
  let releaseLists
  const listsReady = new Promise((resolve) => { releaseLists = resolve })

  FileRunStateStore.prototype.listRuns = async function synchronizedListRuns() {
    const runs = await originalListRuns.call(this)
    listed += 1
    if (listed === 2) releaseLists()
    await listsReady
    return runs
  }
  t.after(() => {
    FileRunStateStore.prototype.listRuns = originalListRuns
  })
}

function createTestReviewAcceptanceCoordinator(onCoordinate = () => undefined) {
  let inFlight
  return (workspaceRoot, runId, operation) => {
    onCoordinate({ workspaceRoot, runId, joined: Boolean(inFlight) })
    if (inFlight) return inFlight
    const owner = Promise.resolve().then(operation)
    let coordinated
    coordinated = owner.finally(() => {
      if (inFlight === coordinated) inFlight = undefined
    })
    inFlight = coordinated
    return coordinated
  }
}

test("Operation Hub accept-and-run-next leaves continuation to a live full Bob wrapper only", () => {
  const source = readSrc("commands", "stepReview.ts")

  assert.match(source, /export async function acceptAndRunNextStep/)
  assert.match(source, /if \(accepted\.continuationOwnedByBob\) return accepted\.run/)
  assert.match(source, /return vscode\.commands\.executeCommand\("workflowRegister\.runNextStep", operationHubTargetForAcceptedStep\(accepted\)\)/)
  assert.match(source, /workspaceRoot: accepted\.workspaceRoot[\s\S]*expectedRevision: accepted\.revision/)
  assert.doesNotMatch(source, /if \(accepted\.completedViaBobTask\) \{?\s*return accepted\.run/)
})

test("review acceptance skips Todo completion for a live gate and awaits only the stale-gate fallback", () => {
  const source = readSrc("commands", "stepReview.ts")

  assert.match(source, /let completedViaBobTask = acceptedViaLiveGate/)
  assert.match(source, /if \(gateDecision === "missing" \|\| gateDecision === "aborted"\) \{[\s\S]*const sync = await bobTaskSyncRegistry\.reconcileRun/)
  assert.match(source, /completedViaBobTask = sync\.status === "synced" && sync\.appliedStepCount > 0/)
  assert.doesNotMatch(source, /completedViaBobTask = sync\.status === "synced" && sync\.taskAvailable/)
})

test("concurrent review acceptance never falls back after the live gate was already settled", async (t) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-register-double-accept-"))
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }))
  fs.mkdirSync(path.join(workspaceRoot, ".bob"), { recursive: true })
  const { BobWorkflowGateRegistry } = require("../out/bobWorkflowGateRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")
  const { reviewTaskRegistry } = require("../out/reviewTaskRegistry")
  const runStore = new FileRunStateStore({ workspaceRoot })
  const run = await runStore.createRun(reviewingWorkflow(), {})
  run.status = "reviewing"
  run.currentStep = "review"
  run.steps[0].status = "reviewing"
  await runStore.saveRun(run)

  let setStepCompleteCalls = 0
  reviewTaskRegistry.registerTask(workspaceRoot, run.runId, "review", {
    setStepComplete: () => { setStepCompleteCalls += 1 }
  })
  const gateRegistry = new BobWorkflowGateRegistry()
  const gate = gateRegistry.waitForDecision({ workspaceRoot, runId: run.runId, stepId: "review", status: "reviewing" })

  synchronizeConcurrentReviewSelections(t, FileRunStateStore)

  const decisions = []
  const options = {
    showMarkdownReport: async () => undefined,
    coordinateReviewAcceptance: createTestReviewAcceptanceCoordinator(),
    acceptBobWorkflowGate: (root, runId, stepId) => {
      const decision = gateRegistry.accept(root, runId, stepId)
      decisions.push(decision)
      return decision
    }
  }
  const { acceptCurrentStep } = loadStepReview(workspaceRoot)

  const results = await Promise.all([
    acceptCurrentStep(options, run.runId, { silent: true }),
    acceptCurrentStep(options, run.runId, { silent: true })
  ])

  assert.equal(await gate, true)
  assert.equal(setStepCompleteCalls, 0)
  assert.deepEqual(decisions, ["accepted"])
  assert.equal(results[0], results[1])

  const reopened = await runStore.loadRun(run.runId)
  reopened.status = "reviewing"
  reopened.currentStep = "review"
  reopened.steps[0].status = "reviewing"
  await runStore.saveRun(reopened)
  const freshGate = gateRegistry.waitForDecision({ workspaceRoot, runId: run.runId, stepId: "review", status: "reviewing" })

  await acceptCurrentStep(options, run.runId, { silent: true })

  assert.equal(await freshGate, true)
  assert.equal(setStepCompleteCalls, 0)
  assert.deepEqual(decisions, ["accepted", "accepted"])
})

test("concurrent review acceptance after an aborted live gate shares exactly one legacy reconciliation", async (t) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-register-aborted-accept-"))
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }))
  fs.mkdirSync(path.join(workspaceRoot, ".bob"), { recursive: true })
  const { BobWorkflowGateRegistry } = require("../out/bobWorkflowGateRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")
  const { reviewTaskRegistry } = require("../out/reviewTaskRegistry")
  const runStore = new FileRunStateStore({ workspaceRoot })
  const workflow = reviewingWorkflow()
  workflow.id = "workflow-register.aborted-review"
  workflow.name = "aborted-review"
  const run = await runStore.createRun(workflow, {})
  run.status = "reviewing"
  run.currentStep = "review"
  run.steps[0].status = "reviewing"
  await runStore.saveRun(run)

  let setStepCompleteCalls = 0
  let setStepCompleteFinished = false
  reviewTaskRegistry.registerTask(workspaceRoot, run.runId, "review", {
    setStepComplete: async () => {
      setStepCompleteCalls += 1
      await new Promise((resolve) => setImmediate(resolve))
      setStepCompleteFinished = true
    }
  })
  const gateRegistry = new BobWorkflowGateRegistry()
  const gate = gateRegistry.waitForDecision({ workspaceRoot, runId: run.runId, stepId: "review", status: "reviewing" })
  const rejected = assert.rejects(gate, /terminal review failure/)
  assert.equal(gateRegistry.abort(workspaceRoot, run.runId, "review", "terminal review failure"), true)
  await rejected

  synchronizeConcurrentReviewSelections(t, FileRunStateStore)

  const decisions = []
  const { acceptCurrentStep } = loadStepReview(workspaceRoot)
  const options = {
    showMarkdownReport: async () => undefined,
    coordinateReviewAcceptance: createTestReviewAcceptanceCoordinator(),
    acceptBobWorkflowGate: (root, runId, stepId) => {
      const decision = gateRegistry.accept(root, runId, stepId)
      decisions.push(decision)
      return decision
    }
  }
  const results = await Promise.all([
    acceptCurrentStep(options, run.runId, { silent: true }),
    acceptCurrentStep(options, run.runId, { silent: true })
  ])

  assert.equal(setStepCompleteCalls, 1)
  assert.equal(setStepCompleteFinished, true)
  assert.deepEqual(decisions, ["aborted"])
  assert.equal(results[0], results[1])
  assert.equal(gateRegistry.isPending(workspaceRoot, run.runId, "review"), false)
})

test("concurrent review acceptance without a live gate shares exactly one legacy reconciliation", async (t) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-register-missing-accept-"))
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }))
  fs.mkdirSync(path.join(workspaceRoot, ".bob"), { recursive: true })
  const { FileRunStateStore } = require("../out/core/runStateStore")
  const { reviewTaskRegistry } = require("../out/reviewTaskRegistry")
  const runStore = new FileRunStateStore({ workspaceRoot })
  const workflow = reviewingWorkflow()
  workflow.id = "workflow-register.missing-review"
  workflow.name = "missing-review"
  const run = await runStore.createRun(workflow, {})
  run.status = "reviewing"
  run.currentStep = "review"
  run.steps[0].status = "reviewing"
  await runStore.saveRun(run)

  let setStepCompleteCalls = 0
  let setStepCompleteFinished = false
  reviewTaskRegistry.registerTask(workspaceRoot, run.runId, "review", {
    setStepComplete: async () => {
      setStepCompleteCalls += 1
      await new Promise((resolve) => setImmediate(resolve))
      setStepCompleteFinished = true
    }
  })
  synchronizeConcurrentReviewSelections(t, FileRunStateStore)

  const decisions = []
  const { acceptCurrentStep } = loadStepReview(workspaceRoot)
  const options = {
    showMarkdownReport: async () => undefined,
    coordinateReviewAcceptance: createTestReviewAcceptanceCoordinator(),
    acceptBobWorkflowGate: () => {
      decisions.push("missing")
      return "missing"
    }
  }
  const results = await Promise.all([
    acceptCurrentStep(options, run.runId, { silent: true }),
    acceptCurrentStep(options, run.runId, { silent: true })
  ])

  assert.equal(setStepCompleteCalls, 1)
  assert.equal(setStepCompleteFinished, true)
  assert.deepEqual(decisions, ["missing"])
  assert.equal(results[0], results[1])
})

test("review acceptance without a live gate reconciles only the matching workspace task", async (t) => {
  const rootA = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-register-root-local-a-"))
  const rootB = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-register-root-local-b-"))
  t.after(() => fs.rmSync(rootA, { recursive: true, force: true }))
  t.after(() => fs.rmSync(rootB, { recursive: true, force: true }))
  fs.mkdirSync(path.join(rootA, ".bob"), { recursive: true })
  fs.mkdirSync(path.join(rootB, ".bob"), { recursive: true })
  const { FileRunStateStore } = require("../out/core/runStateStore")
  const { reviewTaskRegistry } = require("../out/reviewTaskRegistry")
  const workflow = reviewingWorkflow()
  workflow.id = "workflow-register.root-local-review"
  workflow.name = "root-local-review"
  const runStoreA = new FileRunStateStore({ workspaceRoot: rootA })
  const runStoreB = new FileRunStateStore({ workspaceRoot: rootB })
  const run = await runStoreA.createRun(workflow, {})
  run.status = "reviewing"
  run.currentStep = "review"
  run.steps[0].status = "reviewing"
  await runStoreA.saveRun(run)
  await runStoreB.saveRun(JSON.parse(JSON.stringify(run)))

  let completionsA = 0
  let completionsB = 0
  assert.equal(reviewTaskRegistry.registerTask(rootA, run.runId, "review", {
    setStepComplete: () => { completionsA += 1 }
  }), true)
  assert.equal(reviewTaskRegistry.registerTask(rootB, run.runId, "review", {
    setStepComplete: () => { completionsB += 1 }
  }), true)

  const { acceptCurrentStep } = loadStepReview(rootA)
  const accepted = await acceptCurrentStep({
    showMarkdownReport: async () => undefined,
    coordinateReviewAcceptance: createTestReviewAcceptanceCoordinator(),
    acceptBobWorkflowGate: () => "missing"
  }, run.runId, { silent: true })

  assert.notEqual(typeof accepted, "string")
  assert.equal(accepted.status, "completed")
  assert.equal(completionsA, 1)
  assert.equal(completionsB, 0)
  assert.equal((await runStoreB.loadRun(run.runId)).status, "reviewing")
})

test("failed single-flight review acceptance is removed so a later retry can proceed", async (t) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-register-accept-retry-"))
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }))
  fs.mkdirSync(path.join(workspaceRoot, ".bob"), { recursive: true })
  const { FileRunStateStore } = require("../out/core/runStateStore")
  const runStore = new FileRunStateStore({ workspaceRoot })
  const workflow = reviewingWorkflow()
  workflow.id = "workflow-register.accept-retry"
  workflow.name = "accept-retry"
  const run = await runStore.createRun(workflow, {})
  run.status = "reviewing"
  run.currentStep = "review"
  run.steps[0].status = "reviewing"
  await runStore.saveRun(run)

  synchronizeConcurrentReviewSelections(t, FileRunStateStore)
  const originalSaveRun = FileRunStateStore.prototype.saveRun
  let acceptedSaveCalls = 0
  FileRunStateStore.prototype.saveRun = async function failFirstAcceptedSave(candidate) {
    if (candidate.runId === run.runId && candidate.steps[0]?.status === "completed") {
      acceptedSaveCalls += 1
      if (acceptedSaveCalls === 1) throw new Error("accepted save failed")
    }
    return originalSaveRun.call(this, candidate)
  }
  t.after(() => { FileRunStateStore.prototype.saveRun = originalSaveRun })

  const { acceptCurrentStep } = loadStepReview(workspaceRoot)
  const options = {
    showMarkdownReport: async () => undefined,
    coordinateReviewAcceptance: createTestReviewAcceptanceCoordinator(),
    acceptBobWorkflowGate: () => "missing"
  }
  const failed = await Promise.allSettled([
    acceptCurrentStep(options, run.runId, { silent: true }),
    acceptCurrentStep(options, run.runId, { silent: true })
  ])

  assert.deepEqual(failed.map((result) => result.status), ["rejected", "rejected"])
  assert.deepEqual(failed.map((result) => result.reason?.message), ["accepted save failed", "accepted save failed"])
  assert.equal(acceptedSaveCalls, 1)

  const retried = await acceptCurrentStep(options, run.runId, { silent: true })
  assert.notEqual(typeof retried, "string")
  assert.equal(retried.status, "completed")
})

test("a caller arriving after durable acceptance joins the in-flight reconciliation", async (t) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-register-late-accept-"))
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }))
  fs.mkdirSync(path.join(workspaceRoot, ".bob"), { recursive: true })
  const { bobTaskSyncRegistry } = require("../out/bobTaskSync")
  const { FileRunStateStore } = require("../out/core/runStateStore")
  const { reviewTaskRegistry } = require("../out/reviewTaskRegistry")
  const runStore = new FileRunStateStore({ workspaceRoot })
  const workflow = reviewingWorkflow()
  workflow.id = "workflow-register.late-review"
  workflow.name = "late-review"
  const run = await runStore.createRun(workflow, {})
  run.status = "reviewing"
  run.currentStep = "review"
  run.steps[0].status = "reviewing"
  await runStore.saveRun(run)

  let setStepCompleteCalls = 0
  reviewTaskRegistry.registerTask(workspaceRoot, run.runId, "review", {
    setStepComplete: async () => { setStepCompleteCalls += 1 }
  })

  const originalReconcileRun = bobTaskSyncRegistry.reconcileRun
  let releaseReconciliation
  const reconciliationReleased = new Promise((resolve) => { releaseReconciliation = resolve })
  let markReconciliationStarted
  const reconciliationStarted = new Promise((resolve) => { markReconciliationStarted = resolve })
  bobTaskSyncRegistry.reconcileRun = async function pausedReconciliation(...args) {
    if (args[1]?.runId === run.runId) {
      markReconciliationStarted()
      await reconciliationReleased
    }
    return originalReconcileRun.apply(this, args)
  }
  t.after(() => { bobTaskSyncRegistry.reconcileRun = originalReconcileRun })

  let markLateCallerJoined
  const lateCallerJoined = new Promise((resolve) => { markLateCallerJoined = resolve })
  const coordinateReviewAcceptance = createTestReviewAcceptanceCoordinator((input) => {
    if (input.joined) markLateCallerJoined()
  })
  const decisions = []
  const options = {
    showMarkdownReport: async () => undefined,
    coordinateReviewAcceptance,
    acceptBobWorkflowGate: () => {
      decisions.push("missing")
      return "missing"
    }
  }
  const { acceptCurrentStep } = loadStepReview(workspaceRoot)

  const owner = acceptCurrentStep(options, run.runId, { silent: true })
  await reconciliationStarted
  const durablyAccepted = await runStore.loadRun(run.runId)
  assert.equal(durablyAccepted.status, "completed")

  const late = acceptCurrentStep(options, run.runId, { silent: true })
  const overlap = await Promise.race([
    lateCallerJoined.then(() => "joined"),
    late.then(() => "settled", () => "settled")
  ])
  releaseReconciliation()
  const results = await Promise.allSettled([owner, late])

  assert.equal(overlap, "joined")
  assert.deepEqual(results.map((result) => result.status), ["fulfilled", "fulfilled"])
  assert.equal(results[0].value, results[1].value)
  assert.equal(setStepCompleteCalls, 1)
  assert.deepEqual(decisions, ["missing"])
})

test("Bob runner and Operation Hub command reconciliation await async Todo projection", () => {
  const runner = readSrc("bobWorkflowRunner.ts")
  const commands = readSrc("workflowRunCommands.ts")

  assert.match(runner, /const sync = await bobTaskSyncRegistry\.reconcileRun/)
  assert.match(commands, /const sync = await bobTaskSyncRegistry\.reconcileRun/)
})

test("Operation Hub review acceptance revalidates revision inside the acceptance queue", async (t) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-register-review-revision-"))
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }))
  fs.mkdirSync(path.join(workspaceRoot, ".bob"), { recursive: true })
  const { FileRunStateStore } = require("../out/core/runStateStore")
  const { readOperationHubRunSnapshot } = require("../out/operationHubMutationTarget")
  const runStore = new FileRunStateStore({ workspaceRoot })
  const run = await runStore.createRun(reviewingWorkflow(), {})
  run.status = "reviewing"
  run.currentStep = "review"
  run.steps[0].status = "reviewing"
  await runStore.saveRun(run)
  const selected = await readOperationHubRunSnapshot(workspaceRoot, run.runId)
  const runFile = path.join(workspaceRoot, ".bob", "workflows", "runs", run.runId, "run.json")
  const externalWinner = {
    ...selected.run,
    state: { winner: "external-after-selection" },
    updatedAt: "2026-07-12T02:00:00.000Z"
  }
  const winnerBytes = `${JSON.stringify(externalWinner, null, 2)}\n`
  const options = {
    showMarkdownReport: async () => undefined,
    coordinateReviewAcceptance: async (_root, _runId, operation) => {
      fs.writeFileSync(runFile, winnerBytes)
      return operation()
    },
    acceptBobWorkflowGate: () => "missing"
  }
  const { acceptCurrentStep } = loadStepReview(workspaceRoot)

  await assert.rejects(
    acceptCurrentStep(options, {
      source: "operationHub",
      workspaceRoot,
      runId: run.runId,
      expectedRevision: selected.revision
    }, { silent: true }),
    /refresh|更新|revision|表示後/i
  )

  assert.equal(fs.readFileSync(runFile, "utf8"), winnerBytes)
})
