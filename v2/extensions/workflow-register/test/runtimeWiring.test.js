const assert = require("node:assert/strict")
const fs = require("node:fs")
const Module = require("node:module")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")
const { readSourceSet, readSrc } = require("./helpers/sourceReader")

function runtimeSource() {
  return readSourceSet([
    "extension.ts",
    "extensionWithAuthoring.ts",
    "bobWorkflowGateRegistry.ts",
    "workflowRuntimeFactory.ts",
    "workflowAdapter.ts",
    "bobWorkflowTypes.ts",
    "bobWorkflowRunner.ts",
    "bobStepRuntime.ts",
    "bobTaskSync.ts",
    "bobWorkflowMessages.ts",
    "reviewTaskRegistry.ts",
    "commands/stepReview.ts",
    "webview/manualStepPanel.ts",
    "workflowInputPrompt.ts",
    "workflowRegisterService.ts",
    "workflowRunCommands.ts",
    "core/engine.ts",
    "core/engine/stepExecutor.ts"
  ])
}

function loadBobWorkflowRunner() {
  const modulePath = require.resolve("../out/bobWorkflowRunner.js")
  delete require.cache[modulePath]
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "vscode") {
      return {
        commands: { executeCommand: async () => undefined },
        window: {
          showErrorMessage: async () => undefined,
          showWarningMessage: async () => undefined
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

async function waitForReviewingRun(runStore, timeoutMs = 15_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt <= timeoutMs) {
    const run = (await runStore.listRuns()).find((candidate) => candidate.status === "reviewing")
    if (run) return run
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Bob workflow did not reach reviewing state within ${timeoutMs}ms.`)
}

function createBobReviewRunner(t) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-register-bob-gate-"))
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }))
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { BobWorkflowGateRegistry } = require("../out/bobWorkflowGateRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { BobWorkflowEngineRunner, StepRuntime } = loadBobWorkflowRunner()
  const actionRegistry = new ActionRegistry()
  actionRegistry.register({ id: "sample.collect", execute: async () => "context" })
  const runStore = new FileRunStateStore({ workspaceRoot })
  const gateRegistry = new BobWorkflowGateRegistry()
  const coreWorkflow = {
    id: "workflow-register.bob-review-gate",
    name: "bob-review-gate",
    label: "Bob Review Gate",
    description: "Bob review gate behavior test.",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    stepReview: {
      enabled: true,
      pauseAfter: "everyStep",
      requireAcceptBeforeNext: true,
      allowRetry: true,
      allowEditBeforeRetry: true,
      preserveAttempts: true
    },
    engineSteps: [{
      id: "review",
      title: "Review",
      type: "command",
      action: { provider: "sample.collect" },
      resultKey: "context"
    }]
  }
  const definition = {
    id: coreWorkflow.id,
    name: coreWorkflow.name,
    label: coreWorkflow.label,
    menuLabel: coreWorkflow.label,
    description: coreWorkflow.description,
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
    stepExecution: { mode: "engineSteps", allowOutOfOrder: false, showInBob: true },
    stepsById: {
      review: {
        id: "review",
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
      }
    },
    todos: [{ id: "review", text: "Review", raw: "review: Review" }],
    inputs: {},
    guardrails: {},
    workflowRoot: workspaceRoot,
    file: { fsPath: path.join(workspaceRoot, "WORKFLOW.md") },
    core: coreWorkflow
  }
  const runner = new BobWorkflowEngineRunner({
    definition,
    coreWorkflow,
    actionRegistry,
    resultSinks: () => createDefaultResultSinkRegistry({
      workspaceRoot,
      executeCommand: async () => undefined
    }),
    runStore: () => runStore,
    taskSnapshotStore: () => undefined,
    preflightChecks: () => ({ bazaarRepository: async () => true }),
    stepRuntime: new StepRuntime(),
    inputsProvider: async () => ({}),
    gateRegistry
  })
  return { gateRegistry, runStore, runner, workspaceRoot }
}

function orderedPattern(...parts) {
  return new RegExp(parts.map(escapeRegex).join("[\\s\\S]*"))
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

test("completeStep command can be called silently by companion extensions", () => {
  const source = runtimeSource()

  assert.match(source, /interface StepCompletionOptions extends StepCompletionExpectation \{[\s\S]*silent\?: boolean[\s\S]*\}/)
  assert.match(source, /registerCommand\("workflowRegister\.completeStep", \(options\?: StepCompletionOptions\) => service\.completeCurrentStep\(options\)\)/)
  assert.match(source, /async completeCurrentStep\(options: StepCompletionOptions = \{\}\): Promise<string>/)
  assert.match(source, /this\.stepRuntime\.completeCurrentStep\(\{[\s\S]*expectedRunId: options\.expectedRunId[\s\S]*expectedStepId: options\.expectedStepId[\s\S]*stateUpdates: options\.stateUpdates[\s\S]*\}\)/)
  assert.match(source, /if \(!options\.silent\) await vscode\.window\.showInformationMessage\(message\)/)
  assert.match(source, /return message/)
})

test("activation schedules delayed workflow reload retries after Bob finishes startup", () => {
  const source = readSrc("extension.ts")

  assert.match(source, /const retryDelaysMs = \[3000, 10000, 30000, 60000, 120000\]/)
  assert.match(source, /setTimeout\([\s\S]*service\.reload\(\{ showReport: false \}\)/)
})

test("standalone workflow launcher wires an AgentProvider through API or configured command", () => {
  const source = runtimeSource()

  assert.match(source, /import \{ createCommandAgentProvider \} from "\.\/core\/agentProvider"/)
  assert.match(source, /registerAgentProvider: \(provider: AgentProvider\) => void/)
  assert.match(source, /registerAgentProvider: \(provider\) => service\.registerAgentProvider\(provider\)/)
  assert.match(source, /agentProvider: agentProvider \?\? this\.options\.agentProvider\(\) \?\? this\.createCommandAgentProvider\(\)/)
  assert.match(source, orderedPattern(
    "createCommandAgentProvider({",
    'command: config.get<string>("agentCommand", ""),',
    "requireTrustedCommandExecution(\"run configured agent command\")",
    "vscode.commands.executeCommand(command, input)"
  ))
})

test("runtime entry points and default providers check Workspace Trust", () => {
  const source = runtimeSource()

  assert.match(source, /import \{ requireTrustedWorkspace \} from "\.\/workspaceTrust"/)
  assert.match(source, /async reload\(options: \{ showReport: boolean \}\): Promise<void> \{[\s\S]*requireTrustedWorkspace\("reload registration", \{ showWarning: options\.showReport \}\)/)
  assert.match(source, /async runWorkflow\(workflowArg\?: WorkflowCommandArg, inputs: Record<string, unknown> = \{\}\): Promise<unknown> \{[\s\S]*requireTrustedWorkspace\("run workflow"\)/)
  assert.match(source, /async runWorkflowStep\([\s\S]*requireTrustedWorkspace\("run workflow step"\)/)
  assert.match(source, /isWorkspaceTrusted: \(\) => vscode\.workspace\.isTrusted/)
  assert.match(source, /requireTrustedCommandExecution\("write command result sink"\)/)
})

test("standalone workflow launcher uses the shared input resolver for conditional prompts", () => {
  const source = runtimeSource()

  assert.match(source, /import \{ collectWorkflowInputsWithResolver \} from "\.\/core\/inputCollector"/)
  assert.match(source, orderedPattern(
    "return collectWorkflowInputsWithResolver({",
    "inputs: workflow.inputs,",
    "provided,",
    "prompt: promptForWorkflowInput",
    "})"
  ))
  assert.doesNotMatch(source, /for \(const \[key, definition\] of Object\.entries\(workflow\.inputs\)\)/)
})

test("manual completion results are wired through Bob and standalone engine paths", () => {
  const source = runtimeSource()

  assert.match(source, /coreStep: step/)
  assert.match(source, /const result = await this\.options\.stepRuntime\.hold\(/)
  assert.match(source, /if \(result\.completed\) manuallyCompleted\.add\(stepKey\(run\.runId, step\.id\)\)/)
  assert.match(source, /return result/)
  assert.match(source, /manualCompletion: \(input\) => this\.holdStandaloneManualStep\(input\)/)
  assert.match(source, /private async holdStandaloneManualStep\(/)
})

test("Bob workflow Todo execution delegates to the shared WorkflowEngine runner", () => {
  const source = readSourceSet([
    "workflowRegistrationService.ts",
    "workflowRuntimeFactory.ts",
    "bobWorkflowRunner.ts",
    "core/taskSnapshots.ts"
  ])

  assert.match(source, /createBobWorkflow\(workflow, input\.createRunner\(workflow\)\)/)
  assert.match(source, /class BobWorkflowEngineRunner/)
  assert.match(source, orderedPattern(
    "runTodoStep(todo: WorkflowTodoItem, index: number, task: BobWorkflowTask): Promise<boolean> {",
    'executionMode: "singleStep"',
    "stepId: todo.id"
  ))
  assert.match(source, orderedPattern(
    "engine.runWorkflow(this.options.coreWorkflow, inputs, {",
    "executionMode: request.executionMode",
    "stepId: request.stepId",
    "})"
  ))
  assert.match(source, /if \(isBobHumanGate\(run\.status\)\)/)
  assert.match(source, /status === "reviewing" \|\| status === "held" \|\| status === "checkpoint" \|\| status === "paused"/)
  assert.match(source, /request\.stepId,\s*request\.executionMode/)
  assert.match(source, /if \(executionMode === "full"\) return/)
  assert.match(source, /createBobTaskSnapshotProvider\(task\)/)
  assert.match(source, /new FileTaskSnapshotStore\(/)
  assert.doesNotMatch(source, /async function runWorkflowStepCommand\(/)
  assert.doesNotMatch(source, /step\.command === "bobBazaar\./)
  assert.doesNotMatch(source, /Unsupported step command\. Add it to the workflow-register allowlist before use\./)
})

test("Bob workflow runner surfaces step review gates without failing the run", () => {
  const source = readSrc("bobWorkflowRunner.ts")

  assert.match(source, /if \(\(run\.status === "reviewing" \|\| run\.status === "held"\) && run\.error\)/)
  assert.match(source, /vscode\.window\.showWarningMessage\("ワークフローはユーザー操作待ちです。Operation Hub を開きました。"\)/)
  assert.match(source, /run\.status === "held"/)
  assert.doesNotMatch(source, /Bob workflow step gate:/)
})

test("Bob workflow runner remains pending at review until its registry accepts the gate", async (t) => {
  const { gateRegistry, runStore, runner, workspaceRoot } = createBobReviewRunner(t)
  let settled = false
  const execution = runner.runEngineStep("review", 0, {
    sendMessage: async () => undefined,
    setStepComplete: () => undefined
  })
  void execution.then(
    () => { settled = true },
    () => { settled = true }
  )

  const reviewing = await waitForReviewingRun(runStore)
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(settled, false)
  assert.equal(gateRegistry.isPending(workspaceRoot, reviewing.runId, "review"), true)
  assert.equal(gateRegistry.accept(workspaceRoot, reviewing.runId, "review"), "accepted")
  assert.equal(await execution, true)
})

test("Bob workflow runner aborts a registered review gate when a terminal review hook fails", async (t) => {
  const { gateRegistry, runStore, runner, workspaceRoot } = createBobReviewRunner(t)
  const unhandledRejections = []
  const recordUnhandled = (reason) => { unhandledRejections.push(reason) }
  process.on("unhandledRejection", recordUnhandled)
  t.after(() => process.off("unhandledRejection", recordUnhandled))

  const execution = runner.runEngineStep("review", 0, {
    sendMessage: async (message) => {
      if (String(message).includes('status="reviewing"')) {
        throw new Error("review control delivery failed")
      }
    },
    setStepComplete: () => undefined
  })

  assert.equal(await execution, false)
  const reviewing = await waitForReviewingRun(runStore)
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(gateRegistry.isPending(workspaceRoot, reviewing.runId, "review"), false)
  assert.deepEqual(unhandledRejections, [])
})

test("Bob workflow runner opens Operation Hub when user action is required", () => {
  const source = readSrc("bobWorkflowRunner.ts")

  assert.match(source, /private async openOperationHubForRun\(run: WorkflowRunState, step: EngineStep \| undefined, reason: "stepGate" \| "paused"\): Promise<void>/)
  assert.match(source, /vscode\.commands\.executeCommand\("workflowRegister\.openOperationHub", \{ runId: run\.runId, stepId: step\?\.id, reason \}\)/)
  assert.match(source, /await this\.openOperationHubForRun\(run, step, "stepGate"\)/)
  assert.match(source, /await this\.openOperationHubForRun\(run, step, "paused"\)/)
})

test("review-gated Bob tasks use live gate acceptance before Todo-sync fallback", () => {
  const runner = readSrc("bobWorkflowRunner.ts")
  const stepReview = readSrc("commands", "stepReview.ts")

  assert.match(runner, /import \{ bobTaskSyncRegistry \} from "\.\/bobTaskSync"/)
  assert.match(runner, /const registryWorkspaceRoot = resolveWorkspaceRootIdentity\(workspaceRoot\)/)
  assert.match(runner, /bobTaskSyncRegistry\.registerTask\(registryWorkspaceRoot, run\.runId, step\.id, task\)/)
  assert.match(stepReview, /import \{ bobTaskSyncRegistry \} from "\.\.\/bobTaskSync"/)
  assert.match(stepReview, /const acceptedStepId = run\.currentStep/)
  assert.match(stepReview, orderedPattern(
    "await runStore.saveRun(accepted)",
    "options.acceptBobWorkflowGateWithMetadata?.(workspaceRoot, accepted.runId, acceptedStepId)",
    'if (gateDecision === "missing" || gateDecision === "aborted")',
    "await bobTaskSyncRegistry.reconcileRun(workspaceRoot, accepted, undefined"
  ))
})

test("Operation Hub live gate owns Bob advancement while stale gates keep Todo-sync fallback", () => {
  const stepReview = readSrc("commands", "stepReview.ts")

  assert.match(stepReview, /interface AcceptedStepResult \{[\s\S]*completedViaBobTask: boolean[\s\S]*continuationOwnedByBob: boolean[\s\S]*\}/)
  assert.match(stepReview, /let completedViaBobTask = acceptedViaLiveGate/)
  assert.match(stepReview, /const continuationOwnedByBob = acceptedViaLiveGate[\s\S]*gateAcceptance\.gate\?\.executionMode === "full"/)
  assert.match(stepReview, /if \(gateDecision === "missing" \|\| gateDecision === "aborted"\) \{[\s\S]*await bobTaskSyncRegistry\.reconcileRun\(workspaceRoot, accepted, undefined/)
  assert.match(stepReview, /completedViaBobTask = sync\.status === "synced" && sync\.appliedStepCount > 0/)
  assert.match(stepReview, /return \{ run: accepted, message, completedViaBobTask, continuationOwnedByBob, workspaceRoot, revision: snapshot\.revision \}/)
  assert.match(stepReview, /if \(completedViaBobTask\) \{/)
  assert.match(stepReview, /if \(accepted\.continuationOwnedByBob\) return accepted\.run/)
  assert.match(stepReview, orderedPattern(
    'return vscode.commands.executeCommand("workflowRegister.runNextStep", operationHubTargetForAcceptedStep(accepted))',
    "function operationHubTargetForAcceptedStep(accepted: AcceptedStepResult): OperationHubRunMutationTarget {",
    'source: "operationHub"',
    "workspaceRoot: accepted.workspaceRoot",
    "runId: accepted.run.runId",
    "expectedRevision: accepted.revision"
  ))
})

test("standalone next-step commands reuse the Bob review task agent provider", () => {
  const workflowRunCommands = readSrc("workflowRunCommands.ts")
  const runtimeFactory = readSrc("workflowRuntimeFactory.ts")

  assert.match(workflowRunCommands, /import \{ reviewTaskRegistry \} from "\.\/reviewTaskRegistry"/)
  assert.match(workflowRunCommands, orderedPattern(
    "async runNextStep(runArg?: RunCommandArg): Promise<unknown> {",
    "workflowRunExecutionActiveForWorkspace(selection.root, selection.runId)",
    "this.options.coordinateGateDecision(",
    "selection.root,",
    "selection.runId,",
    '"run-next",',
    "this.runNextStepOnce(",
    "private async runNextStepOnce(root: string, runId: string, expectedRevision?: string): Promise<unknown> {",
    "if (expectedRevision) await assertOperationHubRunRevision(root, runId, expectedRevision)",
    "const agentProvider = reviewTaskRegistry.agentProviderForRun(root, run.runId, workflow)",
    "this.options.runtimeFactory.createEngine(root, agentProvider)",
    'await this.reconcileBobTask(root, result, workflow, "operation-hub-next")'
  ))
  assert.match(workflowRunCommands, orderedPattern(
    'private async resumeOrRetryRun(mode: "resume" | "retry", runArg?: RunCommandArg): Promise<unknown> {',
    "this.options.coordinateGateDecision(",
    "selection.root,",
    "selection.runId,",
    'mode === "resume" ? "run-resume" : "run-retry",',
    "this.resumeOrRetryRunOnce(",
    "mode,",
    "selection.root,",
    "selection.runId,",
    "isOperationHubRunMutationTarget(runArg) ? runArg.expectedRevision : undefined",
    "private async resumeOrRetryRunOnce(",
    "if (expectedRevision) await assertOperationHubRunRevision(root, runId, expectedRevision)",
    "const agentProvider = reviewTaskRegistry.agentProviderForRun(root, run.runId, workflow)",
    "const engine = this.options.runtimeFactory.createEngine(root, agentProvider)",
    "mode === \"resume\" ? \"operation-hub-resume\" : \"operation-hub-retry\""
  ))
  assert.match(runtimeFactory, /createEngine\(workspaceRoot: string, agentProvider\?: AgentProvider\): WorkflowEngine/)
  assert.match(runtimeFactory, /agentProvider: agentProvider \?\? this\.options\.agentProvider\(\) \?\? this\.createCommandAgentProvider\(\)/)
})

test("Bob workflow result recovery is scoped to messages after the current step starts", () => {
  const source = readSrc("bobWorkflowRunner.ts")

  assert.match(source, /const messageStartIndex = messageStartIndexes\.get\(stepKey\(run\.runId, step\.id\)\) \?\? 0/)
  assert.match(source, /extractLastAssistantText\(task\.getMessages\?\.\(\) \?\? \[\], messageStartIndex\)/)
  assert.doesNotMatch(source, /extractLastAssistantText\(task\.getMessages\?\.\(\) \?\? \[\], 0\)/)
})

test("Engine preflight checks Bazaar repositories across multi-root workspaces", () => {
  const source = readSourceSet(["workflowRuntimeFactory.ts", "bobWorkflowRunner.ts"])

  assert.match(source, /import \{[\s\S]*findMarkerRoots[\s\S]*\} from "\.\/core\/workspaceRoots"/)
  assert.match(source, /private createPreflightChecks\(workspaceRoot: string\): NonNullable<WorkflowEngineOptions\["preflightChecks"\]>/)
  assert.match(source, /bazaarRepository: \(\) => this\.bazaarRepositoryAvailable\(workspaceRoot\)/)
  assert.match(source, /preflightChecks: this\.createPreflightChecks\(workspaceRoot\)/)
  assert.match(source, /preflightChecks: \(workspaceRoot\) => this\.createPreflightChecks\(workspaceRoot\)/)
  assert.match(source, /await findMarkerRoots\(folders, "\.bzr"\)/)
})

test("Bob adapter resolves workflow inputs and passes them to command providers", () => {
  const source = runtimeSource()

  assert.match(source, /inputs: Record<string, WorkflowInputDefinition>/)
  assert.match(source, /inputs: core\.inputs/)
  assert.match(source, /workflowRoot: core\.workflowRoot/)
  assert.match(source, orderedPattern(
    "collectBobWorkflowInputs(",
    "workflow: WorkflowDefinition,",
    "provided: Record<string, unknown>"
  ))
  assert.match(source, /extractTaskWorkflowInputs\(workflow, task\)/)
  assert.match(source, orderedPattern(
    "collectWorkflowInputsWithResolver({",
    "inputs: workflow.inputs,",
    "provided,",
    "prompt: promptForWorkflowInput",
    "})"
  ))
})

test("WorkflowRegisterService owns and exposes Bob review gates and acceptance coordination", () => {
  const service = readSrc("workflowRegisterService.ts")
  const factory = readSrc("workflowRuntimeFactory.ts")
  const extension = readSrc("extension.ts")
  const authoring = readSrc("extensionWithAuthoring.ts")
  const stepReview = readSrc("commands", "stepReview.ts")
  const workflowRunCommands = readSrc("workflowRunCommands.ts")

  assert.match(service, /private readonly bobWorkflowGates = new BobWorkflowGateRegistry\(\)/)
  assert.match(service, /private readonly reviewAcceptances = new ReviewAcceptanceCoordinator\(\)/)
  assert.match(service, /gateRegistry: this\.bobWorkflowGates/)
  assert.match(service, /acceptBobWorkflowGate\(workspaceRoot: string, runId: string, stepId: string\): BobWorkflowGateAcceptResult \{[\s\S]*this\.bobWorkflowGates\.accept\(workspaceRoot, runId, stepId\)/)
  assert.match(service, /acceptBobWorkflowGateWithMetadata\(workspaceRoot: string, runId: string, stepId: string\): BobWorkflowGateAcceptance \{[\s\S]*this\.bobWorkflowGates\.acceptWithMetadata\(workspaceRoot, runId, stepId\)/)
  assert.match(service, /coordinateReviewAcceptance<T>\([\s\S]*this\.reviewAcceptances\.coordinate\(workspaceRoot, runId, "review-accept", operation\)/)
  assert.match(service, /coordinateGateDecision: \(workspaceRoot, runId, kind, operation\) => \([\s\S]*this\.reviewAcceptances\.coordinate\(workspaceRoot, runId, kind, operation\)/)
  assert.match(workflowRunCommands, /coordinateGateDecision\(selection\.root, selection\.runId, "checkpoint-approve", async \(\) =>/)
  assert.match(workflowRunCommands, /coordinateGateDecision\(selection\.root, selection\.runId, "checkpoint-abort", async \(\) =>/)
  assert.match(factory, /gateRegistry: BobWorkflowGateRegistry/)
  assert.match(factory, /gateRegistry: this\.options\.gateRegistry/)
  assert.match(extension, /acceptBobWorkflowGate: \(workspaceRoot: string, runId: string, stepId: string\) => BobWorkflowGateAcceptResult/)
  assert.match(extension, /acceptBobWorkflowGateWithMetadata: \(workspaceRoot: string, runId: string, stepId: string\) => BobWorkflowGateAcceptance/)
  assert.match(extension, /acceptBobWorkflowGate: \(workspaceRoot, runId, stepId\) => service\.acceptBobWorkflowGate\(workspaceRoot, runId, stepId\)/)
  assert.match(extension, /acceptBobWorkflowGateWithMetadata: \(workspaceRoot, runId, stepId\) => service\.acceptBobWorkflowGateWithMetadata\(workspaceRoot, runId, stepId\)/)
  assert.match(extension, /coordinateReviewAcceptance: <T>\(workspaceRoot: string, runId: string, operation: \(\) => Promise<T>\) => Promise<T>/)
  assert.match(extension, /coordinateReviewAcceptance: \(workspaceRoot, runId, operation\) => service\.coordinateReviewAcceptance\(workspaceRoot, runId, operation\)/)
  assert.match(authoring, /acceptBobWorkflowGate: api\.acceptBobWorkflowGate/)
  assert.match(authoring, /acceptBobWorkflowGateWithMetadata: api\.acceptBobWorkflowGateWithMetadata/)
  assert.match(authoring, /coordinateReviewAcceptance: api\.coordinateReviewAcceptance/)
  assert.match(stepReview, orderedPattern(
    "options.coordinateReviewAcceptance(",
    "selection.root,",
    "selection.runId,",
    "() => acceptReviewedStepOnce(",
    "options,",
    "selection.root,",
    "selection.runId,",
    "isOperationHubRunMutationTarget(runArg) ? runArg.expectedRevision : undefined"
  ))
  assert.match(stepReview, /if \(expectedRevision\) await assertOperationHubRunRevision\(workspaceRoot, runId, expectedRevision\)/)
  assert.doesNotMatch(stepReview, /reviewAcceptancesInFlight/)
})

test("WorkflowRegisterService disposes pending gates before source deactivation", () => {
  const source = readSrc("workflowRegisterService.ts")

  assert.match(source, orderedPattern(
    "this.manualStepPanel.dispose()",
    "this.bobWorkflowGates.dispose()",
    "deactivateRegisteredSource(source)"
  ))
})
