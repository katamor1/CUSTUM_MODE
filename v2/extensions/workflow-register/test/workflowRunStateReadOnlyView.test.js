const assert = require("node:assert/strict")
const Module = require("node:module")
const path = require("node:path")
const { test } = require("node:test")

class EventEmitter {
  constructor() {
    this.event = () => ({ dispose() {} })
  }
  fire() {}
  dispose() {}
}

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label
    this.collapsibleState = collapsibleState
  }
}

class ThemeIcon {
  constructor(id) {
    this.id = id
  }
}

const statusBar = {
  text: "",
  tooltip: "",
  show() {},
  dispose() {}
}

const vscode = {
  EventEmitter,
  StatusBarAlignment: { Left: 1 },
  ThemeIcon,
  TreeItem,
  TreeItemCollapsibleState: { None: 0 },
  window: {
    createStatusBarItem: () => statusBar
  },
  workspace: {
    workspaceFolders: [],
    onDidChangeWorkspaceFolders: () => ({ dispose() {} })
  }
}

function loadViewModule() {
  const modulePath = path.resolve(__dirname, "..", "out", "commands", "runControlView.js")
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "vscode") return vscode
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    delete require.cache[require.resolve(modulePath)]
    return require(modulePath)
  } finally {
    Module._load = originalLoad
  }
}

function futureRun() {
  return {
    schemaVersion: "workflow-register/run-state/v2",
    runId: "20260712T000000Z-read-only-view",
    workflowId: "workflow-register.read-only-view",
    workflowName: "read-only-view",
    status: "running",
    currentStep: "review",
    inputs: {},
    state: {},
    steps: [{ id: "review", title: "Review", type: "manual", status: "pending" }],
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:01:00.000Z"
  }
}

test("Runs View presents future run-state versions as read-only without mutation context", () => {
  const { WorkflowRunControlView } = loadViewModule()
  const view = new WorkflowRunControlView()
  const item = view.getTreeItem({ root: "/workspace", run: futureRun() })

  assert.equal(item.contextValue, "workflowRun.readOnly")
  assert.match(item.description, /read-only/)
  assert.match(item.tooltip, /run state schema: workflow-register\/run-state\/v2/)
  assert.equal(item.iconPath.id, "lock")
  assert.equal(item.command.command, "workflowRegister.inspectRunControl")
  view.dispose()
})
