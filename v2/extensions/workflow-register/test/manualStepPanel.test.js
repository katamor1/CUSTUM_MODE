const assert = require("node:assert/strict")
const { test } = require("node:test")

const {
  ManualStepPanelController
} = require("../out/webview/manualStepPanel")
const { renderManualStepHtml } = require("../out/webview/manualStepPanelHtml")
const { buildManualStepActionViewModel } = require("../out/webview/manualStepViewModel")

function workflow() {
  return {
    id: "manual-action-sample",
    name: "manual-action-sample",
    label: "Manual Action Sample",
    description: "Manual workflow.",
    schemaVersion: "workflow-register/v1",
    workflowFile: ".bob/workflows/manual-action-sample/WORKFLOW.md",
    inputs: {},
    state: {},
    engineSteps: []
  }
}

function run() {
  return {
    runId: "run-1",
    workflowId: "manual-action-sample",
    workflowName: "Manual Action Sample",
    status: "held",
    currentStep: "check-file",
    inputs: { reportName: "report-a" },
    state: { reportPath: ".bob/artifacts/report-a.md" },
    steps: [{ id: "check-file", title: "Check file", type: "manual", status: "held" }],
    createdAt: "2026-07-04T00:00:00.000Z",
    updatedAt: "2026-07-04T00:00:00.000Z"
  }
}

function step() {
  return {
    id: "check-file",
    title: "Check file",
    type: "manual",
    prompt: "Fallback prompt.",
    userAction: {
      message: "Open {{state.reportPath}} for {{inputs.reportName}} in {{workflow.id}} / {{step.id}}.",
      completeLabel: "確認完了",
      confirmOnComplete: true,
      confirmMessage: "Complete {{step.id}} for {{run.id}}?"
    }
  }
}

function createPanelHarness(config = {}) {
  let messageListener
  const warnings = []
  const infos = []
  const completeRequests = []
  const panel = {
    webview: {
      cspSource: "vscode-resource:",
      html: "",
      onDidReceiveMessage: (listener) => {
        messageListener = listener
        return { dispose() {} }
      }
    },
    onDidDispose: () => ({ dispose() {} }),
    reveal: () => undefined
  }
  const controller = new ManualStepPanelController({
    host: {
      activeViewColumn: 1,
      createWebviewPanel: () => panel,
      showWarningMessage: async (message, options, ...items) => {
        warnings.push({ message, options, items })
        return config.warningResult
      },
      showInformationMessage: async (message) => {
        infos.push(message)
        return undefined
      }
    },
    completeStep: async (request) => {
      completeRequests.push(request)
      return config.completeResult ?? { ok: true, message: "任意の成功文言" }
    }
  })

  return {
    controller,
    panel,
    get messageListener() {
      return messageListener
    },
    warnings,
    infos,
    completeRequests
  }
}

function panelInput() {
  return {
    workflow: workflow(),
    run: run(),
    step: step(),
    active: { key: "active-1" }
  }
}

test("manual step view model renders userAction templates and active metadata", () => {
  const viewModel = buildManualStepActionViewModel({
    workflow: workflow(),
    run: run(),
    step: step(),
    active: { key: "active-1" }
  })

  assert.equal(viewModel.status, "active")
  assert.equal(viewModel.activeKey, "active-1")
  assert.equal(viewModel.message, "Open .bob/artifacts/report-a.md for report-a in manual-action-sample / check-file.")
  assert.equal(viewModel.completeLabel, "確認完了")
  assert.equal(viewModel.confirmOnComplete, true)
  assert.equal(viewModel.confirmMessage, "Complete check-file for run-1?")
  assert.deepEqual(viewModel.stateKeys, ["reportPath"])
})

test("manual step view model falls back to prompt and default button label", () => {
  const manualStep = { ...step(), userAction: undefined }
  const viewModel = buildManualStepActionViewModel({
    workflow: workflow(),
    run: run(),
    step: manualStep,
    active: { key: "active-1" }
  })

  assert.equal(viewModel.message, "Fallback prompt.")
  assert.equal(viewModel.completeLabel, "完了")
  assert.equal(viewModel.confirmOnComplete, false)
})

