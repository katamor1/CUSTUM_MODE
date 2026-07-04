const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

function tempDir(prefix = "workflow-register-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function fixedNow() {
  return "2026-06-28T00:00:00.000Z"
}

function loadWorkflowEngineModules() {
  return {
    ActionRegistry: require("../../out/core/actionRegistry").ActionRegistry,
    FileRunStateStore: require("../../out/core/runStateStore").FileRunStateStore,
    WorkflowEngine: require("../../out/core/engine").WorkflowEngine,
    createDefaultResultSinkRegistry: require("../../out/core/resultSinkRegistry").createDefaultResultSinkRegistry
  }
}

function createWorkflowEngineContext(options = {}) {
  const {
    ActionRegistry,
    FileRunStateStore,
    WorkflowEngine,
    createDefaultResultSinkRegistry
  } = loadWorkflowEngineModules()
  const workspaceRoot = options.workspaceRoot ?? tempDir()
  const actions = options.actions ?? new ActionRegistry()
  const resultSinks = options.resultSinks ?? createDefaultResultSinkRegistry({
    workspaceRoot,
    executeCommand: options.executeCommand ?? (async () => undefined)
  })
  const runStore = options.runStore ?? new FileRunStateStore({
    workspaceRoot,
    now: options.now ?? fixedNow
  })
  const engine = new WorkflowEngine({
    actions,
    resultSinks,
    runStore,
    ...(options.engineOptions ?? {})
  })

  return { actions, engine, resultSinks, runStore, workspaceRoot }
}

module.exports = {
  createWorkflowEngineContext,
  fixedNow,
  loadWorkflowEngineModules,
  tempDir
}
