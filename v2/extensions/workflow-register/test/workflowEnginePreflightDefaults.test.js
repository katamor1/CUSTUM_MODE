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

test("workflow engine rejects preflight file paths outside the workspace", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const parentRoot = tempDir()
  const workspaceRoot = path.join(parentRoot, "workspace")
  fs.mkdirSync(workspaceRoot, { recursive: true })
  fs.writeFileSync(path.join(parentRoot, "outside.txt"), "outside\n")

  const actions = new ActionRegistry()
  actions.register({ id: "sample.collect", execute: () => ({ ok: true }) })

  const engine = new WorkflowEngine({
    actions,
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore: new FileRunStateStore({ workspaceRoot, now: () => "2026-06-28T00:00:00.000Z" })
  })

  const workflow = {
    id: "workflow-register.preflight-path-escape",
    name: "preflight-path-escape",
    label: "Preflight Path Escape",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    requires: {
      files: ["../outside.txt"]
    },
    guardrails: {
      allowedCommands: ["sample.collect"]
    },
    engineSteps: [
      { id: "collect", title: "Collect", type: "command", action: { provider: "sample.collect" }, resultKey: "result" }
    ]
  }

  const run = await engine.runWorkflow(workflow, {})

  assert.equal(run.status, "failed")
  assert.match(run.error, /must stay inside the workspace/)
  assert.match(run.error, /\.\.\/outside\.txt/)
})

test("evaluatePreflight rejects escaped preflight files before calling fileExists", async () => {
  const { evaluatePreflight } = require("../out/core/engine/preflight")
  let fileExistsCalls = 0

  const result = await evaluatePreflight({
    workflow: {
      id: "workflow-register.preflight-file-validation",
      name: "preflight-file-validation",
      label: "Preflight File Validation",
      schemaVersion: "workflow-register/v1",
      inputs: {},
      requires: {},
      preflight: [{ id: "check-files", files: ["C:\\Windows\\win.ini", "..\\outside.txt"], failurePolicy: "warn" }],
      guardrails: {},
      engineSteps: []
    },
    run: { id: "run-1", workflowId: "workflow-register.preflight-file-validation", inputs: {}, state: {}, steps: [], status: "running" },
    fileExists: () => {
      fileExistsCalls += 1
      return true
    },
    preflightChecks: {},
    strictPreflightChecks: false
  })

  assert.equal(fileExistsCalls, 0)
  assert.equal(result.errors.length, 0)
  assert.equal(result.warnings.length, 2)
  assert.match(result.warnings.join("\n"), /C:\\Windows\\win\.ini/)
  assert.match(result.warnings.join("\n"), /\.\.\\outside\.txt/)
})
