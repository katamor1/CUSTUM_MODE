const assert = require("node:assert/strict")
const { test } = require("node:test")

const {
  assertContributesCommand,
  readJson,
  readSrc
} = require("./helpers/sourceReader")

test("package contributes the Operation Hub command and Explorer view", () => {
  const packageJson = readJson("package.json")
  const core = readSrc("extension.ts")
  const wrapper = readSrc("extensionWithAuthoring.ts")

  assertContributesCommand(packageJson, "workflowRegister.openOperationHub")
  assert.ok(packageJson.activationEvents.includes("onView:workflowRegister.operationHub"))
  assert.ok(
    packageJson.contributes.views.explorer.some((view) => view.id === "workflowRegister.operationHub" && view.name === "Bob Operation Hub"),
    "Operation Hub explorer view contribution"
  )
  assert.match(core, /registerWebviewViewProvider\("workflowRegister\.operationHub"/)
  assert.match(core, /registerCommand\("workflowRegister\.openOperationHub"/)
  assert.doesNotMatch(wrapper, /registerWebviewViewProvider\("workflowRegister\.operationHub"/)
  assert.doesNotMatch(wrapper, /registerCommand\("workflowRegister\.openOperationHub"/)
})

test("Operation Hub model builds home setup catalog and run monitor sections", () => {
  const { buildOperationHubModel } = require("../out/gui/operationHubModel")

  const model = buildOperationHubModel({
    workspaceName: "sample-repo",
    workspaceRoots: ["C:\\work\\sample-repo"],
    extensionStatus: [
      { id: "IBM.bob-code", label: "IBM Bob", available: false },
      { id: "local.bob-bazaar-review", label: "Bob Bazaar Review", available: true }
    ],
    setup: {
      bobRootPresent: false,
      workflowsPresent: true,
      runStatePresent: true,
      mcpConfigPresent: false,
      traceabilityPresent: true
    },
    workflows: [
      {
        id: "hidden.workflow",
        label: "Hidden",
        description: "hidden",
        hidden: true,
        inputs: {},
        artifacts: [],
        category: "dev"
      },
      {
        id: "qa.review",
        label: "QA Review",
        description: "レビューする",
        hidden: false,
        inputs: { target: { type: "string", required: true } },
        artifacts: [{ id: "summary", path: ".bob/summary.md" }],
        category: "QA"
      }
    ],
    runs: [
      {
        root: "C:\\work\\sample-repo",
        run: {
          runId: "run-1",
          workflowId: "qa.review",
          workflowName: "QA Review",
          status: "reviewing",
          currentStep: "humanGate",
          inputs: {},
          state: { report: ".bob/report.md" },
          steps: [
            { id: "collect", title: "収集", type: "command", status: "completed" },
            { id: "humanGate", title: "人間確認", type: "manual", status: "reviewing" }
          ],
          createdAt: "2026-07-05T01:00:00.000Z",
          updatedAt: "2026-07-05T01:02:00.000Z"
        }
      }
    ]
  })

  assert.equal(model.home.workspaceName, "sample-repo")
  assert.equal(model.home.activeRunCount, 1)
  assert.ok(model.home.recommendedActions.some((action) => action.id === "openBazaarReview"))
  assert.ok(model.setupChecklist.some((item) => item.id === "bobRoot" && item.status === "warning"))
  assert.ok(model.setupChecklist.some((item) => item.id === "mcpConfig" && item.status === "warning"))
  assert.deepEqual(model.workflowCatalog.map((workflow) => workflow.id), ["qa.review"])
  assert.equal(model.workflowCatalog[0].requiredInputCount, 1)
  assert.equal(model.runMonitor[0].statusLabel, "人間確認待ち")
  assert.ok(model.runMonitor[0].primaryActions.some((action) => (
    action.id === "acceptAndRunNextStep" &&
    action.commandId === "workflowRegister.acceptAndRunNextStep"
  )))
})

test("Operation Hub offers the next-step action for idle running workflow runs", () => {
  const { buildOperationHubModel } = require("../out/gui/operationHubModel")

  const model = buildOperationHubModel({
    workspaceName: "sample-repo",
    workspaceRoots: ["C:\\work\\sample-repo"],
    extensionStatus: [],
    setup: {
      bobRootPresent: true,
      workflowsPresent: true,
      runStatePresent: true,
      mcpConfigPresent: true,
      traceabilityPresent: false
    },
    workflows: [],
    runs: [
      {
        root: "C:\\work\\sample-repo",
        run: {
          runId: "run-2",
          workflowId: "qa.review",
          workflowName: "QA Review",
          status: "running",
          currentStep: "generate",
          inputs: {},
          state: {},
          steps: [
            { id: "collect", title: "収集", type: "command", status: "completed" },
            { id: "generate", title: "生成", type: "agent", status: "pending" }
          ],
          createdAt: "2026-07-05T01:00:00.000Z",
          updatedAt: "2026-07-05T01:02:00.000Z"
        }
      }
    ]
  })

  assert.equal(model.runMonitor[0].statusLabel, "次ステップ実行待ち")
  assert.ok(model.runMonitor[0].primaryActions.some((action) => (
    action.id === "runNextStep" &&
    action.commandId === "workflowRegister.runNextStep" &&
    action.variant === "primary"
  )))
})

test("Operation Hub focused run is pinned first and marked for operator action", () => {
  const { buildOperationHubModel } = require("../out/gui/operationHubModel")

  const model = buildOperationHubModel({
    workspaceName: "sample-repo",
    workspaceRoots: ["C:\\work\\sample-repo"],
    extensionStatus: [],
    setup: {
      bobRootPresent: true,
      workflowsPresent: true,
      runStatePresent: true,
      mcpConfigPresent: true,
      traceabilityPresent: false
    },
    workflows: [],
    focusedRunId: "run-older",
    runs: [
      {
        root: "C:\\work\\sample-repo",
        run: {
          runId: "run-newer",
          workflowId: "qa.review",
          workflowName: "Newer",
          status: "running",
          currentStep: "generate",
          inputs: {},
          state: {},
          steps: [{ id: "generate", title: "生成", type: "agent", status: "pending" }],
          createdAt: "2026-07-05T01:00:00.000Z",
          updatedAt: "2026-07-05T01:03:00.000Z"
        }
      },
      {
        root: "C:\\work\\sample-repo",
        run: {
          runId: "run-older",
          workflowId: "qa.review",
          workflowName: "Older",
          status: "reviewing",
          currentStep: "humanGate",
          inputs: {},
          state: {},
          steps: [{ id: "humanGate", title: "人間確認", type: "manual", status: "reviewing" }],
          createdAt: "2026-07-05T01:00:00.000Z",
          updatedAt: "2026-07-05T01:01:00.000Z"
        }
      }
    ]
  })

  assert.equal(model.runMonitor[0].runId, "run-older")
  assert.equal(model.runMonitor[0].focused, true)
  assert.equal(model.runMonitor[1].focused, false)
})

test("Operation Hub html uses nonce protected scripts and data-action buttons", () => {
  const { renderOperationHubHtml } = require("../out/gui/operationHubHtml")
  const { buildOperationHubModel, OPERATION_HUB_ALLOWED_ACTIONS } = require("../out/gui/operationHubModel")

  const model = buildOperationHubModel({
    workspaceName: "repo",
    workspaceRoots: ["C:\\repo"],
    extensionStatus: [],
    setup: {
      bobRootPresent: true,
      workflowsPresent: false,
      runStatePresent: false,
      mcpConfigPresent: true,
      traceabilityPresent: false
    },
    workflows: [],
    runs: []
  })
  const html = renderOperationHubHtml({ model, cspSource: "vscode-resource:", nonce: "nonce-123" })

  assert.match(html, /nonce-123/)
  assert.match(html, /Bob Operation Hub/)
  assert.match(html, /セットアップ/)
  assert.match(html, /ワークフロー一覧/)
  assert.match(html, /Run Monitor/)
  assert.match(html, /data-action="openWorkflowBuilder"/)
  assert.match(html, /vscode\.postMessage/)
  assert.doesNotMatch(html, /onclick=/)
  assert.doesNotMatch(html, /eval\(/)
  assert.ok(OPERATION_HUB_ALLOWED_ACTIONS.includes("acceptAndRunNextStep"))
  assert.ok(OPERATION_HUB_ALLOWED_ACTIONS.includes("openRunControl"))
})

test("Operation Hub html highlights the focused run", () => {
  const { renderOperationHubHtml } = require("../out/gui/operationHubHtml")
  const { buildOperationHubModel } = require("../out/gui/operationHubModel")

  const model = buildOperationHubModel({
    workspaceName: "sample-repo",
    workspaceRoots: ["C:\\work\\sample-repo"],
    extensionStatus: [],
    setup: {
      bobRootPresent: true,
      workflowsPresent: true,
      runStatePresent: true,
      mcpConfigPresent: true,
      traceabilityPresent: false
    },
    workflows: [],
    focusedRunId: "run-focus",
    runs: [
      {
        root: "C:\\work\\sample-repo",
        run: {
          runId: "run-focus",
          workflowId: "qa.review",
          workflowName: "QA Review",
          status: "reviewing",
          currentStep: "humanGate",
          inputs: {},
          state: {},
          steps: [{ id: "humanGate", title: "人間確認", type: "manual", status: "reviewing" }],
          createdAt: "2026-07-05T01:00:00.000Z",
          updatedAt: "2026-07-05T01:02:00.000Z"
        }
      }
    ]
  })
  const html = renderOperationHubHtml({ model, cspSource: "vscode-resource:", nonce: "nonce-123" })

  assert.match(html, /class="card focused-run"/)
  assert.match(html, /操作対象/)
  assert.match(html, /run-focus/)
})

test("Operation Hub provider routes accept-and-run-next with the run id", () => {
  const source = readSrc("gui", "operationHubProvider.ts")

  assert.match(source, /acceptAndRunNextStep: "workflowRegister\.acceptAndRunNextStep"/)
  assert.match(source, /const RUN_ID_ACTIONS: readonly OperationHubActionId\[] = \[/)
  assert.match(source, /"acceptAndRunNextStep"/)
  assert.match(source, /RUN_ID_ACTIONS\.includes\(message\.action\)/)
})

test("Operation Hub provider accepts run focus arguments from the open command", () => {
  const core = readSrc("extension.ts")
  const provider = readSrc("gui", "operationHubProvider.ts")

  assert.match(core, /registerCommand\("workflowRegister\.openOperationHub", \(input\?: unknown\) => operationHub\.open\(input\)\)/)
  assert.match(provider, /type OperationHubOpenInput = string \| \{ runId\?: string; stepId\?: string; reason\?: "stepGate" \| "paused" \}/)
  assert.match(provider, /private focusedRunId\?: string/)
  assert.match(provider, /focusedRunId: this\.focusedRunId/)
})
