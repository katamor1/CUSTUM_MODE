const assert = require("node:assert/strict")
const { test } = require("node:test")
const { readSourceSet, readSrc } = require("./helpers/sourceReader")

function runtimeSource() {
  return readSourceSet([
    "workflowAdapter.ts",
    "workflowRuntimeFactory.ts",
    "bobWorkflowRunner.ts",
    "bobStepRuntime.ts",
    "bobWorkflowMessages.ts",
    "core/engine/stepExecutor.ts"
  ])
}

function orderedPattern(...parts) {
  return new RegExp(parts.map(escapeRegex).join("[\\s\\S]*"))
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

test("Bob adapter keeps task inputs, run id, and state wired into the runner", () => {
  const source = runtimeSource()

  assert.match(source, /createBobWorkflowRunner\(workflow: WorkflowDefinition\): BobWorkflowEngineRunner/)
  assert.match(source, orderedPattern(
    "inputsProvider: (task, provided) => this.options.inputsProvider(workflow, {",
    "...extractTaskWorkflowInputs(workflow, task)",
    "...provided",
    "})"
  ))
  assert.match(source, /runId: run\.runId/)
  assert.match(source, /state: run\.state/)
  assert.doesNotMatch(source, /inputs: \{\}/)
})

test("Bob workflow chat messages include bounded workflow root context", () => {
  const source = readSrc("bobWorkflowMessages.ts")

  assert.match(source, /appendWorkflowContext/)
  assert.match(source, /appendWorkflowStateDataBlock/)
  assert.match(source, orderedPattern(
    "appendWorkflowContext(lines, {",
    "workflowRoot: definition.workflowRoot",
    "workflowFile: definition.workflowFile",
    "workflowFolderName: definition.workflowFolderName",
    "stateEntries",
    "})"
  ))
  assert.match(source, /buildCommandResultMessage\(definition, todo, index, commandResult, stateEntries\)/)
  assert.match(source, /buildCurrentTodoMessage\(definition, todo, index, stepDefinition, commandResult, stateEntries\)/)
})

test("Bob adapter applies guardrails to Todo, result, and legacy top-level commands", () => {
  const source = runtimeSource()
  const stepExecutor = readSrc("core", "engine", "stepExecutor.ts")

  assert.match(source, /import \{ validateCommandGuardrails \} from "\.\/core\/guardrails"/)
  assert.match(stepExecutor, /import \{ validateCommandGuardrails \} from "\.\.\/guardrails"/)
  assert.match(source, /guardrails: WorkflowGuardrailsDefinition/)
  assert.match(source, /guardrails: core\.guardrails/)
  assert.match(stepExecutor, /const args = renderValue\(step\.action\.args,/)
  assert.match(stepExecutor, /validateCommandGuardrails\(workflow, step\.action\.provider, args\)/)
  assert.match(source, /validateCommandGuardrails\(\{ guardrails: active\.guardrails \}, step\.resultCommand\)/)
  assert.match(source, /actionRegistry: this\.options\.actionRegistry/)
  assert.doesNotMatch(source, /vscode\.commands\.executeCommand\(definition\.command/)
})

test("Bob manual completion opens a panel without bypassing the held completion path", () => {
  const source = runtimeSource()

  assert.match(source, /manualCompletion: async \(\{ run, step \}\) => \{/)
  assert.match(source, /this\.options\.stepRuntime\.hold\(/)
  assert.match(source, /onHeldStep: \(active\) => this\.options\.onManualStepHeld\?\.\(\{ workflow: this\.options\.coreWorkflow, run, step, active \}\)/)
  assert.match(source, /completeStepByKey\(key: string/)
  assert.match(source, /captureHeldStepResult\(active\)/)
  assert.match(source, /active\.task\.setStepComplete\?\.\(\)/)
})
