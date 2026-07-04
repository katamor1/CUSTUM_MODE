const assert = require("node:assert/strict")
const { test } = require("node:test")
const { createWorkflowEngineContext } = require("./helpers/workflowEngineFixtures")

test("workflow engine can execute a single requested step and leave the run recoverable", async () => {
  const calls = []
  const events = []
  const { actions, engine } = createWorkflowEngineContext({
    engineOptions: {
      hooks: {
        onWorkflowStart: async ({ run }) => events.push(["workflow-start", run.runId]),
        onStepStart: async ({ run, step }) => events.push(["step-start", run.runId, step.id]),
        onStepCompleted: async ({ run, step }) => events.push(["step-completed", run.runId, step.id])
      }
    }
  })
  actions.register({
    id: "sample.collect",
    execute: async (input) => {
      calls.push(["collect", input.runId, input.stepId])
      return `context-${input.inputs.revision}`
    }
  })
  actions.register({
    id: "sample.analyze",
    execute: async (input) => {
      calls.push(["analyze", input.runId, input.stepId, input.state.context])
      return `analysis-${input.state.context}`
    }
  })
  const workflow = {
    id: "workflow-register.single-step",
    name: "single-step",
    label: "Single Step",
    schemaVersion: "workflow-register/v1",
    inputs: { revision: { type: "string", required: true } },
    engineSteps: [
      {
        id: "collect",
        title: "Collect",
        type: "command",
        action: { provider: "sample.collect" },
        resultKey: "context"
      },
      {
        id: "analyze",
        title: "Analyze",
        type: "command",
        action: { provider: "sample.analyze" },
        resultKey: "analysis"
      }
    ]
  }

  const first = await engine.runWorkflow(
    workflow,
    { revision: "77" },
    { executionMode: "singleStep", stepId: "collect" }
  )
  const second = await engine.runWorkflow(
    workflow,
    { revision: "77" },
    { executionMode: "singleStep", stepId: "analyze" }
  )

  assert.equal(first.runId, second.runId)
  assert.equal(first.status, "running")
  assert.equal(first.currentStep, "collect")
  assert.equal(first.steps.map((step) => step.status).join(","), "completed,pending")
  assert.equal(second.status, "completed")
  assert.equal(second.state.context, "context-77")
  assert.equal(second.state.analysis, "analysis-context-77")
  assert.deepEqual(calls.map((call) => [call[0], call[2]]), [
    ["collect", "collect"],
    ["analyze", "analyze"]
  ])
  assert.deepEqual(events.map((event) => event[0]), [
    "workflow-start",
    "step-start",
    "step-completed",
    "step-start",
    "step-completed"
  ])
})

test("workflow engine blocks the next ordered single step while the previous step is reviewing", async () => {
  const { actions, engine } = createWorkflowEngineContext()
  actions.register({ id: "sample.collect", execute: async () => "context" })
  let analyzeCalls = 0
  actions.register({
    id: "sample.analyze",
    execute: async (input) => {
      analyzeCalls += 1
      return `analysis-${input.state.context}`
    }
  })
  const workflow = {
    id: "workflow-register.reviewed-single-step",
    name: "reviewed-single-step",
    label: "Reviewed Single Step",
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
        id: "analyze",
        title: "Analyze",
        type: "command",
        action: { provider: "sample.analyze" },
        resultKey: "analysis"
      }
    ]
  }

  const first = await engine.runWorkflow(workflow, {}, { executionMode: "singleStep", stepId: "collect" })
  const second = await engine.runWorkflow(workflow, {}, { executionMode: "singleStep", stepId: "analyze" })

  assert.equal(first.status, "reviewing")
  assert.equal(first.steps[0].status, "reviewing")
  assert.equal(second.status, "failed")
  assert.equal(second.steps[0].status, "reviewing")
  assert.equal(second.steps[0].acceptedAt, undefined)
  assert.equal(second.steps[1].status, "failed")
  assert.match(second.error, /cannot run before previous step 'collect' is completed/)
  assert.equal(second.state.analysis, undefined)
  assert.equal(analyzeCalls, 0)
})

