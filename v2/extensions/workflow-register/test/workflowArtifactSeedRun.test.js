const assert = require("node:assert/strict")
const { test } = require("node:test")

function workflow() {
  return {
    id: "workflow-register.seed",
    name: "seed",
    label: "Seed",
    description: "Seed workflow.",
    schemaVersion: "workflow-register/v1",
    definitionHash: "definition-v1",
    inputs: {},
    engineSteps: [
      { id: "collect", title: "Collect", type: "agent", resultKey: "context" },
      { id: "analyze", title: "Analyze", type: "agent", includeState: ["context"], stateRequired: true, resultKey: "analysis" },
      { id: "summarize", title: "Summarize", type: "agent", includeState: ["analysis"], stateRequired: true, resultKey: "summary" }
    ]
  }
}

function run() {
  return {
    runId: "target-run",
    workflowId: "workflow-register.seed",
    workflowName: "seed",
    status: "running",
    currentStep: "collect",
    inputs: {},
    state: { context: "hydrated context" },
    steps: workflow().engineSteps.map((step) => ({ id: step.id, title: step.title, type: step.type, status: "pending" })),
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z"
  }
}

test("seedWorkflowRunFromArtifacts marks prior steps completed and stores reuse provenance", () => {
  const { seedWorkflowRunFromArtifacts, stateKeysProducedBeforeStep } = require("../out/core/artifacts/seedRun")
  const targetRun = run()
  const result = seedWorkflowRunFromArtifacts({
    workflow: workflow(),
    run: targetRun,
    manifest: {
      schemaVersion: "workflow-register/artifact-manifest/v1",
      workflowId: "workflow-register.seed",
      workflowDefinitionHash: "definition-v1",
      runId: "source-run",
      inputsHash: "sha256:ignored",
      createdAt: "2026-07-08T00:00:00.000Z",
      updatedAt: "2026-07-08T00:00:00.000Z",
      artifacts: []
    },
    startStepId: "analyze",
    hydratedKeys: ["context"],
    now: () => "2026-07-08T00:00:01.000Z"
  })

  assert.deepEqual(stateKeysProducedBeforeStep(workflow(), "analyze"), ["context"])
  assert.equal(result.ok, true, result.error)
  assert.deepEqual(result.reusedStepIds, ["collect"])
  assert.equal(targetRun.currentStep, "analyze")
  assert.equal(targetRun.steps[0].status, "completed")
  assert.equal(targetRun.steps[1].status, "pending")
  assert.equal(targetRun.steps[2].status, "pending")
  const provenance = JSON.parse(targetRun.state["workflow.artifactReuse"])
  assert.equal(provenance.schemaVersion, "workflow-register/artifact-reuse/v1")
  assert.equal(provenance.sourceRunId, "source-run")
  assert.equal(provenance.startStepId, "analyze")
  assert.deepEqual(provenance.hydratedKeys, ["context"])
})

test("seedWorkflowRunFromArtifacts rejects missing prior produced state", () => {
  const { seedWorkflowRunFromArtifacts } = require("../out/core/artifacts/seedRun")
  const targetRun = run()
  delete targetRun.state.context
  const result = seedWorkflowRunFromArtifacts({
    workflow: workflow(),
    run: targetRun,
    manifest: {
      schemaVersion: "workflow-register/artifact-manifest/v1",
      workflowId: "workflow-register.seed",
      runId: "source-run",
      inputsHash: "sha256:ignored",
      createdAt: "2026-07-08T00:00:00.000Z",
      updatedAt: "2026-07-08T00:00:00.000Z",
      artifacts: []
    },
    startStepId: "analyze",
    hydratedKeys: []
  })

  assert.equal(result.ok, false)
  assert.match(result.error, /prior step state is missing: context/)
})
