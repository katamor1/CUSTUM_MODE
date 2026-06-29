const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "workflow-register-"))
}

test("v1 workflow parser accepts inputs, execution contract metadata, typed steps, and result sinks", () => {
  const { parseWorkflowMarkdown } = require("../out/core/parser")

  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: "C:/repo/.bob/workflows/sample/WORKFLOW.md",
    text: `---
schemaVersion: workflow-register/v1
name: sample
description: Sample workflow.
title: Sample Workflow
mode: sample-reviewer
category: code-review
permissions:
  - read
requires:
  workspace: true
  bob:
    minVersion: "2.0.0"
  files:
    - .bob/skills/sample/SKILL.md
inputs:
  revision:
    type: string
    title: Revision
    required: true
  target:
    type: select
    title: Target
    requiredWhen: "inputs.revision != ''"
    options:
      - trunk
      - branch
preflight:
  - id: check-workspace
    title: Check workspace
    required: true
    checks:
      - workspaceOpen
    files:
      - .bob/skills/sample/SKILL.md
    failurePolicy: stop
tools:
  sample.collect:
    purpose: Collect context.
    required: true
    outputKey: reviewContext
    failurePolicy: stop
guardrails:
  allowedCommands:
    - sample.collect
  deniedCommands:
    - shell
  requireApproval:
    - id: large-review
      when: "state.changedFiles > 100"
      message: Large review detected.
artifacts:
  - id: reviewContext
    producedBy: collect
    path: .bob/workflows/runs/{{run.id}}/steps/collect.json
completion:
  summary: markdown
  includeArtifacts: true
  validateResult: true
  visualization:
    type: mermaid
    enabled: true
steps:
  - id: collect
    title: Collect context
    type: command
    action:
      provider: sample.collect
      args:
        revision: "{{inputs.revision}}"
    resultKey: reviewContext
  - id: save
    title: Save context
    type: result
    result:
      source: state
      stateKey: reviewContext
      sinks:
        - type: file
          path: ".bob/workflows/runs/{{run.id}}/steps/save.result.json"
---
# Sample
`
  })

  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  assert.equal(parsed.workflow.schemaVersion, "workflow-register/v1")
  assert.equal(parsed.workflow.mode, "sample-reviewer")
  assert.equal(parsed.workflow.category, "code-review")
  assert.equal(parsed.workflow.requires.workspace, true)
  assert.equal(parsed.workflow.requires.bob.minVersion, "2.0.0")
  assert.equal(parsed.workflow.inputs.revision.type, "string")
  assert.equal(parsed.workflow.inputs.target.requiredWhen, "inputs.revision != ''")
  assert.equal(parsed.workflow.preflight[0].id, "check-workspace")
  assert.equal(parsed.workflow.tools["sample.collect"].outputKey, "reviewContext")
  assert.equal(parsed.workflow.guardrails.allowedCommands[0], "sample.collect")
  assert.equal(parsed.workflow.guardrails.requireApproval[0].id, "large-review")
  assert.equal(parsed.workflow.artifacts[0].id, "reviewContext")
  assert.equal(parsed.workflow.completion.visualization.type, "mermaid")
  assert.equal(parsed.workflow.engineSteps.length, 2)
  assert.equal(parsed.workflow.engineSteps[0].type, "command")
  assert.equal(parsed.workflow.engineSteps[0].action.provider, "sample.collect")
  assert.equal(parsed.workflow.engineSteps[1].type, "result")
  assert.equal(parsed.workflow.engineSteps[1].result.sinks[0].type, "file")
})

