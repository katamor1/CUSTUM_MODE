const assert = require("node:assert/strict")
const { test } = require("node:test")
const { readSourceSet, readSrc } = require("./helpers/sourceReader")

function runtimeSource() {
  return readSourceSet([
    "extension.ts",
    "workflowRuntimeFactory.ts",
    "workflowAdapter.ts",
    "bobWorkflowTypes.ts",
    "bobWorkflowRunner.ts",
    "bobStepRuntime.ts",
    "bobTaskSync.ts",
    "bobWorkflowMessages.ts",
    "reviewTaskRegistry.ts",
    "webview/manualStepPanel.ts",
    "workflowInputPrompt.ts",
    "workflowRegisterService.ts",
    "workflowRunCommands.ts",
    "core/engine.ts",
    "core/engine/stepExecutor.ts"
  ])
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
  assert.match(source, /async runWorkflow\(workflowId\?: string, inputs: Record<string, unknown> = \{\}\): Promise<unknown> \{[\s\S]*requireTrustedWorkspace\("run workflow"\)/)
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
  assert.match(source, /run\.status === "checkpoint"/)
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

test("Bob workflow runner opens Operation Hub when user action is required", () => {
  const source = readSrc("bobWorkflowRunner.ts")

  assert.match(source, /private async openOperationHubForRun\(run: WorkflowRunState, step: EngineStep \| undefined, reason: "stepGate" \| "paused"\): Promise<void>/)
  assert.match(source, /vscode\.commands\.executeCommand\("workflowRegister\.openOperationHub", \{ runId: run\.runId, stepId: step\?\.id, reason \}\)/)
  assert.match(source, /await this\.openOperationHubForRun\(run, step, "stepGate"\)/)
  assert.match(source, /await this\.openOperationHubForRun\(run, step, "paused"\)/)
})

test("review-gated Bob tasks are reconciled when Operation Hub accepts the step", () => {
  const runner = readSrc("bobWorkflowRunner.ts")
  const stepReview = readSrc("commands", "stepReview.ts")

  assert.match(runner, /import \{ bobTaskSyncRegistry \} from "\.\/bobTaskSync"/)
  assert.match(runner, /bobTaskSyncRegistry\.registerTask\(run\.runId, step\.id, task\)/)
  assert.match(stepReview, /import \{ bobTaskSyncRegistry \} from "\.\.\/bobTaskSync"/)
  assert.match(stepReview, /const acceptedStepId = run\.currentStep/)
  assert.match(stepReview, /await bobTaskSyncRegistry\.reconcileRun\(accepted, undefined/)
})

test("Operation Hub accept-and-run-next lets Bob task advance instead of standalone agent execution", () => {
  const stepReview = readSrc("commands", "stepReview.ts")

  assert.match(stepReview, /interface AcceptedStepResult \{[\s\S]*completedViaBobTask: boolean[\s\S]*\}/)
  assert.match(stepReview, /const sync = await bobTaskSyncRegistry\.reconcileRun\(accepted, undefined/)
  assert.match(stepReview, /const completedViaBobTask = sync\.status === "synced" && sync\.appliedStepCount > 0/)
  assert.match(stepReview, /return \{ run: accepted, message, completedViaBobTask \}/)
  assert.match(stepReview, /if \(completedViaBobTask\) \{/)
  assert.match(stepReview, /vscode\.commands\.executeCommand\("workflowRegister\.runNextStep", accepted\.run\.runId\)/)
})

test("standalone next-step commands reuse the Bob review task agent provider", () => {
  const workflowRunCommands = readSrc("workflowRunCommands.ts")
  const runtimeFactory = readSrc("workflowRuntimeFactory.ts")

  assert.match(workflowRunCommands, /import \{ reviewTaskRegistry \} from "\.\/reviewTaskRegistry"/)
  assert.match(workflowRunCommands, /const agentProvider = reviewTaskRegistry\.agentProviderForRun\(run\.runId, workflow\)/)
  assert.match(workflowRunCommands, /this\.options\.runtimeFactory\.createEngine\(selection\.root, agentProvider\)/)
  assert.match(workflowRunCommands, /await this\.reconcileBobTask\(selection\.root, result, workflow, "operation-hub-next"\)/)
  assert.match(workflowRunCommands, orderedPattern(
    'private async resumeOrRetryRun(mode: "resume" | "retry", runId?: string): Promise<unknown> {',
    "const agentProvider = reviewTaskRegistry.agentProviderForRun(run.runId, workflow)",
    "const engine = this.options.runtimeFactory.createEngine(selection.root, agentProvider)",
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