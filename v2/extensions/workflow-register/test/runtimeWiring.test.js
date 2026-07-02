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
    "bobWorkflowMessages.ts",
    "core/engine.ts"
  ])
}

test("completeStep command can be called silently by companion extensions", () => {
  const source = runtimeSource()

  assert.match(source, /interface StepCompletionOptions \{[\s\S]*silent\?: boolean[\s\S]*\}/)
  assert.match(source, /registerCommand\("workflowRegister\.completeStep", \(options\?: StepCompletionOptions\) => service\.completeCurrentStep\(options\)\)/)
  assert.match(source, /async completeCurrentStep\(options: StepCompletionOptions = \{\}\): Promise<string>/)
  assert.match(source, /if \(!options\.silent\) await vscode\.window\.showInformationMessage\(message\)/)
  assert.match(source, /return message/)
})

test("activation schedules delayed workflow reload retries after Bob finishes startup", () => {
  const source = readSrc("extension.ts")

  assert.match(source, /const retryDelaysMs = \[3000, 10000\]/)
  assert.match(source, /setTimeout\([\s\S]*service\.reload\(\{ showReport: false \}\)/)
})

test("standalone workflow launcher wires an AgentProvider through API or configured command", () => {
  const source = runtimeSource()

  assert.match(source, /import \{ createCommandAgentProvider \} from "\.\/core\/agentProvider"/)
  assert.match(source, /registerAgentProvider: \(provider: AgentProvider\) => void/)
  assert.match(source, /registerAgentProvider: \(provider\) => service\.registerAgentProvider\(provider\)/)
  assert.match(source, /agentProvider: this\.options\.agentProvider\(\) \?\? this\.createCommandAgentProvider\(\)/)
  assert.match(source, /createCommandAgentProvider\(\{[\s\S]*command: config\.get<string>\("agentCommand", ""\),[\s\S]*vscode\.commands\.executeCommand\(command, input\)/)
})

test("standalone workflow launcher uses the shared input resolver for conditional prompts", () => {
  const source = runtimeSource()

  assert.match(source, /import \{ collectWorkflowInputsWithResolver \} from "\.\/core\/inputCollector"/)
  assert.match(source, /return collectWorkflowInputsWithResolver\(\{[\s\S]*inputs: workflow\.inputs,[\s\S]*provided,[\s\S]*prompt: \(key, definition, required\) => this\.promptForInput\(key, definition, required\)[\s\S]*\}\)/)
  assert.doesNotMatch(source, /for \(const \[key, definition\] of Object\.entries\(workflow\.inputs\)\)/)
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
  assert.match(source, /runTodoStep\(todo: WorkflowTodoItem, index: number, task: BobWorkflowTask\): Promise<boolean> \{[\s\S]*executionMode: "singleStep"[\s\S]*stepId: todo\.id/)
  assert.match(source, /engine\.runWorkflow\(this\.options\.coreWorkflow, inputs, \{[\s\S]*executionMode: request\.executionMode[\s\S]*stepId: request\.stepId[\s\S]*\}\)/)
  assert.match(source, /createBobTaskSnapshotProvider\(task\)/)
  assert.match(source, /new FileTaskSnapshotStore\(/)
  assert.doesNotMatch(source, /async function runWorkflowStepCommand\(/)
  assert.doesNotMatch(source, /step\.command === "bobBazaar\./)
  assert.doesNotMatch(source, /Unsupported step command\. Add it to the workflow-register allowlist before use\./)
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
  assert.match(source, /collectBobWorkflowInputs\(workflow: WorkflowDefinition, provided: Record<string, unknown>\)/)
  assert.match(source, /extractTaskWorkflowInputs\(workflow, task\)/)
  assert.match(source, /collectWorkflowInputsWithResolver\(\{[\s\S]*inputs: workflow\.inputs,[\s\S]*provided,[\s\S]*prompt: \(key, definition, required\) => this\.promptForInput\(key, definition, required\)[\s\S]*\}\)/)
  assert.match(source, /createBobWorkflowRunner\(workflow: WorkflowDefinition\): BobWorkflowEngineRunner/)
  assert.match(source, /inputsProvider: \(task, provided\) => this\.options\.inputsProvider\(workflow, \{[\s\S]*\.\.\.extractTaskWorkflowInputs\(workflow, task\)[\s\S]*\.\.\.provided[\s\S]*\}\)/)
  assert.match(source, /runId: run\.runId/)
  assert.match(source, /state: run\.state/)
  assert.doesNotMatch(source, /inputs: \{\}/)
})

test("Bob workflow chat messages include bounded workflow root context", () => {
  const source = readSrc("bobWorkflowMessages.ts")

  assert.match(source, /import \{ appendWorkflowContext \} from "\.\/workflowPromptContext"/)
  assert.match(source, /appendWorkflowContext\(lines, \{[\s\S]*workflowRoot: definition\.workflowRoot[\s\S]*workflowFile: definition\.workflowFile[\s\S]*workflowFolderName: definition\.workflowFolderName[\s\S]*stateEntries[\s\S]*\}\)/)
  assert.match(source, /buildCommandResultMessage\(definition, todo, index, commandResult, stateEntries\)/)
  assert.match(source, /buildCurrentTodoMessage\(definition, todo, index, stepDefinition, commandResult, stateEntries\)/)
})

test("Bob adapter applies guardrails to Todo, result, and legacy top-level commands", () => {
  const source = runtimeSource()
  const engine = readSrc("core", "engine.ts")

  assert.match(source, /import \{ validateCommandGuardrails \} from "\.\/core\/guardrails"/)
  assert.match(engine, /import \{ validateCommandGuardrails \} from "\.\/guardrails"/)
  assert.match(source, /guardrails: WorkflowGuardrailsDefinition/)
  assert.match(source, /guardrails: core\.guardrails/)
  assert.match(engine, /validateCommandGuardrails\(workflow, step\.action\.provider\)/)
  assert.match(source, /validateCommandGuardrails\(\{ guardrails: active\.guardrails \}, step\.resultCommand\)/)
  assert.match(source, /actionRegistry: this\.options\.actionRegistry/)
  assert.doesNotMatch(source, /vscode\.commands\.executeCommand\(definition\.command/)
})