test("v1 workflow parser preserves Bob adapter metadata from typed steps", () => {
  const { parseWorkflowMarkdown } = require("../out/core/parser")

  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: "C:/repo/.bob/workflows/bazaar/WORKFLOW.md",
    text: `---
schemaVersion: workflow-register/v1
name: bazaar
description: Bazaar workflow.
title: Bazaar Workflow
mode: agent
todo: true
todoAsSteps: true
stepCompletion: manual
stepMessage: step
autoApproval: true
workspaceRequired: true
steps:
  - id: collect-context
    title: Collect context
    type: command
    action:
      provider: bobBazaar.collectReviewContext
    prompt: |
      Summarize the Bazaar context.
    sendResult: true
    completeOnSuccess: true
    resultKey: reviewContext
    maxResultBytes: 1234
  - id: output-result
    title: Output result
    type: agent
    prompt: |
      Produce final JSON.
    includeState:
      - reviewContext
    stateRequired: true
    resultKey: reviewResult
    result:
      source: agent
      sinks:
        - type: command
          command: bobBazaar.captureReviewResult
---
# Bazaar
`
  })

  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  assert.equal(parsed.workflow.todoEnabled, true)
  assert.equal(parsed.workflow.todoAsSteps, true)
  assert.equal(parsed.workflow.stepCompletion, "manual")
  assert.equal(parsed.workflow.stepMessage, "step")
  assert.deepEqual(parsed.workflow.todos.map((todo) => todo.id), ["collect-context", "output-result"])
  assert.equal(parsed.workflow.engineSteps[0].prompt.trim(), "Summarize the Bazaar context.")
  assert.equal(parsed.workflow.engineSteps[0].sendResult, true)
  assert.equal(parsed.workflow.engineSteps[0].completeOnSuccess, true)
  assert.equal(parsed.workflow.engineSteps[0].maxResultBytes, 1234)
  assert.deepEqual(parsed.workflow.engineSteps[1].includeState, ["reviewContext"])
  assert.equal(parsed.workflow.engineSteps[1].stateRequired, true)
})

test("workflow parser preserves top-level command metadata for legacy Bob adapters", () => {
  const { parseWorkflowMarkdown } = require("../out/core/parser")

  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: "C:/repo/.bob/workflows/command/WORKFLOW.md",
    text: `---
schemaVersion: workflow-register/v1
name: command
description: Command workflow.
command: sample.open
commandArgs:
  - first
  - second
---
# Command
`
  })

  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  assert.equal(parsed.workflow.command, "sample.open")
  assert.deepEqual(parsed.workflow.commandArgs, ["first", "second"])
})

test("v1 workflow parser keeps legacy todo workflow-step sections executable when front matter steps are absent", () => {
  const { parseWorkflowMarkdown } = require("../out/core/parser")

  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: "C:/repo/.bob/workflows/bazaar/WORKFLOW.md",
    text: `---
schemaVersion: workflow-register/v1
name: bazaar
description: Bazaar workflow.
todoSource: yaml
todos:
  - review-input: Confirm target.
  - collect-context: Collect context.
  - output-result: Save result.
---
# Bazaar

## Step: review-input

\`\`\`workflow-step
command: bobBazaar.openReviewGui
sendResult: false
\`\`\`

Confirm.

## Step: collect-context

\`\`\`workflow-step
command: bobBazaar.collectReviewContext
commandArgs:
  - "{{inputs.revision}}"
resultKey: reviewContext
\`\`\`

Collect.

## Step: output-result

\`\`\`workflow-step
includeState:
  - reviewContext
runAgent: true
captureResult: true
resultCommand: bobBazaar.captureReviewResult
\`\`\`

Output.
`
  })

  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  assert.equal(parsed.workflow.engineSteps.length, 3)
  assert.equal(parsed.workflow.engineSteps[0].type, "command")
  assert.equal(parsed.workflow.engineSteps[0].action.provider, "bobBazaar.openReviewGui")
  assert.equal(parsed.workflow.engineSteps[1].type, "command")
  assert.equal(parsed.workflow.engineSteps[1].resultKey, "reviewContext")
  assert.equal(parsed.workflow.engineSteps[2].type, "agent")
  assert.equal(parsed.workflow.engineSteps[2].result.sinks[0].type, "command")
})

test("v1 workflow parser reports schema validation errors", () => {
  const { parseWorkflowMarkdown } = require("../out/core/parser")

  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: "C:/repo/.bob/workflows/bad/WORKFLOW.md",
    text: `---
schemaVersion: workflow-register/v1
name: bad
steps:
  - id: missing-title
    type: command
---
# Bad
`
  })

  assert.equal(parsed.ok, false)
  assert.match(parsed.diagnostics.join("\n"), /description/)
  assert.match(parsed.diagnostics.join("\n"), /action/)
})

test("v1 workflow parser warns about unknown top-level fields without rejecting the workflow", () => {
  const { parseWorkflowMarkdown } = require("../out/core/parser")

  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: "C:/repo/.bob/workflows/warn/WORKFLOW.md",
    text: `---
schemaVersion: workflow-register/v1
name: warn
description: Warn workflow.
permissons:
  - read
steps: []
---
# Warn
`
  })

  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  assert.match(parsed.diagnostics.join("\n"), /unknown top-level field 'permissons'/)
})

