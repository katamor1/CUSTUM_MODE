const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const Module = require("node:module")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { OperationHubMutationCoordinator } = require("../out/gui/operationHubMutationCoordinator")

function loadProviderWithVscode(vscode) {
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "vscode") return vscode
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const modulePath = require.resolve("../out/gui/operationHubProvider")
    delete require.cache[modulePath]
    return require(modulePath).OperationHubProvider
  } finally {
    Module._load = originalLoad
  }
}

function tempRunRoot(t, updatedAt = "2026-07-12T01:00:00.000Z") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-register-operation-hub-"))
  const runId = "shared-run"
  const runFile = path.join(root, ".bob", "workflows", "runs", runId, "run.json")
  fs.mkdirSync(path.dirname(runFile), { recursive: true })
  const run = {
    runId,
    workflowId: "workflow-register.target",
    workflowName: "Target",
    status: "failed",
    currentStep: "step",
    inputs: {},
    state: { winner: "initial" },
    steps: [{ id: "step", title: "Step", type: "command", status: "failed" }],
    createdAt: updatedAt,
    updatedAt
  }
  const bytes = `${JSON.stringify(run)}\n`
  fs.writeFileSync(runFile, bytes)
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return {
    root,
    runId,
    runFile,
    updatedAt,
    revision: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
    run
  }
}

function loadWorkflowRunCommandsWithVscode(vscode) {
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "vscode") return vscode
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const modulePath = require.resolve("../out/workflowRunCommands")
    delete require.cache[modulePath]
    return require(modulePath)
  } finally {
    Module._load = originalLoad
  }
}

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

function runCommandHarness(t) {
  const rootA = tempRunRoot(t)
  const rootB = tempRunRoot(t)
  const state = {
    engineRoots: [],
    runStoreCalls: 0,
    messages: [],
    workflowIds: [],
    savedRuns: [],
    coordinateGateDecision: (_workspaceRoot, _runId, _kind, operation) => operation()
  }
  const vscode = {
    window: {
      showErrorMessage: async (message) => { state.messages.push(message) },
      showInformationMessage: async (message) => { state.messages.push(message) },
      showQuickPick: async (items) => items[0],
      showWarningMessage: async (message) => { state.messages.push(message) }
    },
    workspace: { isTrusted: true }
  }
  const { WorkflowRunCommandService } = loadWorkflowRunCommandsWithVscode(vscode)
  const workflow = {
    id: "workflow-register.target",
    name: "target",
    label: "Target",
    inputs: {},
    stepReview: { allowRetry: true },
    stepExecution: { mode: "engineSteps", allowOutOfOrder: false, showInBob: true },
    engineSteps: [{ id: "step", title: "Step", type: "command" }]
  }
  const runtimeFactory = {
    createRunStore: (root) => {
      state.runStoreCalls += 1
      const fixture = root === rootA.root ? rootA : rootB
      return {
        listRuns: async () => [fixture.run],
        loadRun: async () => fixture.run,
        createRun: async (selectedWorkflow, inputs) => ({
          ...fixture.run,
          runId: "seeded-run",
          workflowId: selectedWorkflow.id,
          workflowName: selectedWorkflow.name,
          status: "running",
          currentStep: selectedWorkflow.engineSteps[0]?.id,
          state: {},
          inputs,
          steps: selectedWorkflow.engineSteps.map((step) => ({
            id: step.id,
            title: step.title,
            type: step.type,
            status: "pending"
          }))
        }),
        saveRun: async (run) => { state.savedRuns.push(run) }
      }
    },
    createEngine: (root) => {
      state.engineRoots.push(root)
      return {
        runWorkflow: async (selectedWorkflow) => {
          state.workflowIds.push(selectedWorkflow.id)
          return { ...rootB.run, status: "running" }
        },
        resumeRun: async () => ({ ...rootB.run, runId: "seeded-run", status: "running" }),
        retryCurrentStep: async () => ({ ...rootB.run, status: "reviewing" })
      }
    }
  }
  const service = new WorkflowRunCommandService({
    coreWorkflows: new Map([[workflow.id, workflow]]),
    runtimeFactory,
    ensureWorkflowsLoaded: async () => undefined,
    workflowRootCandidates: async () => [markerRoot(rootA.root), markerRoot(rootB.root)],
    activeSteps: () => [],
    showManualStepPanel: async () => undefined,
    gateRegistry: {
      pendingForRun: () => ({ ownerStepId: "step", stepId: "step", status: "reviewing" }),
      rebind: () => undefined,
      acceptPending: () => true
    },
    coordinateGateDecision: (...args) => state.coordinateGateDecision(...args)
  })
  return { rootA, rootB, service, state, workflow }
}

