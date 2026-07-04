const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")
const { createWorkflowEngineContext } = require("./helpers/workflowEngineFixtures")

test("workflow engine holds manual steps and resumes them", async () => {
  const { engine, workspaceRoot } = createWorkflowEngineContext()
  const workflow = {
    id: "workflow-register.manual",
    name: "manual",
    label: "Manual",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    engineSteps: [
      { id: "approve", title: "Approve", type: "manual" },
      {
        id: "write",
        title: "Write",
        type: "result",
        result: {
          source: "literal",
          text: "done",
          sinks: [
            {
              type: "file",
              path: ".bob/workflows/runs/{{run.id}}/steps/write.txt"
            }
          ]
        }
      }
    ]
  }

  const held = await engine.runWorkflow(workflow, {})
  const resumed = await engine.resumeRun(held.runId, {
    workflow,
    completeHeldStep: true
  })

  assert.equal(held.status, "held")
  assert.equal(held.currentStep, "approve")
  assert.equal(resumed.status, "completed")
  assert.equal(
    fs.readFileSync(path.join(workspaceRoot, ".bob", "workflows", "runs", held.runId, "steps", "write.txt"), "utf8"),
    "done"
  )
})

test("workflow engine pauses successful single-step execution for step review", async () => {
  const { actions, engine } = createWorkflowEngineContext({
    now: () => "2026-07-03T00:00:00.000Z"
  })
  actions.register({ id: "sample.collect", execute: async () => "context" })
  const workflow = {
    id: "workflow-register.review-gate",
    name: "review-gate",
    label: "Review Gate",
    description: "Review-gated workflow.",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    stepReview: {
      enabled: true,
      pauseAfter: "everyStep",
      requireAcceptBeforeNext: true,
      allowRetry: true,
      allowEditBeforeRetry: true,
      preserveAttempts: true
    },
    engineSteps: [
      {
        id: "collect",
        title: "Collect",
        type: "command",
        action: { provider: "sample.collect" },
        resultKey: "context"
      },
      {
        id: "next",
        title: "Next",
        type: "command",
        action: { provider: "sample.next" }
      }
    ]
  }

  const run = await engine.runWorkflow(
    workflow,
    {},
    { executionMode: "singleStep", stepId: "collect" }
  )

  assert.equal(run.status, "reviewing")
  assert.equal(run.currentStep, "collect")
  assert.equal(run.steps[0].status, "reviewing")
  assert.equal(run.steps[0].completedAt, undefined)
  assert.equal(run.state.context, "context")
})

test("retrying a reviewing step archives the rejected attempt state", async () => {
  const { actions, engine } = createWorkflowEngineContext({
    now: () => "2026-07-03T00:00:00.000Z"
  })
  let count = 0
  actions.register({ id: "sample.collect", execute: async () => `context-${++count}` })
  const workflow = {
    id: "workflow-register.review-retry",
    name: "review-retry",
    label: "Review Retry",
    description: "Review retry workflow.",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    stepReview: {
      enabled: true,
      pauseAfter: "everyStep",
      requireAcceptBeforeNext: true,
      allowRetry: true,
      allowEditBeforeRetry: true,
      preserveAttempts: true
    },
    engineSteps: [
      {
        id: "collect",
        title: "Collect",
        type: "command",
        action: { provider: "sample.collect" },
        resultKey: "context"
      }
    ]
  }

  const first = await engine.runWorkflow(
    workflow,
    {},
    { executionMode: "singleStep", stepId: "collect" }
  )
  const retried = await engine.retryCurrentStep(first.runId, workflow)

  assert.equal(retried.status, "reviewing")
  assert.equal(retried.state.context, "context-2")
  assert.equal(retried.steps[0].attempt, 2)
  assert.equal(retried.steps[0].attempts.length, 1)
  assert.equal(retried.steps[0].attempts[0].status, "reviewing")
  assert.equal(retried.steps[0].attempts[0].reviewDecision, "rejected")
  assert.equal(retried.steps[0].attempts[0].stateSnapshot.context, "context-1")
})

test("workflow engine manual completion controller can complete a held step in single-step mode", async () => {
  const completions = []
  const { engine } = createWorkflowEngineContext({
    engineOptions: {
      manualCompletion: async ({ run, step }) => {
        completions.push([run.runId, step.id])
        return { completed: true }
      }
    }
  })
  const workflow = {
    id: "workflow-register.manual-single",
    name: "manual-single",
    label: "Manual Single",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    engineSteps: [
      { id: "approve", title: "Approve", type: "manual" },
      {
        id: "next",
        title: "Next",
        type: "result",
        result: {
          source: "literal",
          text: "done",
          sinks: [
            {
              type: "file",
              path: ".bob/workflows/runs/{{run.id}}/steps/next.txt"
            }
          ]
        }
      }
    ]
  }

  const run = await engine.runWorkflow(
    workflow,
    {},
    { executionMode: "singleStep", stepId: "approve" }
  )

  assert.equal(run.status, "running")
  assert.equal(run.currentStep, "approve")
  assert.equal(run.steps[0].status, "completed")
  assert.equal(run.steps[1].status, "pending")
  assert.deepEqual(completions, [[run.runId, "approve"]])
})