test("action registry executes registered providers and rejects unknown providers", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const registry = new ActionRegistry()
  registry.register({
    id: "sample.collect",
    execute: async ({ args, inputs }) => ({ revision: args.revision, target: inputs.target })
  })

  const ok = await registry.execute("sample.collect", {
    args: { revision: "42" },
    inputs: { target: "trunk" }
  })
  const missing = await registry.execute("sample.missing", { args: {}, inputs: {} })

  assert.equal(ok.ok, true)
  assert.deepEqual(ok.value, { revision: "42", target: "trunk" })
  assert.equal(missing.ok, false)
  assert.match(missing.error, /Unsupported action provider/)
})

test("result sink registry writes command and file sinks with allowlist enforcement", async () => {
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const workspaceRoot = tempDir()
  const calls = []
  const registry = createDefaultResultSinkRegistry({
    workspaceRoot,
    executeCommand: async (...args) => {
      calls.push(args)
      return { status: "ok" }
    },
    allowedCommandSinks: ["bobBazaar.captureReviewResult"]
  })

  const commandResult = await registry.write({
    type: "command",
    command: "bobBazaar.captureReviewResult",
    args: ["extra"]
  }, {
    workflowId: "workflow-register.sample",
    runId: "run-1",
    stepId: "save",
    text: "{\"ok\":true}"
  })
  const rejected = await registry.write({
    type: "command",
    command: "workbench.action.files.save"
  }, {
    workflowId: "workflow-register.sample",
    runId: "run-1",
    stepId: "save",
    text: "unused"
  })
  const fileResult = await registry.write({
    type: "file",
    path: ".bob/workflows/runs/{{run.id}}/steps/{{step.id}}.result.json"
  }, {
    workflowId: "workflow-register.sample",
    runId: "run-1",
    stepId: "save",
    text: "{\"ok\":true}"
  })

  assert.equal(commandResult.ok, true)
  assert.deepEqual(calls, [["bobBazaar.captureReviewResult", "{\"ok\":true}", "extra"]])
  assert.equal(rejected.ok, false)
  assert.match(rejected.error, /Unsupported result command/)
  assert.equal(fileResult.ok, true)
  assert.equal(fs.readFileSync(path.join(workspaceRoot, ".bob", "workflows", "runs", "run-1", "steps", "save.result.json"), "utf8"), "{\"ok\":true}")
})

test("workflow engine runs command and file-result steps without Bob and persists run state", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const actions = new ActionRegistry()
  actions.register({
    id: "sample.collect",
    execute: async ({ args }) => ({ revision: args.revision, status: "ready" })
  })
  const sinks = createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined })
  const runStore = new FileRunStateStore({ workspaceRoot, now: () => "2026-06-28T00:00:00.000Z", engineVersion: "test-engine" })
  const engine = new WorkflowEngine({ actions, resultSinks: sinks, runStore })

  const workflow = {
    id: "workflow-register.sample",
    name: "sample",
    label: "Sample",
    schemaVersion: "workflow-register/v1",
    definitionHash: "sha256:test-hash",
    filePath: ".bob/workflows/sample/WORKFLOW.md",
    inputs: { revision: { type: "string", required: true } },
    engineSteps: [
      {
        id: "collect",
        title: "Collect",
        type: "command",
        action: { provider: "sample.collect", args: { revision: "{{inputs.revision}}" } },
        resultKey: "reviewContext"
      },
      {
        id: "save",
        title: "Save",
        type: "result",
        result: {
          source: "state",
          stateKey: "reviewContext",
          sinks: [{ type: "file", path: ".bob/workflows/runs/{{run.id}}/steps/save.result.json" }]
        }
      }
    ]
  }

  const run = await engine.runWorkflow(workflow, { revision: "77" })
  const saved = JSON.parse(fs.readFileSync(path.join(workspaceRoot, ".bob", "workflows", "runs", run.runId, "run.json"), "utf8"))
  const resultPath = path.join(workspaceRoot, ".bob", "workflows", "runs", run.runId, "steps", "save.result.json")

  assert.equal(run.status, "completed")
  assert.equal(saved.status, "completed")
  assert.equal(saved.workflowSchemaVersion, "workflow-register/v1")
  assert.equal(saved.workflowDefinitionHash, "sha256:test-hash")
  assert.equal(saved.workflowFile, ".bob/workflows/sample/WORKFLOW.md")
  assert.equal(saved.engineVersion, "test-engine")
  assert.equal(saved.steps.map((step) => step.status).join(","), "completed,completed")
  assert.equal(JSON.parse(fs.readFileSync(resultPath, "utf8")).revision, "77")
})

