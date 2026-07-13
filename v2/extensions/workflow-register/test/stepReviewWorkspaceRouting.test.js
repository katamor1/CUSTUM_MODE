const assert = require("node:assert/strict")
const fs = require("node:fs")
const Module = require("node:module")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const RUN_NEXT_STEP_LABEL = "次のステップを実行"
const OPEN_OPERATION_HUB_LABEL = "Operation Hub を開く"

function reviewingRun(runId, updatedAt) {
  return {
    runId,
    workflowId: "workflow-register.workspace-routing",
    workflowName: "workspace-routing",
    status: "reviewing",
    currentStep: "review",
    inputs: {},
    state: {},
    steps: [
      { id: "review", title: "Review", type: "command", status: "reviewing" },
      { id: "next", title: "Next", type: "command", status: "pending" }
    ],
    createdAt: updatedAt,
    updatedAt
  }
}

function loadStepReview(vscode) {
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "vscode") return vscode
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const resolved = require.resolve("../out/commands/stepReview.js")
    delete require.cache[resolved]
    return require(resolved)
  } finally {
    Module._load = originalLoad
  }
}

async function saveRun(root, run) {
  const { FileRunStateStore } = require("../out/core/runStateStore")
  await new FileRunStateStore({ workspaceRoot: root, now: () => run.updatedAt }).saveRun(run)
}

function tempRoot(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

for (const choice of [RUN_NEXT_STEP_LABEL, OPEN_OPERATION_HUB_LABEL]) {
  test(`post-accept ${choice} preserves the selected workspace identity`, async (t) => {
    const rootA = tempRoot(t, "workflow-register-review-route-a-")
    const rootB = tempRoot(t, "workflow-register-review-route-b-")
    const runId = "shared-run-id"
    await saveRun(rootA, reviewingRun(runId, "2026-07-12T00:00:02.000Z"))
    await saveRun(rootB, reviewingRun(runId, "2026-07-12T00:00:01.000Z"))

    const commands = []
    const vscode = {
      commands: {
        executeCommand: async (...args) => {
          commands.push(args)
          return undefined
        }
      },
      window: {
        showErrorMessage: async () => undefined,
        showWarningMessage: async () => undefined,
        showQuickPick: async (items) => items.find((item) => item.selection?.root === rootA),
        showInformationMessage: async (...args) => args.includes(choice) ? choice : undefined
      },
      workspace: {
        isTrusted: true,
        workspaceFolders: [
          { name: "root-b", uri: { fsPath: rootB } },
          { name: "root-a", uri: { fsPath: rootA } }
        ]
      }
    }
    const { acceptCurrentStep } = loadStepReview(vscode)

    const result = await acceptCurrentStep({
      showMarkdownReport: async () => undefined,
      acceptBobWorkflowGate: () => "missing",
      coordinateReviewAcceptance: async (_workspaceRoot, _acceptedRunId, operation) => operation()
    })

    assert.equal(result.runId, runId)
    assert.equal(result.status, "running")
    assert.equal(commands.length, 1)
    const [commandId, commandArg] = commands[0]
    if (choice === RUN_NEXT_STEP_LABEL) {
      assert.equal(commandId, "workflowRegister.runNextStep")
      assert.equal(commandArg.source, "operationHub")
      assert.equal(commandArg.workspaceRoot, rootA)
      assert.equal(commandArg.runId, runId)
      assert.match(commandArg.expectedRevision, /^sha256:/)
    } else {
      assert.equal(commandId, "workflowRegister.openOperationHub")
      assert.equal(commandArg.workspaceRoot, rootA)
      assert.equal(commandArg.runId, runId)
      assert.equal(commandArg.stepId, "next")
    }
  })
}