function providerHarness(t, run = tempRunRoot(t)) {
  const state = {
    commands: [],
    errors: [],
    openedDocuments: [],
    warnings: [],
    executeCommand: async () => undefined
  }
  const vscode = {
    commands: {
      executeCommand: async (...args) => {
        state.commands.push(args)
        return state.executeCommand(...args)
      }
    },
    extensions: { getExtension: () => undefined },
    Uri: {
      file: (filePath) => ({ fsPath: path.resolve(filePath) })
    },
    window: {
      showErrorMessage: async (message) => { state.errors.push(message) },
      showTextDocument: async (uri, options) => { state.openedDocuments.push({ uri, options }) },
      showWarningMessage: async (message) => { state.warnings.push(message) }
    },
    workspace: {
      workspaceFolders: [{ name: "workspace", uri: { fsPath: run.root } }]
    }
  }
  const OperationHubProvider = loadProviderWithVscode(vscode)
  const provider = new OperationHubProvider({ api: { listWorkflows: () => [] }, extensionUri: {} })
  t.after(() => provider.dispose())
  return { provider, run, state }
}

function replaceRunDirectoryWithExternalAlias(t, fixture) {
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-register-external-run-"))
  const externalRunFile = path.join(externalRoot, "run.json")
  const externalControlFile = path.join(externalRoot, "control.json")
  const bytes = `${JSON.stringify(fixture.run)}\n`
  const controlBytes = `${JSON.stringify({ runId: fixture.runId, mode: "external-control" })}\n`
  fs.rmSync(path.dirname(fixture.runFile), { recursive: true, force: true })
  fs.writeFileSync(externalRunFile, bytes)
  fs.writeFileSync(externalControlFile, controlBytes)
  try {
    fs.symlinkSync(
      externalRoot,
      path.dirname(fixture.runFile),
      process.platform === "win32" ? "junction" : "dir"
    )
  } catch (error) {
    fs.rmSync(externalRoot, { recursive: true, force: true })
    if (["EPERM", "EACCES", "ENOTSUP", "UNKNOWN"].includes(error.code)) {
      t.skip(`directory alias unavailable: ${error.code}`)
      return undefined
    }
    throw error
  }
  t.after(() => fs.rmSync(externalRoot, { recursive: true, force: true }))
  fixture.revision = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`
  fixture.externalRunFile = externalRunFile
  fixture.externalControlFile = externalControlFile
  fixture.externalRunBytes = bytes
  fixture.externalControlBytes = controlBytes
  return fixture
}

function mutationMessage(run, overrides = {}) {
  return {
    type: "operationHub.action",
    action: "retryCurrentStep",
    workspaceRoot: run.root,
    runId: run.runId,
    expectedRevision: run.revision,
    ...overrides
  }
}

function openArtifactMessage(artifactPath) {
  return {
    type: "operationHub.action",
    action: "openArtifact",
    artifactPath
  }
}

function createDirectoryAlias(t, target, alias) {
  try {
    fs.symlinkSync(target, alias, process.platform === "win32" ? "junction" : "dir")
    return true
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP", "UNKNOWN"].includes(error.code)) {
      t.skip(`directory alias unavailable: ${error.code}`)
      return false
    }
    throw error
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function runIdentity(overrides = {}) {
  return {
    actionId: "retryCurrentStep",
    workspaceRoot: "C:\\workspace-a",
    targetKind: "run",
    targetId: "run-1",
    ...overrides
  }
}

test("Operation Hub host shares one promise and underlying mutation for identical actions", async () => {
  const coordinator = new OperationHubMutationCoordinator()
  const release = deferred()
  const started = deferred()
  const result = { status: "ok" }
  let calls = 0
  const operation = async () => {
    calls += 1
    started.resolve()
    await release.promise
    return result
  }

  const first = coordinator.coordinate(runIdentity(), operation)
  const duplicate = coordinator.coordinate(runIdentity(), operation)

  assert.strictEqual(duplicate, first)
  await started.promise
  assert.equal(calls, 1)
  release.resolve()
  const [firstResult, duplicateResult] = await Promise.all([first, duplicate])
  assert.strictEqual(firstResult, result)
  assert.strictEqual(duplicateResult, result)
  assert.equal(calls, 1)
})

test("Operation Hub host serializes different mutations for the same root and run", async () => {
  const coordinator = new OperationHubMutationCoordinator()
  const releaseFirst = deferred()
  const firstStarted = deferred()
  const order = []

  const first = coordinator.coordinate(runIdentity({ actionId: "acceptCurrentStep" }), async () => {
    order.push("accept:start")
    firstStarted.resolve()
    await releaseFirst.promise
    order.push("accept:end")
    return "accepted"
  })
  await firstStarted.promise
  const second = coordinator.coordinate(runIdentity({ actionId: "runNextStep" }), async () => {
    order.push("next:start")
    return "next"
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(order, ["accept:start"])
  releaseFirst.resolve()
  assert.deepEqual(await Promise.all([first, second]), ["accepted", "next"])
  assert.deepEqual(order, ["accept:start", "accept:end", "next:start"])
})

test("Operation Hub host keeps different revisions distinct while serializing the same action and target", async () => {
  const coordinator = new OperationHubMutationCoordinator()
  const releaseFirst = deferred()
  const firstStarted = deferred()
  const order = []
  const first = coordinator.coordinate(runIdentity({ expectedRevision: "sha256:revision-a" }), async () => {
    order.push("revision-a:start")
    firstStarted.resolve()
    await releaseFirst.promise
    order.push("revision-a:end")
    return "revision-a"
  })
  await firstStarted.promise
  const second = coordinator.coordinate(runIdentity({ expectedRevision: "sha256:revision-b" }), async () => {
    order.push("revision-b:revalidate")
    throw new Error("stale revision-b")
  })

  assert.notStrictEqual(second, first)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(order, ["revision-a:start"])
  releaseFirst.resolve()
  assert.equal(await first, "revision-a")
  await assert.rejects(second, /stale revision-b/)
  assert.deepEqual(order, ["revision-a:start", "revision-a:end", "revision-b:revalidate"])
})

test("Operation Hub host lets equal run ids in different roots proceed independently", async () => {
  const coordinator = new OperationHubMutationCoordinator()
  const releaseA = deferred()
  const releaseB = deferred()
  const startedA = deferred()
  const startedB = deferred()

  const first = coordinator.coordinate(runIdentity({ workspaceRoot: "C:\\workspace-a" }), async () => {
    startedA.resolve()
    await releaseA.promise
    return "a"
  })
  const second = coordinator.coordinate(runIdentity({ workspaceRoot: "C:\\workspace-b" }), async () => {
    startedB.resolve()
    await releaseB.promise
    return "b"
  })

  await Promise.all([startedA.promise, startedB.promise])
  releaseA.resolve()
  releaseB.resolve()
  assert.deepEqual(await Promise.all([first, second]), ["a", "b"])
})

test("Operation Hub host releases a failed mutation so it can be retried", async () => {
  const coordinator = new OperationHubMutationCoordinator()
  let calls = 0
  const operation = async () => {
    calls += 1
    if (calls === 1) throw new Error("transient failure")
    return "retried"
  }

  await assert.rejects(coordinator.coordinate(runIdentity(), operation), /transient failure/)
  assert.equal(await coordinator.coordinate(runIdentity(), operation), "retried")
  assert.equal(calls, 2)
})

test("Operation Hub provider coordinates duplicate structured run mutations before command dispatch", async (t) => {
  const { provider, run, state } = providerHarness(t)
  const release = deferred()
  const started = deferred()
  state.executeCommand = async () => {
    started.resolve()
    await release.promise
    return { status: "retried" }
  }

  const first = provider.handleMessage(mutationMessage(run))
  const duplicate = provider.handleMessage(mutationMessage(run))
  await started.promise
  assert.equal(state.commands.length, 1)
  assert.deepEqual(state.commands[0], [
    "workflowRegister.retryCurrentStep",
    {
      source: "operationHub",
      workspaceRoot: fs.realpathSync(run.root),
      runId: run.runId,
      expectedRevision: run.revision
    }
  ])

  release.resolve()
  await Promise.all([first, duplicate])
  assert.equal(state.commands.length, 1)
  assert.deepEqual(state.errors, [])
})

test("Operation Hub provider does not coalesce the same action when expected revisions differ", async (t) => {
  const { provider, run, state } = providerHarness(t)
  const release = deferred()
  const started = deferred()
  state.executeCommand = async () => {
    started.resolve()
    await release.promise
    fs.writeFileSync(run.runFile, `${JSON.stringify({
      ...run.run,
      state: { winner: "first-mutation" }
    })}\n`)
    return { status: "retried" }
  }

  const first = provider.handleMessage(mutationMessage(run))
  await started.promise
  const staleRevision = `sha256:${"b".repeat(64)}`
  const second = provider.handleMessage(mutationMessage(run, { expectedRevision: staleRevision }))
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(state.commands.length, 1)

  release.resolve()
  await Promise.all([first, second])

  assert.equal(state.commands.length, 1)
  assert.equal(state.errors.length, 1)
  assert.match(state.errors[0], /run 'shared-run'.*(表示後|revision)/i)
})

test("Operation Hub provider rejects a stale run revision before command dispatch", async (t) => {
  const { provider, run, state } = providerHarness(t)
  fs.writeFileSync(run.runFile, `${JSON.stringify({
    runId: run.runId,
    updatedAt: run.updatedAt,
    state: { winner: "external-write-with-same-timestamp" }
  })}\n`)

  await provider.handleMessage(mutationMessage(run))

  assert.equal(state.commands.length, 0)
  assert.ok(
    [...state.errors, ...state.warnings].some((message) => /refresh|更新|再読込/i.test(message)),
    `expected refresh diagnostic, got ${JSON.stringify({ errors: state.errors, warnings: state.warnings })}`
  )
})

test("Operation Hub provider rejects a Webview root that is not a current workspace candidate", async (t) => {
  const { provider, run, state } = providerHarness(t)
  const untrustedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-register-untrusted-root-"))
  t.after(() => fs.rmSync(untrustedRoot, { recursive: true, force: true }))

  await provider.handleMessage(mutationMessage(run, { workspaceRoot: untrustedRoot }))

  assert.equal(state.commands.length, 0)
  assert.ok(
    [...state.errors, ...state.warnings].some((message) => /workspace|refresh|更新|再読込/i.test(message)),
    `expected workspace diagnostic, got ${JSON.stringify({ errors: state.errors, warnings: state.warnings })}`
  )
})

test("Operation Hub provider rejects a run-directory alias that resolves outside the trusted workspace", async (t) => {
  const run = replaceRunDirectoryWithExternalAlias(t, tempRunRoot(t))
  if (!run) return
  const { provider, state } = providerHarness(t, run)

  await provider.handleMessage(mutationMessage(run))

  assert.equal(state.commands.length, 0)
  assert.ok(state.errors.some((message) => /workspace|outside|refresh|更新|再読込/i.test(message)))
  assert.equal(fs.readFileSync(run.externalRunFile, "utf8"), run.externalRunBytes)
  assert.equal(fs.readFileSync(run.externalControlFile, "utf8"), run.externalControlBytes)
})

test("Operation Hub openArtifact rejects a workspace-local alias that resolves outside", async (t) => {
  const { provider, run, state } = providerHarness(t)
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-register-open-artifact-outside-"))
  const outsideArtifact = path.join(outsideRoot, "outside.md")
  const outsideBytes = "outside artifact must stay unopened\n"
  fs.writeFileSync(outsideArtifact, outsideBytes)
  t.after(() => fs.rmSync(outsideRoot, { recursive: true, force: true }))
  const aliasDirectory = path.join(run.root, ".bob", "outside-artifact-alias")
  if (!createDirectoryAlias(t, outsideRoot, aliasDirectory)) return

  await provider.handleMessage(openArtifactMessage(path.join(aliasDirectory, "outside.md")))

  assert.deepEqual(state.openedDocuments, [])
  assert.deepEqual(state.errors, ["Bob Operation Hub: workspace 外の成果物は開けません。"])
  assert.equal(fs.readFileSync(outsideArtifact, "utf8"), outsideBytes)
})

test("Operation Hub openArtifact opens the verified physical URI for an in-workspace alias", async (t) => {
  const { provider, run, state } = providerHarness(t)
  const physicalDirectory = path.join(run.root, ".bob", "physical-artifacts")
  const physicalArtifact = path.join(physicalDirectory, "inside.md")
  fs.mkdirSync(physicalDirectory, { recursive: true })
  fs.writeFileSync(physicalArtifact, "inside artifact\n")
  const aliasDirectory = path.join(run.root, ".bob", "inside-artifact-alias")
  if (!createDirectoryAlias(t, physicalDirectory, aliasDirectory)) return
  const aliasArtifact = path.join(aliasDirectory, "inside.md")

  await provider.handleMessage(openArtifactMessage(aliasArtifact))

  assert.deepEqual(state.errors, [])
  assert.deepEqual(state.openedDocuments, [{
    uri: { fsPath: fs.realpathSync(aliasArtifact) },
    options: { preview: false }
  }])
})

test("Operation Hub model rejects a run-directory alias swapped in after safe run listing", async (t) => {
  const run = tempRunRoot(t)
  const { provider } = providerHarness(t, run)
  const { FileRunStateStore } = require("../out/core/runStateStore")
  const originalListRuns = FileRunStateStore.prototype.listRuns
  let escaped
  FileRunStateStore.prototype.listRuns = async function listThenSwapRunDirectory() {
    const listed = await originalListRuns.call(this)
    escaped = replaceRunDirectoryWithExternalAlias(t, run)
    return listed
  }
  t.after(() => { FileRunStateStore.prototype.listRuns = originalListRuns })

  await assert.rejects(provider.loadModel(), /workspace|outside|symlink|junction|alias|再読込/i)

  if (!escaped) return
  assert.equal(fs.readFileSync(escaped.externalRunFile, "utf8"), escaped.externalRunBytes)
  assert.equal(fs.readFileSync(escaped.externalControlFile, "utf8"), escaped.externalControlBytes)
})

test("workflow run commands route a structured Operation Hub target to its exact root", async (t) => {
  const { rootB, service, state } = runCommandHarness(t)

  const result = await service.retryCurrentStep({
    source: "operationHub",
    workspaceRoot: rootB.root,
    runId: rootB.runId,
    expectedRevision: rootB.revision
  })

  assert.equal(result.status, "reviewing")
  assert.deepEqual(state.engineRoots, [fs.realpathSync(rootB.root)])
})

test("workflow run commands reject stale structured revisions before run-store or engine access", async (t) => {
  const { rootB, service, state } = runCommandHarness(t)
  fs.writeFileSync(rootB.runFile, `${JSON.stringify({
    ...rootB.run,
    updatedAt: rootB.updatedAt,
    state: { winner: "external-write-with-same-timestamp" }
  })}\n`)

  await assert.rejects(
    service.retryCurrentStep({
      source: "operationHub",
      workspaceRoot: rootB.root,
      runId: rootB.runId,
      expectedRevision: rootB.revision
    }),
    /refresh|更新|再読込/i
  )
  assert.equal(state.runStoreCalls, 0)
  assert.equal(state.engineRoots.length, 0)
})

test("workflow run commands revalidate a structured revision inside the mutation queue", async (t) => {
  const { rootB, service, state } = runCommandHarness(t)
  const externalWinner = {
    ...rootB.run,
    state: { winner: "external-after-selection" },
    updatedAt: "2026-07-12T02:00:00.000Z"
  }
  const winnerBytes = `${JSON.stringify(externalWinner)}\n`
  state.coordinateGateDecision = async (_workspaceRoot, _runId, _kind, operation) => {
    fs.writeFileSync(rootB.runFile, winnerBytes)
    return operation()
  }

  await assert.rejects(
    service.retryCurrentStep({
      source: "operationHub",
      workspaceRoot: rootB.root,
      runId: rootB.runId,
      expectedRevision: rootB.revision
    }),
    /refresh|更新|revision|表示後/i
  )

  assert.equal(state.runStoreCalls, 0)
  assert.equal(state.engineRoots.length, 0)
  assert.equal(fs.readFileSync(rootB.runFile, "utf8"), winnerBytes)
})

test("workflow run commands reject an outside run-directory alias before run-store or engine access", async (t) => {
  const { rootB, service, state } = runCommandHarness(t)
  const escaped = replaceRunDirectoryWithExternalAlias(t, rootB)
  if (!escaped) return

  await assert.rejects(
    service.retryCurrentStep({
      source: "operationHub",
      workspaceRoot: escaped.root,
      runId: escaped.runId,
      expectedRevision: escaped.revision
    }),
    /workspace|outside|refresh|更新|再読込/i
  )

  assert.equal(state.runStoreCalls, 0)
  assert.equal(state.engineRoots.length, 0)
  assert.equal(fs.readFileSync(escaped.externalRunFile, "utf8"), escaped.externalRunBytes)
  assert.equal(fs.readFileSync(escaped.externalControlFile, "utf8"), escaped.externalControlBytes)
})

test("workflow artifact start rejects an external artifacts-directory alias", async (t) => {
  const { rootB, service, state } = runCommandHarness(t)
  const runDirectory = path.dirname(rootB.runFile)
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-register-external-artifacts-"))
  const manifestFile = path.join(outsideRoot, "manifest.json")
  const manifestBytes = `${JSON.stringify({
    schemaVersion: "workflow-register/artifact-manifest/v1",
    workflowId: "workflow-register.target",
    runId: rootB.runId,
    inputsHash: `sha256:${crypto.createHash("sha256").update("{}").digest("hex")}`,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    artifacts: []
  })}\n`
  fs.writeFileSync(manifestFile, manifestBytes)
  try {
    fs.symlinkSync(
      outsideRoot,
      path.join(runDirectory, "artifacts"),
      process.platform === "win32" ? "junction" : "dir"
    )
  } catch (error) {
    fs.rmSync(outsideRoot, { recursive: true, force: true })
    if (["EPERM", "EACCES", "ENOTSUP", "UNKNOWN"].includes(error.code)) {
      t.skip(`directory alias unavailable: ${error.code}`)
      return
    }
    throw error
  }
  t.after(() => fs.rmSync(outsideRoot, { recursive: true, force: true }))

  await assert.rejects(
    service.startFromStepWithArtifacts("workflow-register.target", "step", {
      source: "operationHub",
      workspaceRoot: rootB.root,
      runId: rootB.runId,
      expectedRevision: rootB.revision
    }, {}),
    /workspace|outside|symlink|junction|alias|direct/i
  )

  assert.equal(state.savedRuns.length, 0)
  assert.equal(state.engineRoots.length, 0)
  assert.equal(fs.readFileSync(manifestFile, "utf8"), manifestBytes)
})

test("workflow artifact hydration rejects a manifest entry through an external junction", async (t) => {
  const { rootB, service, state, workflow } = runCommandHarness(t)
  workflow.definitionHash = "definition-v1"
  workflow.engineSteps = [
    { id: "collect", title: "Collect", type: "agent", prompt: "Collect", resultKey: "context" },
    { id: "step", title: "Step", type: "command" }
  ]
  workflow.artifacts = [{ id: "context", producedBy: "collect", path: "linked/secret.txt" }]

  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-register-external-hydration-"))
  const secretText = "outside secret"
  fs.writeFileSync(path.join(outsideRoot, "secret.txt"), secretText)
  const linkedDirectory = path.join(rootB.root, "linked")
  try {
    fs.symlinkSync(outsideRoot, linkedDirectory, process.platform === "win32" ? "junction" : "dir")
  } catch (error) {
    fs.rmSync(outsideRoot, { recursive: true, force: true })
    if (["EPERM", "EACCES", "ENOTSUP", "UNKNOWN"].includes(error.code)) {
      t.skip(`directory alias unavailable: ${error.code}`)
      return
    }
    throw error
  }
  t.after(() => fs.rmSync(outsideRoot, { recursive: true, force: true }))

  const manifestDirectory = path.join(path.dirname(rootB.runFile), "artifacts")
  fs.mkdirSync(manifestDirectory, { recursive: true })
  fs.writeFileSync(path.join(manifestDirectory, "manifest.json"), `${JSON.stringify({
    schemaVersion: "workflow-register/artifact-manifest/v1",
    workflowId: workflow.id,
    workflowDefinitionHash: workflow.definitionHash,
    runId: rootB.runId,
    inputsHash: `sha256:${crypto.createHash("sha256").update("{}").digest("hex")}`,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    artifacts: [{
      id: "context",
      stateKey: "context",
      producedBy: "collect",
      path: "linked/secret.txt",
      sha256: crypto.createHash("sha256").update(secretText).digest("hex"),
      bytes: Buffer.byteLength(secretText, "utf8"),
      source: "workflow-artifact",
      updatedAt: "2026-07-12T00:00:00.000Z"
    }]
  })}\n`)

  const result = await service.startFromStepWithArtifacts(workflow.id, "step", {
    source: "operationHub",
    workspaceRoot: rootB.root,
    runId: rootB.runId,
    expectedRevision: rootB.revision
  }, {})
  assert.match(String(result), /workspace|outside|junction|alias|physical/i)

  assert.equal(state.savedRuns.length, 0)
  assert.equal(state.engineRoots.length, 0)
})

test("workflow run commands treat a structured workflow target as identity rather than a workflow id object", async (t) => {
  const { rootB, service, state } = runCommandHarness(t)

  const result = await service.runWorkflow({
    source: "operationHub",
    workspaceRoot: rootB.root,
    workflowId: "workflow-register.target"
  })

  assert.equal(result.status, "running")
  assert.deepEqual(state.engineRoots, [fs.realpathSync(rootB.root)])
  assert.deepEqual(state.workflowIds, ["workflow-register.target"])
})

test("Operation Hub model and HTML carry the host revision and root on run mutation buttons", () => {
  const { buildOperationHubModel } = require("../out/gui/operationHubModel")
  const { renderOperationHubHtml } = require("../out/gui/operationHubHtml")
  const revision = `sha256:${"a".repeat(64)}`
  const root = "C:\\workspace-a"
  const model = buildOperationHubModel({
    workspaceName: "workspace-a",
    workspaceRoots: [root],
    extensionStatus: [],
    setup: {
      bobRootPresent: true,
      workflowsPresent: true,
      runStatePresent: true,
      mcpConfigPresent: true,
      traceabilityPresent: false
    },
    workflows: [],
    runs: [{
      root,
      revision,
      run: {
        runId: "run-1",
        workflowId: "workflow-register.target",
        workflowName: "Target",
        status: "failed",
        currentStep: "step",
        inputs: {},
        state: {},
        steps: [{ id: "step", title: "Step", type: "command", status: "failed" }],
        createdAt: "2026-07-12T01:00:00.000Z",
        updatedAt: "2026-07-12T01:00:00.000Z"
      }
    }]
  })

  const retry = model.runMonitor[0].primaryActions.find((action) => action.id === "retryCurrentStep")
  assert.equal(retry.workspaceRoot, root)
  assert.equal(retry.expectedRevision, revision)
  const html = renderOperationHubHtml({ model, cspSource: "vscode-resource:", nonce: "nonce" })
  assert.match(html, /data-workspace-root="C:\\workspace-a"/)
  assert.match(html, new RegExp(`data-expected-revision="${revision}"`))
  assert.match(html, /workspaceRoot: button\.dataset\.workspaceRoot/)
  assert.match(html, /expectedRevision: button\.dataset\.expectedRevision/)
})