test("workflow engine fails command steps when providers return structured error results", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const actions = new ActionRegistry()
  actions.register({
    id: "sample.validate",
    execute: async () => ({ status: "error", errors: ["Invalid YAML: missing bob-output.yaml"] })
  })
  const sinks = createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined })
  const runStore = new FileRunStateStore({ workspaceRoot, now: () => "2026-06-28T00:00:00.000Z", engineVersion: "test-engine" })
  const engine = new WorkflowEngine({ actions, resultSinks: sinks, runStore })

  const workflow = {
    id: "workflow-register.structured-error",
    name: "structured-error",
    label: "Structured Error",
    schemaVersion: "workflow-register/v1",
    filePath: ".bob/workflows/structured-error/WORKFLOW.md",
    inputs: {},
    engineSteps: [
      {
        id: "validate",
        title: "Validate",
        type: "command",
        action: { provider: "sample.validate" },
        resultKey: "validationResult"
      },
      {
        id: "next",
        title: "Next",
        type: "command",
        action: { provider: "sample.next" }
      }
    ]
  }

  const run = await engine.runWorkflow(workflow, {})

  assert.equal(run.status, "failed")
  assert.equal(run.currentStep, "validate")
  assert.equal(run.steps[0].status, "failed")
  assert.equal(run.steps[1].status, "pending")
  assert.match(run.error, /Invalid YAML: missing bob-output.yaml/)
  assert.equal(run.state.validationResult, undefined)
})

test("workflow engine runs agent steps through an AgentProvider and can hand off the agent text", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const runStore = new FileRunStateStore({ workspaceRoot, now: () => "2026-06-28T00:00:00.000Z" })
  const agentCalls = []
  const engine = new WorkflowEngine({
    actions: new ActionRegistry(),
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore,
    agentProvider: {
      run: async (input) => {
        agentCalls.push(input)
        return `agent output for ${input.inputs.revision}`
      }
    }
  })
  const workflow = {
    id: "workflow-register.agent",
    name: "agent",
    label: "Agent",
    description: "Agent workflow",
    schemaVersion: "workflow-register/v1",
    inputs: { revision: { type: "string", required: true } },
    engineSteps: [
      {
        id: "analyze",
        title: "Analyze",
        type: "agent",
        prompt: "Analyze {{inputs.revision}}",
        resultKey: "analysis",
        result: {
          source: "agent",
          sinks: [{ type: "file", path: ".bob/workflows/runs/{{run.id}}/steps/analyze.txt" }]
        }
      }
    ]
  }

  const run = await engine.runWorkflow(workflow, { revision: "88" })
  const outputPath = path.join(workspaceRoot, ".bob", "workflows", "runs", run.runId, "steps", "analyze.txt")

  assert.equal(run.status, "completed")
  assert.equal(run.state.analysis, "agent output for 88")
  assert.equal(agentCalls[0].prompt, "Analyze 88")
  assert.equal(fs.readFileSync(outputPath, "utf8"), "agent output for 88")
})

test("workflow engine rejects invalid input values before running steps", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const calls = []
  const actions = new ActionRegistry()
  actions.register({ id: "sample.collect", execute: async () => calls.push("ran") })
  const engine = new WorkflowEngine({
    actions,
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore: new FileRunStateStore({ workspaceRoot, now: () => "2026-06-28T00:00:00.000Z" })
  })
  const workflow = {
    id: "workflow-register.inputs",
    name: "inputs",
    label: "Inputs",
    description: "Inputs workflow",
    schemaVersion: "workflow-register/v1",
    inputs: {
      count: { type: "number", required: true },
      mode: { type: "select", required: true, options: ["fast", "safe"] }
    },
    engineSteps: [
      { id: "collect", title: "Collect", type: "command", action: { provider: "sample.collect" } }
    ]
  }

  const run = await engine.runWorkflow(workflow, { count: "abc", mode: "unsafe" })

  assert.equal(run.status, "failed")
  assert.match(run.error, /Workflow input must be a number: count/)
  assert.match(run.error, /Workflow input has an unsupported option: mode/)
  assert.deepEqual(calls, [])
})

