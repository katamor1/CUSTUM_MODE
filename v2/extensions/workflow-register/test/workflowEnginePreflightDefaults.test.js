const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "workflow-register-preflight-"))
}

test("workflow engine provides default preflight checks from FileRunStateStore", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  fs.mkdirSync(path.join(workspaceRoot, ".bob", "skills", "sample"), { recursive: true })
  fs.mkdirSync(path.join(workspaceRoot, ".bzr"), { recursive: true })
  fs.writeFileSync(path.join(workspaceRoot, ".bob", "skills", "sample", "SKILL.md"), "# Sample\n")

  const actions = new ActionRegistry()
  actions.register({ id: "sample.collect", execute: () => ({ ok: true }) })

  const engine = new WorkflowEngine({
    actions,
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore: new FileRunStateStore({ workspaceRoot, now: () => "2026-06-28T00:00:00.000Z" })
  })

  const workflow = {
    id: "workflow-register.default-preflight",
    name: "default-preflight",
    label: "Default Preflight",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    requires: {
      workspace: true,
      files: [".bob/skills/sample/SKILL.md"]
    },
    preflight: [
      {
        id: "check-workspace",
        checks: ["workspaceOpen", "bobWorkspaceInitialized", "bazaarRepository"],
        failurePolicy: "stop"
      }
    ],
    guardrails: {
      allowedCommands: ["sample.collect"]
    },
    engineSteps: [
      { id: "collect", title: "Collect", type: "command", action: { provider: "sample.collect" }, resultKey: "result" }
    ]
  }

  const run = await engine.runWorkflow(workflow, {})

  assert.equal(run.status, "completed")
  assert.equal(run.error, undefined)
})
