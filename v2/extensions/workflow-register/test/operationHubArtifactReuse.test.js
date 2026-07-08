const assert = require("node:assert/strict")
const { test } = require("node:test")
const { readSrc } = require("./helpers/sourceReader")

function manifest(runId = "source-run") {
  return JSON.stringify({
    schemaVersion: "workflow-register/artifact-manifest/v1",
    workflowId: "qa.review",
    workflowDefinitionHash: "definition-v1",
    runId,
    inputsHash: "sha256:ignored",
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    artifacts: [
      {
        id: "context",
        stateKey: "context",
        producedBy: "collect",
        path: ".bob/workflows/runs/source-run/artifacts/collect/context.txt",
        sha256: "abc",
        bytes: 10,
        source: "workflow-artifact",
        updatedAt: "2026-07-08T00:00:00.000Z"
      }
    ]
  })
}

function reuse() {
  return JSON.stringify({
    schemaVersion: "workflow-register/artifact-reuse/v1",
    sourceRunId: "source-run",
    sourceWorkflowId: "qa.review",
    startStepId: "analyze",
    reusedStepIds: ["collect"],
    hydratedKeys: ["context"],
    createdAt: "2026-07-08T00:00:00.000Z"
  })
}

test("Operation Hub model exposes start-from-artifacts action for runs with a manifest", () => {
  const { buildOperationHubModel, OPERATION_HUB_ALLOWED_ACTIONS } = require("../out/gui/operationHubModel")

  const model = buildOperationHubModel({
    workspaceName: "repo",
    workspaceRoots: ["/repo"],
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
        root: "/repo",
        run: {
          runId: "source-run",
          workflowId: "qa.review",
          workflowName: "QA Review",
          status: "completed",
          inputs: {},
          state: { "workflow.artifactManifest": manifest("source-run") },
          steps: [{ id: "collect", title: "収集", type: "agent", status: "completed" }],
          createdAt: "2026-07-08T00:00:00.000Z",
          updatedAt: "2026-07-08T00:01:00.000Z"
        }
      }
    ]
  })
  const run = model.runMonitor[0]

  assert.ok(OPERATION_HUB_ALLOWED_ACTIONS.includes("startFromArtifacts"))
  assert.equal(run.artifactManifestLabel, "Reusable artifacts: 1")
  assert.equal(run.artifacts[0].displayPath, ".bob/workflows/runs/source-run/artifacts/collect/context.txt")
  assert.ok(run.primaryActions.some((action) => (
    action.id === "startFromArtifacts" &&
    action.commandId === "workflowRegister.startFromStepWithArtifacts" &&
    action.workflowId === "qa.review" &&
    action.runId === "source-run" &&
    action.variant === "primary"
  )))
})

test("Operation Hub model summarizes artifact reuse provenance", () => {
  const { buildOperationHubModel } = require("../out/gui/operationHubModel")

  const model = buildOperationHubModel({
    workspaceName: "repo",
    workspaceRoots: ["/repo"],
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
        root: "/repo",
        run: {
          runId: "target-run",
          workflowId: "qa.review",
          workflowName: "QA Review",
          status: "running",
          currentStep: "analyze",
          inputs: {},
          state: { "workflow.artifactReuse": reuse() },
          steps: [
            { id: "collect", title: "収集", type: "agent", status: "completed" },
            { id: "analyze", title: "分析", type: "agent", status: "pending" }
          ],
          createdAt: "2026-07-08T00:00:00.000Z",
          updatedAt: "2026-07-08T00:01:00.000Z"
        }
      }
    ]
  })

  assert.match(model.runMonitor[0].artifactReuseLabel, /Artifacts reused: 1 step\(s\), 1 state key\(s\)/)
  assert.match(model.runMonitor[0].artifactReuseLabel, /source-run/)
  assert.match(model.runMonitor[0].artifactReuseLabel, /analyze/)
})

test("Operation Hub provider routes start-from-artifacts with workflow id and source run id", () => {
  const source = readSrc("gui", "operationHubProvider.ts")

  assert.match(source, /startFromArtifacts: "workflowRegister\.startFromStepWithArtifacts"/)
  assert.match(source, /message\.action === "startFromArtifacts"/)
  assert.match(source, /return message\.workflowId \? \[message\.workflowId, undefined, message\.runId\] : \[\]/)
  assert.match(source, /artifacts\/manifest\.json/)
})