test("workflow engine records result-source failures in run state", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const runStore = new FileRunStateStore({ workspaceRoot, now: () => "2026-06-28T00:00:00.000Z" })
  const engine = new WorkflowEngine({
    actions: new ActionRegistry(),
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore
  })
  const workflow = {
    id: "workflow-register.missing-state",
    name: "missing-state",
    label: "Missing State",
    description: "Missing state workflow",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    engineSteps: [
      {
        id: "save",
        title: "Save",
        type: "result",
        result: {
          source: "state",
          stateKey: "missing",
          sinks: [{ type: "file", path: ".bob/workflows/runs/{{run.id}}/steps/save.txt" }]
        }
      }
    ]
  }

  const run = await engine.runWorkflow(workflow, {})
  const saved = JSON.parse(fs.readFileSync(path.join(workspaceRoot, ".bob", "workflows", "runs", run.runId, "run.json"), "utf8"))

  assert.equal(run.status, "failed")
  assert.match(run.error, /Workflow state is missing: missing/)
  assert.equal(saved.status, "failed")
  assert.equal(saved.currentStep, "save")
  assert.equal(saved.steps[0].status, "failed")
  assert.match(saved.steps[0].error, /Workflow state is missing: missing/)
})

test("workflow engine holds manual steps and resumes them", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const runStore = new FileRunStateStore({ workspaceRoot, now: () => "2026-06-28T00:00:00.000Z" })
  const engine = new WorkflowEngine({
    actions: new ActionRegistry(),
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore
  })
  const workflow = {
    id: "workflow-register.manual",
    name: "manual",
    label: "Manual",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    engineSteps: [
      { id: "approve", title: "Approve", type: "manual" },
      { id: "write", title: "Write", type: "result", result: { source: "literal", text: "done", sinks: [{ type: "file", path: ".bob/workflows/runs/{{run.id}}/steps/write.txt" }] } }
    ]
  }

  const held = await engine.runWorkflow(workflow, {})
  const resumed = await engine.resumeRun(held.runId, { workflow, completeHeldStep: true })

  assert.equal(held.status, "held")
  assert.equal(held.currentStep, "approve")
  assert.equal(resumed.status, "completed")
  assert.equal(fs.readFileSync(path.join(workspaceRoot, ".bob", "workflows", "runs", held.runId, "steps", "write.txt"), "utf8"), "done")
})

test("workflow engine validates requiredWhen inputs and select options", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const engine = new WorkflowEngine({
    actions: new ActionRegistry(),
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore: new FileRunStateStore({ workspaceRoot, now: () => "2026-06-28T00:00:00.000Z" })
  })
  const workflow = {
    id: "workflow-register.inputs",
    name: "inputs",
    label: "Inputs",
    schemaVersion: "workflow-register/v1",
    inputs: {
      mode: { type: "select", required: true, options: ["single", "range"] },
      revision: { type: "string", requiredWhen: "inputs.mode == 'single'" }
    },
    engineSteps: []
  }

  const missing = await engine.runWorkflow(workflow, { mode: "single" })
  const invalid = await engine.runWorkflow(workflow, { mode: "bad", revision: "1" })

  assert.equal(missing.status, "failed")
  assert.match(missing.error, /revision/)
  assert.equal(invalid.status, "failed")
  assert.match(invalid.error, /unsupported option/)
})