test("workflow engine does not bypass reviewing steps with allowOutOfOrder", async () => {
  const { actions, engine } = createWorkflowEngineContext()
  actions.register({ id: "sample.collect", execute: async () => "context" })
  let analyzeCalls = 0
  actions.register({
    id: "sample.analyze",
    execute: async () => {
      analyzeCalls += 1
      return "analysis"
    }
  })
  const workflow = {
    id: "workflow-register.reviewed-single-step-out-of-order",
    name: "reviewed-single-step-out-of-order",
    label: "Reviewed Single Step Out Of Order",
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
        id: "analyze",
        title: "Analyze",
        type: "command",
        action: { provider: "sample.analyze" },
        resultKey: "analysis"
      }
    ]
  }

  const first = await engine.runWorkflow(workflow, {}, { executionMode: "singleStep", stepId: "collect" })
  const second = await engine.runWorkflow(workflow, {}, { executionMode: "singleStep", stepId: "analyze", allowOutOfOrder: true })

  assert.equal(first.steps[0].status, "reviewing")
  assert.equal(second.status, "failed")
  assert.equal(second.steps[0].status, "reviewing")
  assert.equal(second.steps[1].status, "failed")
  assert.match(second.error, /cannot run before previous step 'collect' is completed/)
  assert.equal(analyzeCalls, 0)
})

test("workflow engine rejects out-of-order single-step execution by default", async () => {
  const { actions, engine } = createWorkflowEngineContext({
    now: () => "2026-07-03T00:00:00.000Z"
  })
  let analyzeCalls = 0
  actions.register({ id: "sample.collect", execute: async () => "context" })
  actions.register({
    id: "sample.analyze",
    execute: async () => {
      analyzeCalls += 1
      return "analysis"
    }
  })
  const workflow = {
    id: "workflow-register.ordered-single",
    name: "ordered-single",
    label: "Ordered Single",
    description: "Ordered single-step workflow.",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    engineSteps: [
      {
        id: "collect",
        title: "Collect",
        type: "command",
        action: { provider: "sample.collect" },
        resultKey: "context"
      },
      {
        id: "analyze",
        title: "Analyze",
        type: "command",
        action: { provider: "sample.analyze" },
        resultKey: "analysis"
      }
    ]
  }

  const run = await engine.runWorkflow(
    workflow,
    {},
    { executionMode: "singleStep", stepId: "analyze" }
  )

  assert.equal(run.status, "failed")
  assert.equal(run.currentStep, "analyze")
  assert.equal(run.steps[0].status, "pending")
  assert.equal(run.steps[1].status, "failed")
  assert.match(run.error, /cannot run before previous step 'collect' is completed/)
  assert.equal(analyzeCalls, 0)
})

test("workflow engine can explicitly allow out-of-order single-step execution", async () => {
  const { actions, engine } = createWorkflowEngineContext({
    now: () => "2026-07-03T00:00:00.000Z"
  })
  actions.register({ id: "sample.analyze", execute: async () => "analysis" })
  const workflow = {
    id: "workflow-register.out-of-order",
    name: "out-of-order",
    label: "Out of Order",
    description: "Out-of-order workflow.",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    engineSteps: [
      {
        id: "collect",
        title: "Collect",
        type: "command",
        action: { provider: "sample.collect" },
        resultKey: "context"
      },
      {
        id: "analyze",
        title: "Analyze",
        type: "command",
        action: { provider: "sample.analyze" },
        resultKey: "analysis"
      }
    ]
  }

  const run = await engine.runWorkflow(
    workflow,
    {},
    {
      executionMode: "singleStep",
      stepId: "analyze",
      allowOutOfOrder: true
    }
  )

  assert.equal(run.status, "completed")
  assert.equal(run.steps[0].status, "pending")
  assert.equal(run.steps[1].status, "completed")
  assert.equal(run.state.analysis, "analysis")
})
