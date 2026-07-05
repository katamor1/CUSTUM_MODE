const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { createDefaultActionRegistry } = require("../out/core/actionRegistry")
const { createWorkflowEngineContext } = require("./helpers/workflowEngineFixtures")

function tempWorkspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mechanical-checks-action-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function writeFile(root, relativePath, text) {
  const filePath = path.join(root, ...relativePath.split("/"))
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, text)
  return filePath
}

function writeMechanicalCheckFixture(root) {
  writeFile(root, "tools/pass.js", "console.log('precheck ok')\n")
  writeFile(root, ".bob/checks/mechanical-checks.yaml", `
schema_version: bob-mechanical-checks/v1
project_id: product-a
profiles:
  - id: pre-code-review
    title: コードレビュー前チェック
    gate: pre_code_review
    checks:
      - smoke-check
checks:
  - id: smoke-check
    title: Smoke check
    runner: node
    command: tools/pass.js
    cwd: .
`)
}

test("default action registry exposes workflowRegister.runMechanicalChecks", async (t) => {
  const workspaceRoot = tempWorkspace(t)
  writeMechanicalCheckFixture(workspaceRoot)
  const registry = createDefaultActionRegistry({
    executeCommand: () => undefined
  })

  assert.ok(registry.list().includes("workflowRegister.runMechanicalChecks"))
  const result = await registry.execute("workflowRegister.runMechanicalChecks", {
    args: { profile: "pre-code-review" },
    inputs: {},
    workflowRoot: workspaceRoot,
    runId: "provider-run",
    stepId: "run-mechanical-checks"
  })

  assert.equal(result.ok, true)
  assert.equal(result.value.status, "passed")
  assert.equal(result.value.profile, "pre-code-review")
  assert.ok(fs.existsSync(path.join(workspaceRoot, ".bob", "mechanical-checks", "runs", result.value.run_id, "profile-result.json")))
})

test("workflow command step stores mechanical check resultKey without Bob", async (t) => {
  const workspaceRoot = tempWorkspace(t)
  writeMechanicalCheckFixture(workspaceRoot)
  const actions = createDefaultActionRegistry({ executeCommand: () => undefined })
  const { engine } = createWorkflowEngineContext({ workspaceRoot, actions })
  const workflow = {
    id: "workflow-register.mechanical-checks",
    name: "mechanical-checks",
    label: "Mechanical Checks",
    description: "Mechanical checks workflow.",
    schemaVersion: "workflow-register/v1",
    workflowRoot: workspaceRoot,
    inputs: {},
    engineSteps: [
      {
        id: "run-mechanical-checks",
        title: "Run mechanical checks",
        type: "command",
        action: {
          provider: "workflowRegister.runMechanicalChecks",
          args: { profile: "pre-code-review" }
        },
        resultKey: "mechanicalCheckResult"
      }
    ]
  }

  const run = await engine.runWorkflow(workflow, {})
  const stored = JSON.parse(run.state.mechanicalCheckResult)

  assert.equal(run.status, "completed")
  assert.equal(stored.schema_version, "bob-mechanical-check-profile-result/v1")
  assert.equal(stored.status, "passed")
  assert.equal(stored.checks[0].check_id, "smoke-check")
})