test("workflow engine enforces preflight checks, guardrails, and artifact writes", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  fs.mkdirSync(path.join(workspaceRoot, ".bob", "skills", "sample"), { recursive: true })
  fs.writeFileSync(path.join(workspaceRoot, ".bob", "skills", "sample", "SKILL.md"), "# Sample\n")

  const actions = new ActionRegistry()
  let actionCount = 0
  actions.register({
    id: "sample.collect",
    execute: async ({ args }) => {
      actionCount += 1
      return { revision: args.revision, status: "ready" }
    }
  })
  const sinks = createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined })
  const runStore = new FileRunStateStore({ workspaceRoot, now: () => "2026-06-28T00:00:00.000Z" })
  const engine = new WorkflowEngine({
    actions,
    resultSinks: sinks,
    runStore,
    workspaceAvailable: () => true,
    fileExists: (relativePath) => fs.existsSync(path.join(workspaceRoot, relativePath)),
    preflightChecks: {
      workspaceOpen: () => true
    },
    strictPreflightChecks: true
  })
  const workflow = {
    id: "workflow-register.contract",
    name: "contract",
    label: "Contract",
    schemaVersion: "workflow-register/v1",
    inputs: { revision: { type: "string", required: true } },
    requires: {
      workspace: true,
      files: [".bob/skills/sample/SKILL.md"]
    },
    preflight: [
      {
        id: "check-workspace",
        checks: ["workspaceOpen"],
        files: [".bob/skills/sample/SKILL.md"],
        failurePolicy: "stop"
      }
    ],
    guardrails: {
      allowedCommands: ["sample.collect"],
      deniedCommands: ["shell"]
    },
    artifacts: [
      {
        id: "reviewContext",
        producedBy: "collect",
        path: ".bob/workflows/runs/{{run.id}}/artifacts/review-context.json"
      }
    ],
    engineSteps: [
      {
        id: "collect",
        title: "Collect",
        type: "command",
        action: { provider: "sample.collect", args: { revision: "{{inputs.revision}}" } },
        resultKey: "reviewContext"
      }
    ]
  }

  const run = await engine.runWorkflow(workflow, { revision: "88" })
  const artifactPath = path.join(workspaceRoot, ".bob", "workflows", "runs", run.runId, "artifacts", "review-context.json")

  assert.equal(run.status, "completed")
  assert.equal(actionCount, 1)
  assert.equal(JSON.parse(fs.readFileSync(artifactPath, "utf8")).revision, "88")
})

test("workflow engine resolves artifact path placeholders from inputs and JSON state", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const actions = new ActionRegistry()
  actions.register({
    id: "sample.review",
    execute: async ({ inputs }) => ({
      review_id: `bazaar-r${inputs.revision}-project-rule-review`,
      status: "ok"
    })
  })
  const engine = new WorkflowEngine({
    actions,
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore: new FileRunStateStore({ workspaceRoot, now: () => "2026-06-28T00:00:00.000Z" })
  })
  const workflow = {
    id: "workflow-register.artifact-placeholders",
    name: "artifact-placeholders",
    label: "Artifact Placeholders",
    schemaVersion: "workflow-register/v1",
    inputs: { revision: { type: "string", required: true } },
    artifacts: [
      {
        id: "reviewResult",
        producedBy: "review",
        path: ".bob/review/results/{{review_id}}-{{inputs.revision}}.json"
      }
    ],
    engineSteps: [
      {
        id: "review",
        title: "Review",
        type: "command",
        action: { provider: "sample.review" },
        resultKey: "reviewResult"
      }
    ]
  }

  const run = await engine.runWorkflow(workflow, { revision: "123" })
  const artifactPath = path.join(workspaceRoot, ".bob", "review", "results", "bazaar-r123-project-rule-review-123.json")

  assert.equal(run.status, "completed")
  assert.equal(JSON.parse(fs.readFileSync(artifactPath, "utf8")).review_id, "bazaar-r123-project-rule-review")
})

test("workflow engine fails denied or non-allowlisted command steps before executing them", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const actions = new ActionRegistry()
  let executed = false
  actions.register({
    id: "sample.collect",
    execute: async () => {
      executed = true
      return {}
    }
  })
  const engine = new WorkflowEngine({
    actions,
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore: new FileRunStateStore({ workspaceRoot, now: () => "2026-06-28T00:00:00.000Z" })
  })
  const workflow = {
    id: "workflow-register.guardrails",
    name: "guardrails",
    label: "Guardrails",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    guardrails: { allowedCommands: ["sample.other"] },
    engineSteps: [
      { id: "collect", title: "Collect", type: "command", action: { provider: "sample.collect" } }
    ]
  }

  const run = await engine.runWorkflow(workflow, {})

  assert.equal(run.status, "failed")
  assert.match(run.error, /not allowed/)
  assert.equal(executed, false)
})

test("shared guardrails helper validates allowed and denied commands", () => {
  const { validateCommandGuardrails } = require("../out/core/guardrails")

  assert.equal(validateCommandGuardrails({ guardrails: { allowedCommands: ["sample.collect"] } }, "sample.collect"), undefined)
  assert.match(validateCommandGuardrails({ guardrails: { allowedCommands: ["sample.other"] } }, "sample.collect"), /not allowed/)
  assert.match(validateCommandGuardrails({ guardrails: { deniedCommands: ["sample.collect"] } }, "sample.collect"), /denied/)
})