test("manual step html escapes workflow content and posts active key completion", () => {
  const viewModel = {
    activeKey: "active-1",
    runId: "run-1",
    workflowId: "manual-action-sample",
    workflowLabel: "Manual <Action>",
    stepId: "check-file",
    stepTitle: "Check <file>",
    status: "active",
    message: "Read <script>alert(1)</script>\n- item",
    completeLabel: "Done <now>",
    confirmOnComplete: false,
    workflowFile: ".bob/workflows/manual-action-sample/WORKFLOW.md",
    stateKeys: ["reportPath"]
  }

  const html = renderManualStepHtml({ cspSource: "vscode-resource:", nonce: "nonce-123", viewModel })

  assert.match(html, /Manual &lt;Action&gt;/)
  assert.match(html, /Read &lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/)
  assert.match(html, /Done &lt;now&gt;/)
  assert.match(html, /type: 'completeManualStep'/)
  assert.match(html, /activeKey: completion\.activeKey/)
  assert.doesNotMatch(html, /confirmOnComplete/)
  assert.doesNotMatch(html, /confirmMessage/)
  assert.doesNotMatch(html, /refreshButton/)
})

test("manual step html is read-only when active task handle is missing", () => {
  const viewModel = buildManualStepActionViewModel({
    workflow: workflow(),
    run: run(),
    step: step(),
    active: undefined
  })
  const html = renderManualStepHtml({ cspSource: "vscode-resource:", nonce: "nonce-123", viewModel })

  assert.equal(viewModel.status, "heldWithoutActiveTask")
  assert.match(html, /現在の Bob task への接続がありません/)
  assert.doesNotMatch(html, /completeManualStep/)
})

test("manual step html shows a completed footer after panel completion", () => {
  const viewModel = {
    activeKey: undefined,
    runId: "run-1",
    workflowId: "manual-action-sample",
    workflowLabel: "Manual Action Sample",
    stepId: "check-file",
    stepTitle: "Check file",
    status: "completed",
    message: "この step は完了しました。",
    completeLabel: "確認完了",
    confirmOnComplete: false,
    workflowFile: ".bob/workflows/manual-action-sample/WORKFLOW.md",
    stateKeys: []
  }

  const html = renderManualStepHtml({ cspSource: "vscode-resource:", nonce: "nonce-123", viewModel })

  assert.match(html, /この step は完了しました/)
  assert.match(html, /Run Control View/)
  assert.doesNotMatch(html, /現在の Bob task への接続がありません/)
  assert.doesNotMatch(html, /completeManualStep/)
})

test("manual step controller uses host-owned confirmation and cancels when rejected", async () => {
  const harness = createPanelHarness({ warningResult: undefined })
  await harness.controller.show(panelInput())

  await harness.messageListener({
    type: "completeManualStep",
    activeKey: "active-1",
    confirmOnComplete: false,
    confirmMessage: "spoofed"
  })

  assert.equal(harness.warnings.length, 1)
  assert.match(harness.warnings[0].message, /Complete check-file for run-1\?/)
  assert.deepEqual(harness.completeRequests, [])
  assert.match(harness.panel.webview.html, /確認完了/)
})

test("manual step controller sends expected run and step and uses structured success", async () => {
  const harness = createPanelHarness({
    warningResult: "完了",
    completeResult: { ok: true, message: "任意の成功文言" }
  })
  await harness.controller.show(panelInput())

  await harness.messageListener({ type: "completeManualStep", activeKey: "active-1" })

  assert.deepEqual(harness.completeRequests, [{
    activeKey: "active-1",
    expectedRunId: "run-1",
    expectedStepId: "check-file"
  }])
  assert.deepEqual(harness.infos, ["任意の成功文言"])
  assert.match(harness.panel.webview.html, /この step は完了しました/)
  assert.match(harness.panel.webview.html, /任意の成功文言/)
  assert.doesNotMatch(harness.panel.webview.html, /現在の Bob task への接続がありません/)
})

test("manual step controller rejects mismatched active keys before completion", async () => {
  const harness = createPanelHarness({ warningResult: "完了" })
  await harness.controller.show(panelInput())

  await harness.messageListener({ type: "completeManualStep", activeKey: "wrong-key" })

  assert.deepEqual(harness.warnings, [])
  assert.deepEqual(harness.completeRequests, [])
  assert.match(harness.panel.webview.html, /Active Bob workflow step mismatch/)
  assert.match(harness.panel.webview.html, /wrong-key/)
})
