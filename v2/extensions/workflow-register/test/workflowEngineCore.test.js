const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")
const {
  createWorkflowEngineContext,
  loadWorkflowEngineModules
} = require("./helpers/workflowEngineFixtures")

test("workflow engine rejects invalid input values before running steps", async () => {
  const { actions, engine } = createWorkflowEngineContext()
  const calls = []
  actions.register({ id: "sample.collect", execute: async () => calls.push("ran") })
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
      {
        id: "collect",
        title: "Collect",
        type: "command",
        action: { provider: "sample.collect" }
      }
    ]
  }

  const run = await engine.runWorkflow(workflow, { count: "abc", mode: "unsafe" })

  assert.equal(run.status, "failed")
  assert.match(run.error, /Workflow input must be a number: count/)
  assert.match(run.error, /Workflow input has an unsupported option: mode/)
  assert.deepEqual(calls, [])
})

test("workflow engine records result-source failures in run state", async () => {
  const { engine, workspaceRoot } = createWorkflowEngineContext()
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
          sinks: [
            {
              type: "file",
              path: ".bob/workflows/runs/{{run.id}}/steps/save.txt"
            }
          ]
        }
      }
    ]
  }

  const run = await engine.runWorkflow(workflow, {})
  const runStatePath = path.join(
    workspaceRoot,
    ".bob",
    "workflows",
    "runs",
    run.runId,
    "run.json"
  )
  const saved = JSON.parse(fs.readFileSync(runStatePath, "utf8"))

  assert.equal(run.status, "failed")
  assert.match(run.error, /Workflow state is missing: missing/)
  assert.equal(saved.status, "failed")
  assert.equal(saved.currentStep, "save")
  assert.equal(saved.steps[0].status, "failed")
  assert.match(saved.steps[0].error, /Workflow state is missing: missing/)
})

test("workflow engine validates requiredWhen inputs and select options", async () => {
  const { engine } = createWorkflowEngineContext()
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
  const workspaceRoot = require("./helpers/workflowEngineFixtures").tempDir()
  fs.mkdirSync(path.join(workspaceRoot, ".bob", "skills", "sample"), { recursive: true })
  fs.writeFileSync(path.join(workspaceRoot, ".bob", "skills", "sample", "SKILL.md"), "# Sample\n")

  const { actions, engine } = createWorkflowEngineContext({
    workspaceRoot,
    engineOptions: {
      workspaceAvailable: () => true,
      fileExists: (relativePath) => fs.existsSync(path.join(workspaceRoot, relativePath)),
      preflightChecks: { workspaceOpen: () => true },
      strictPreflightChecks: true
    }
  })
  let actionCount = 0
  actions.register({
    id: "sample.collect",
    execute: async ({ args }) => {
      actionCount += 1
      return { revision: args.revision, status: "ready" }
    }
  })
  const workflow = {
    id: "workflow-register.contract",
    name: "contract",
    label: "Contract",
    schemaVersion: "workflow-register/v1",
    inputs: { revision: { type: "string", required: true } },
    requires: { workspace: true, files: [".bob/skills/sample/SKILL.md"] },
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
        action: {
          provider: "sample.collect",
          args: { revision: "{{inputs.revision}}" }
        },
        resultKey: "reviewContext"
      }
    ]
  }

  const run = await engine.runWorkflow(workflow, { revision: "88" })
  const artifactPath = path.join(
    workspaceRoot,
    ".bob",
    "workflows",
    "runs",
    run.runId,
    "artifacts",
    "review-context.json"
  )

  assert.equal(run.status, "completed")
  assert.equal(actionCount, 1)
  assert.equal(JSON.parse(fs.readFileSync(artifactPath, "utf8")).revision, "88")
})

test("workflow engine resolves artifact path placeholders from inputs and JSON state", async () => {
  const { actions, engine, workspaceRoot } = createWorkflowEngineContext()
  actions.register({
    id: "sample.review",
    execute: async ({ inputs }) => ({
      review_id: `bazaar-r${inputs.revision}-project-rule-review`,
      status: "ok"
    })
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
  const artifactPath = path.join(
    workspaceRoot,
    ".bob",
    "review",
    "results",
    "bazaar-r123-project-rule-review-123.json"
  )

  assert.equal(run.status, "completed")
  assert.equal(JSON.parse(fs.readFileSync(artifactPath, "utf8")).review_id, "bazaar-r123-project-rule-review")
})

test("workflow engine resolves explicit JSON state placeholders deterministically", async () => {
  const { actions, engine } = createWorkflowEngineContext()
  const calls = []
  actions.register({
    id: "sample.first",
    execute: async () => ({ review_id: "first-review", nested: { target: "alpha" } })
  })
  actions.register({
    id: "sample.second",
    execute: async () => ({ review_id: "second-review", nested: { target: "beta" } })
  })
  actions.register({
    id: "sample.save",
    execute: async ({ args }) => {
      calls.push(args)
      return "saved"
    }
  })
  const workflow = {
    id: "workflow-register.explicit-json-placeholders",
    name: "explicit-json-placeholders",
    label: "Explicit JSON Placeholders",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    engineSteps: [
      { id: "first", title: "First", type: "command", action: { provider: "sample.first" }, resultKey: "firstContext" },
      { id: "second", title: "Second", type: "command", action: { provider: "sample.second" }, resultKey: "secondContext" },
      {
        id: "save",
        title: "Save",
        type: "command",
        action: {
          provider: "sample.save",
          args: {
            selectedReview: "{{json state.secondContext.review_id}}",
            nestedTarget: "{{json state.firstContext.nested.target}}"
          }
        },
        resultKey: "saveResult"
      }
    ]
  }

  const run = await engine.runWorkflow(workflow, {})

  assert.equal(run.status, "completed")
  assert.deepEqual(calls, [{ selectedReview: "second-review", nestedTarget: "alpha" }])
})

test("workflow engine fails denied or non-allowlisted command steps before executing them", async () => {
  const { actions, engine } = createWorkflowEngineContext()
  let executed = false
  actions.register({
    id: "sample.collect",
    execute: async () => {
      executed = true
      return {}
    }
  })
  const workflow = {
    id: "workflow-register.guardrails",
    name: "guardrails",
    label: "Guardrails",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    guardrails: { allowedCommands: ["sample.other"] },
    engineSteps: [
      {
        id: "collect",
        title: "Collect",
        type: "command",
        action: { provider: "sample.collect" }
      }
    ]
  }

  const run = await engine.runWorkflow(workflow, {})

  assert.equal(run.status, "failed")
  assert.match(run.error, /not allowed/)
  assert.equal(executed, false)
})

test("shared guardrails helper validates allowed and denied commands", () => {
  const { validateCommandGuardrails } = require("../out/core/guardrails")

  assert.equal(
    validateCommandGuardrails({ guardrails: { allowedCommands: ["sample.collect"] } }, "sample.collect"),
    undefined
  )
  assert.match(
    validateCommandGuardrails({ guardrails: { allowedCommands: ["sample.other"] } }, "sample.collect"),
    /not allowed/
  )
  assert.match(
    validateCommandGuardrails({ guardrails: { deniedCommands: ["sample.collect"] } }, "sample.collect"),
    /denied/
  )
})

test("workflow engine helper loads core modules", () => {
  const modules = loadWorkflowEngineModules()

  assert.equal(typeof modules.ActionRegistry, "function")
  assert.equal(typeof modules.WorkflowEngine, "function")
})
