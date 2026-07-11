const assert = require("node:assert/strict")
const { test } = require("node:test")
const { ManualStepPanelController } = require("../out/webview/manualStepPanel")

function panelInput() {
  return {
    workflow: {
      id: "workflow-1",
      name: "workflow-1",
      label: "Workflow 1",
      description: "Manual workflow.",
      schemaVersion: "workflow-register/v1",
      workflowFile: ".bob/workflows/workflow-1/WORKFLOW.md",
      inputs: {},
      state: {},
      engineSteps: []
    },
    run: {
      runId: "run-1",
      workflowId: "workflow-1",
      workflowName: "Workflow 1",
      status: "held",
      currentStep: "manual-1",
      inputs: {},
      state: {},
      steps: [{ id: "manual-1", title: "Manual 1", type: "manual", status: "held" }],
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z"
    },
    step: {
      id: "manual-1",
      title: "Manual 1",
      type: "manual",
      prompt: "Complete the manual action."
    },
    active: { key: "active-1" }
  }
}

function createLifecycleHarness() {
  let panelDisposeListener = () => {}
  const calls = {
    panelDispose: 0,
    messageSubscriptionDispose: 0,
    panelSubscriptionDispose: 0
  }
  const panel = {
    webview: {
      cspSource: "vscode-resource:",
      html: "",
      onDidReceiveMessage: () => ({
        dispose: () => { calls.messageSubscriptionDispose += 1 }
      })
    },
    reveal: () => undefined,
    onDidDispose: (listener) => {
      panelDisposeListener = listener
      return {
        dispose: () => { calls.panelSubscriptionDispose += 1 }
      }
    },
    dispose: () => {
      calls.panelDispose += 1
      panelDisposeListener()
    }
  }
  const controller = new ManualStepPanelController({
    host: {
      activeViewColumn: 1,
      createWebviewPanel: () => panel,
      showWarningMessage: async () => undefined,
      showInformationMessage: async () => undefined
    },
    completeStep: async () => ({ ok: true, message: "done" })
  })
  return { controller, calls }
}

test("manual step controller disposes its panel and listeners exactly once", async () => {
  const { controller, calls } = createLifecycleHarness()
  await controller.show(panelInput())

  controller.dispose()
  controller.dispose()

  assert.deepEqual(calls, {
    panelDispose: 1,
    messageSubscriptionDispose: 1,
    panelSubscriptionDispose: 1
  })
  await assert.rejects(controller.show(panelInput()), /Manual step panel controller is disposed/)
})
