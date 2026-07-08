const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const { test } = require("node:test")

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex")
}

function workflow() {
  return {
    id: "workflow-register.hydration",
    name: "hydration",
    label: "Hydration",
    description: "Hydration workflow.",
    schemaVersion: "workflow-register/v1",
    definitionHash: "definition-v1",
    filePath: ".bob/workflows/hydration/WORKFLOW.md",
    inputs: {},
    engineSteps: [
      { id: "collect", title: "Collect", type: "agent", resultKey: "context" },
      { id: "analyze", title: "Analyze", type: "agent", includeState: ["context"], stateRequired: true, resultKey: "analysis" }
    ]
  }
}

function run() {
  return {
    runId: "target-run",
    workflowId: "workflow-register.hydration",
    workflowName: "hydration",
    status: "running",
    currentStep: "analyze",
    inputs: {},
    state: {},
    steps: [],
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z"
  }
}

test("artifact hydration restores required state and records provenance", async () => {
  const {
    hydrateWorkflowStateFromArtifacts,
    stateKeysRequiredByStep
  } = require("../out/core/artifacts/stateHydration")
  const { workflowInputsHash } = require("../out/core/artifacts/artifactManifest")

  const artifactText = "reusable context"
  const manifest = {
    schemaVersion: "workflow-register/artifact-manifest/v1",
    workflowId: "workflow-register.hydration",
    workflowDefinitionHash: "definition-v1",
    runId: "source-run",
    inputsHash: workflowInputsHash({}),
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    artifacts: [
      {
        id: "context",
        stateKey: "context",
        producedBy: "collect",
        path: ".bob/workflows/runs/source-run/artifacts/collect/context.txt",
        sha256: sha256(artifactText),
        bytes: Buffer.byteLength(artifactText, "utf8"),
        source: "workflow-artifact",
        updatedAt: "2026-07-08T00:00:00.000Z"
      }
    ]
  }
  const targetRun = run()
  const result = await hydrateWorkflowStateFromArtifacts({
    workflow: workflow(),
    run: targetRun,
    manifest,
    stateKeys: stateKeysRequiredByStep(workflow(), "analyze"),
    readFile: async (relativePath) => {
      assert.equal(relativePath, manifest.artifacts[0].path)
      return artifactText
    },
    now: () => "2026-07-08T00:00:01.000Z"
  })

  assert.equal(result.ok, true, result.issues.map((issue) => issue.message).join("\n"))
  assert.deepEqual(result.hydratedKeys, ["context"])
  assert.equal(targetRun.state.context, artifactText)
  const provenance = JSON.parse(targetRun.state["workflow.artifactHydration"])
  assert.equal(provenance.schemaVersion, "workflow-register/artifact-hydration/v1")
  assert.equal(provenance.sourceRunId, "source-run")
  assert.equal(provenance.hydrated[0].stateKey, "context")
})

test("artifact hydration rejects unsafe paths and checksum mismatches", async () => {
  const { hydrateWorkflowStateFromArtifacts } = require("../out/core/artifacts/stateHydration")
  const { workflowInputsHash } = require("../out/core/artifacts/artifactManifest")
  const baseManifest = {
    schemaVersion: "workflow-register/artifact-manifest/v1",
    workflowId: "workflow-register.hydration",
    workflowDefinitionHash: "definition-v1",
    runId: "source-run",
    inputsHash: workflowInputsHash({}),
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    artifacts: [
      {
        id: "context",
        stateKey: "context",
        producedBy: "collect",
        path: "../outside.txt",
        sha256: sha256("expected"),
        bytes: Buffer.byteLength("expected", "utf8"),
        source: "workflow-artifact",
        updatedAt: "2026-07-08T00:00:00.000Z"
      }
    ]
  }

  const unsafe = await hydrateWorkflowStateFromArtifacts({
    workflow: workflow(),
    run: run(),
    manifest: baseManifest,
    stateKeys: ["context"],
    readFile: async () => "expected"
  })
  assert.equal(unsafe.ok, false)
  assert.match(unsafe.issues.map((issue) => issue.message).join("\n"), /workspace-relative safe path/)

  const mismatch = await hydrateWorkflowStateFromArtifacts({
    workflow: workflow(),
    run: run(),
    manifest: { ...baseManifest, artifacts: [{ ...baseManifest.artifacts[0], path: ".bob/workflows/runs/source-run/artifacts/context.txt" }] },
    stateKeys: ["context"],
    readFile: async () => "actual"
  })
  assert.equal(mismatch.ok, false)
  assert.match(mismatch.issues.map((issue) => issue.message).join("\n"), /byte size does not match|checksum does not match/)
})
