const assert = require("node:assert/strict")
const path = require("node:path")
const { test } = require("node:test")

const outRoot = path.resolve(__dirname, "..", "out")
const { createBobWorkflow } = require(path.join(outRoot, "bobWorkflowFactory.js"))

function definition(overrides = {}) {
  return {
    id: "workflow-register.sample",
    label: "Sample",
    menuLabel: "Sample",
    description: "Sample workflow.",
    mode: "agent",
    permissions: ["read"],
    autoApprovalEnabled: true,
    workspaceRequired: false,
    hidden: false,
    todoEnabled: true,
    todoAsSteps: true,
    stepExecution: { mode: "engineSteps", allowOutOfOrder: false, showInBob: true },
    todos: [{ id: "todo-only", text: "Todo only", raw: "todo-only: Todo only" }],
    core: {
      engineSteps: [
        { id: "collect", title: "Collect", type: "command" },
        { id: "review", title: "Review", type: "agent" }
      ]
    },
    ...overrides
  }
}

test("Bob workflow factory renders engine steps when stepExecution mode is engineSteps", async () => {
  const calls = []
  const workflow = createBobWorkflow(definition(), {
    runSingleWorkflowStep: async () => { calls.push(["single"]); return true },
    runTodoStep: async (todo) => { calls.push(["todo", todo.id]); return true },
    runEngineStep: async (stepId) => { calls.push(["engine", stepId]); return true }
  })

  const steps = workflow.getSteps()
  assert.deepEqual(steps.map((step) => [step.id, step.title]), [["collect", "Collect"], ["review", "Review"]])
  assert.equal(await steps[1].execution({}), true)
  assert.deepEqual(calls, [["engine", "review"]])
})

test("Bob workflow factory keeps legacy Todo step mode when stepExecution mode is todo", async () => {
  const calls = []
  const workflow = createBobWorkflow(definition({ stepExecution: { mode: "todo", allowOutOfOrder: false, showInBob: true } }), {
    runSingleWorkflowStep: async () => { calls.push(["single"]); return true },
    runTodoStep: async (todo) => { calls.push(["todo", todo.id]); return true },
    runEngineStep: async (stepId) => { calls.push(["engine", stepId]); return true }
  })

  const steps = workflow.getSteps()
  assert.deepEqual(steps.map((step) => [step.id, step.title]), [["todo-only", "Todo only"]])
  assert.equal(await steps[0].execution({}), true)
  assert.deepEqual(calls, [["todo", "todo-only"]])
})
