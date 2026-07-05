const test = require("node:test")
const assert = require("node:assert/strict")
const { createWorkflowEngineContext } = require("./helpers/workflowEngineFixtures")

function branchingWorkflow() {
  return {
    id: "workflow-register.branching-engine",
    name: "branching-engine",
    label: "Branching Engine",
    description: "Branching engine workflow.",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    branching: {
      enabled: true,
      loops: [
        {
          id: "revise-until-approved",
          entryStep: "collect-user-input",
          maxIterations: 5,
          extensionSize: 5,
          checkpoint: {
            title: "Loop limit reached",
            message: "Review the current inputs before continuing."
          }
        }
      ]
    },
    engineSteps: [
      {
        id: "collect-user-input",
        title: "Collect user input",
        type: "command",
        action: { provider: "sample.collect" },
        resultKey: "userRequest"
      },
      {
        id: "generate-draft",
        title: "Generate draft",
        type: "agent",
        includeState: ["userRequest"],
        resultKey: "generatedDraft",
        prompt: "Generate a draft from {{state.userRequest}}."
      },
      {
        id: "preapproval-check",
        title: "Preapproval check",
        type: "command",
        includeState: ["userRequest", "generatedDraft"],
        action: { provider: "sample.preapproval" },
        resultKey: "preapproval",
        transition: {
          decisions: [
            {
              id: "preapproval-ng",
              when: { stateKey: "preapproval.status", equals: "ng" },
              goto: "collect-user-input",
              loop: "revise-until-approved"
            }
          ],
          default: "next"
        }
      },
      {
        id: "finalize",
        title: "Finalize",
        type: "command",
        includeState: ["generatedDraft", "preapproval"],
        action: { provider: "sample.finalize" },
        resultKey: "final"
      }
    ]
  }
}

function workflowWithLoopLimit(maxIterations = 1) {
  const workflow = branchingWorkflow()
  workflow.branching.loops[0].maxIterations = maxIterations
  workflow.branching.loops[0].extensionSize = 2
  return workflow
}

function acceptReviewingStepForTest(run) {
  assert.equal(run.status, "reviewing")
  const currentIndex = run.currentStep ? run.steps.findIndex((step) => step.id === run.currentStep) : -1
  assert.notEqual(currentIndex, -1)
  const current = run.steps[currentIndex]
  assert.equal(current.status, "reviewing")
  current.status = "completed"
  current.acceptedAt = "2026-07-03T00:00:00.000Z"
  current.completedAt = "2026-07-03T00:00:00.000Z"
  current.error = undefined
  if (run.state["workflow.review.pendingTransitionStepId"] === current.id) {
    run.status = "running"
    run.currentStep = current.id
    run.error = undefined
    return run
  }
  const nextIndex = run.steps.findIndex((step, index) => index > currentIndex && step.status === "pending")
  if (nextIndex < 0) {
    run.status = "completed"
    run.currentStep = undefined
  } else {
    run.status = "running"
    run.currentStep = run.steps[nextIndex].id
  }
  run.error = undefined
  return run
}

test("workflow engine loops backward in full mode and reruns the reset range", async () => {
  const { actions, engine } = createWorkflowEngineContext()
  let collectCount = 0
  let agentCount = 0
  let preapprovalCount = 0
  actions.register({
    id: "sample.collect",
    execute: async () => ({ request: `request-${++collectCount}` })
  })
  actions.register({
    id: "sample.preapproval",
    execute: async () => ({ status: ++preapprovalCount === 1 ? "ng" : "ok" })
  })
  actions.register({
    id: "sample.finalize",
    execute: async ({ state }) => ({ draft: state.generatedDraft, status: JSON.parse(state.preapproval).status })
  })
  const workflow = branchingWorkflow()
  const agentTexts = []
  const { engine: engineWithAgent } = createWorkflowEngineContext({
    actions,
    engineOptions: {
      agentProvider: {
        run: async ({ state }) => {
          agentCount += 1
          const request = JSON.parse(state.userRequest).request
          const text = `draft-${agentCount}-from-${request}`
          agentTexts.push(text)
          return text
        }
      }
    }
  })

  const run = await engineWithAgent.runWorkflow(workflow, {})

  assert.equal(run.status, "completed")
  assert.equal(collectCount, 2)
  assert.equal(agentCount, 2)
  assert.equal(preapprovalCount, 2)
  assert.equal(JSON.parse(run.state.userRequest).request, "request-2")
  assert.equal(run.state.generatedDraft, "draft-2-from-request-2")
  assert.equal(JSON.parse(run.state.preapproval).status, "ok")
  assert.equal(JSON.parse(run.state.final).status, "ok")
  assert.equal(run.branching.loops["revise-until-approved"].count, 1)
  assert.equal(run.branching.history[0].decisionId, "preapproval-ng")
  assert.equal(run.branching.history[0].fromStepId, "preapproval-check")
  assert.equal(run.branching.history[0].toStepId, "collect-user-input")
  assert.deepEqual(agentTexts, ["draft-1-from-request-1", "draft-2-from-request-2"])
  assert.equal(run.steps[0].attempt, 2)
  assert.equal(run.steps[1].attempt, 2)
  assert.equal(run.steps[2].attempt, 2)
  assert.equal(run.steps[1].attempts[0].stateSnapshot.generatedDraft, "draft-1-from-request-1")
})

test("workflow engine applies backward transition without continuing in single-step mode", async () => {
  const { actions, engine } = createWorkflowEngineContext({
    engineOptions: {
      agentProvider: {
        run: async ({ state }) => `draft-from-${JSON.parse(state.userRequest).request}`
      }
    }
  })
  actions.register({
    id: "sample.collect",
    execute: async () => ({ request: "first-request" })
  })
  actions.register({
    id: "sample.preapproval",
    execute: async () => ({ status: "ng" })
  })
  actions.register({
    id: "sample.finalize",
    execute: async () => ({ ok: true })
  })
  const workflow = branchingWorkflow()

  await engine.runWorkflow(workflow, {}, { executionMode: "singleStep", stepId: "collect-user-input" })
  await engine.runWorkflow(workflow, {}, { executionMode: "singleStep", stepId: "generate-draft" })
  const run = await engine.runWorkflow(workflow, {}, { executionMode: "singleStep", stepId: "preapproval-check" })

  assert.equal(run.status, "running")
  assert.equal(run.currentStep, "collect-user-input")
  assert.equal(run.steps[0].status, "pending")
  assert.equal(run.steps[1].status, "pending")
  assert.equal(run.steps[2].status, "pending")
  assert.equal(run.state.userRequest, undefined)
  assert.equal(run.state.generatedDraft, undefined)
  assert.equal(run.state.preapproval, undefined)
  assert.equal(run.state["workflow.branching.lastValues.collect-user-input.userRequest"], "{\"request\":\"first-request\"}")
  assert.equal(run.state["workflow.branching.lastValues.generate-draft.generatedDraft"], "draft-from-first-request")
  assert.equal(run.branching.loops["revise-until-approved"].count, 1)
})

test("workflow engine applies reviewed step transitions before running the accepted next step", async () => {
  const { actions, engine, runStore } = createWorkflowEngineContext({
    engineOptions: {
      agentProvider: {
        run: async ({ state }) => `draft-from-${JSON.parse(state.userRequest).request}`
      }
    }
  })
  let finalizeCount = 0
  actions.register({
    id: "sample.collect",
    execute: async () => ({ request: "first-request" })
  })
  actions.register({
    id: "sample.preapproval",
    execute: async () => ({ status: "ng" })
  })
  actions.register({
    id: "sample.finalize",
    execute: async () => {
      finalizeCount += 1
      return { ok: true }
    }
  })
  const workflow = {
    ...branchingWorkflow(),
    stepReview: {
      enabled: true,
      pauseAfter: "everyStep",
      requireAcceptBeforeNext: true,
      allowRetry: true,
      allowEditBeforeRetry: true,
      preserveAttempts: true
    }
  }

  const collected = acceptReviewingStepForTest(await engine.runWorkflow(workflow, {}, { executionMode: "singleStep", stepId: "collect-user-input" }))
  await runStore.saveRun(collected)
  const generated = acceptReviewingStepForTest(await engine.runWorkflow(workflow, {}, { executionMode: "singleStep", stepId: collected.currentStep }))
  await runStore.saveRun(generated)
  const reviewed = await engine.runWorkflow(workflow, {}, { executionMode: "singleStep", stepId: generated.currentStep })
  const accepted = acceptReviewingStepForTest(reviewed)
  await runStore.saveRun(accepted)

  const run = await engine.runWorkflow(workflow, {}, { executionMode: "singleStep", stepId: accepted.currentStep })

  assert.equal(run.status, "running")
  assert.equal(run.currentStep, "collect-user-input")
  assert.equal(run.steps[0].status, "pending")
  assert.equal(run.steps[1].status, "pending")
  assert.equal(run.steps[2].status, "pending")
  assert.equal(run.state.userRequest, undefined)
  assert.equal(run.state.generatedDraft, undefined)
  assert.equal(run.state.preapproval, undefined)
  assert.equal(run.branching.loops["revise-until-approved"].count, 1)
  assert.equal(finalizeCount, 0)
})

test("workflow engine stops at a checkpoint when a loop exceeds its allowed count", async () => {
  const { actions, engine } = createWorkflowEngineContext({
    engineOptions: {
      agentProvider: {
        run: async ({ state }) => `draft-from-${JSON.parse(state.userRequest).request}`
      }
    }
  })
  let collectCount = 0
  let preapprovalCount = 0
  actions.register({
    id: "sample.collect",
    execute: async () => ({ request: `request-${++collectCount}` })
  })
  actions.register({
    id: "sample.preapproval",
    execute: async () => {
      preapprovalCount += 1
      return { status: preapprovalCount <= 2 ? "ng" : "ok" }
    }
  })
  actions.register({
    id: "sample.finalize",
    execute: async () => ({ ok: true })
  })

  const run = await engine.runWorkflow(workflowWithLoopLimit(1), {})

  assert.equal(run.status, "checkpoint")
  assert.equal(run.currentStep, "collect-user-input")
  assert.equal(collectCount, 2)
  assert.equal(preapprovalCount, 2)
  assert.equal(run.branching.loops["revise-until-approved"].count, 1)
  assert.equal(run.branching.loops["revise-until-approved"].allowed, 1)
  assert.equal(run.branching.loops["revise-until-approved"].checkpointCount, 1)
  assert.equal(run.branching.checkpoint.loopId, "revise-until-approved")
  assert.equal(run.branching.checkpoint.fromStepId, "preapproval-check")
  assert.equal(run.branching.checkpoint.toStepId, "collect-user-input")
  assert.equal(run.branching.checkpoint.count, 1)
  assert.equal(run.branching.checkpoint.allowed, 1)
  assert.equal(run.branching.history.at(-1).action, "checkpoint")
})

test("workflow engine approves and aborts branch checkpoints explicitly", async () => {
  async function createCheckpointedRun() {
    const { actions, engine } = createWorkflowEngineContext({
      engineOptions: {
        agentProvider: {
          run: async ({ state }) => `draft-from-${JSON.parse(state.userRequest).request}`
        }
      }
    })
    let collectCount = 0
    let preapprovalCount = 0
    actions.register({
      id: "sample.collect",
      execute: async () => ({ request: `request-${++collectCount}` })
    })
    actions.register({
      id: "sample.preapproval",
      execute: async () => ({ status: ++preapprovalCount <= 2 ? "ng" : "ok" })
    })
    actions.register({
      id: "sample.finalize",
      execute: async () => ({ ok: true })
    })
    const workflow = workflowWithLoopLimit(1)
    const checkpointed = await engine.runWorkflow(workflow, {})
    return { engine, workflow, checkpointed }
  }
  const { engine, workflow, checkpointed } = await createCheckpointedRun()

  const approved = await engine.approveBranchCheckpoint(checkpointed.runId, workflow)

  assert.equal(approved.status, "running")
  assert.equal(approved.currentStep, "collect-user-input")
  assert.equal(approved.branching.checkpoint, undefined)
  assert.equal(approved.branching.loops["revise-until-approved"].count, 2)
  assert.equal(approved.branching.loops["revise-until-approved"].allowed, 3)
  assert.equal(approved.steps[0].status, "pending")
  assert.equal(approved.steps[1].status, "pending")
  assert.equal(approved.steps[2].status, "pending")
  assert.equal(approved.branching.history.at(-1).action, "goto")

  const second = await createCheckpointedRun()
  const aborted = await second.engine.abortBranchCheckpoint(second.checkpointed.runId, "User aborted branch checkpoint.")

  assert.equal(aborted.status, "failed")
  assert.equal(aborted.error, "User aborted branch checkpoint.")
  assert.equal(aborted.branching.checkpoint, undefined)
})

test("workflow engine stores structured manual form values in workflow state", async () => {
  const seen = []
  const { actions, engine } = createWorkflowEngineContext({
    engineOptions: {
      manualCompletion: async ({ step }) => {
        if (step.id !== "collect-user-input") return { completed: false }
        return { completed: true, formValues: { request: "structured request", constraints: "short" } }
      }
    }
  })
  actions.register({
    id: "sample.consume",
    execute: async ({ state }) => {
      seen.push(JSON.parse(state.userRequest))
      return { ok: true }
    }
  })
  const workflow = {
    id: "workflow-register.manual-form",
    name: "manual-form",
    label: "Manual Form",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    engineSteps: [
      {
        id: "collect-user-input",
        title: "Collect user input",
        type: "manual",
        form: {
          resultKey: "userRequest",
          fields: [
            { id: "request", type: "string", required: true },
            { id: "constraints", type: "string" }
          ]
        }
      },
      {
        id: "consume",
        title: "Consume",
        type: "command",
        includeState: ["userRequest"],
        action: { provider: "sample.consume" },
        resultKey: "consumed"
      }
    ]
  }

  const run = await engine.runWorkflow(workflow, {})

  assert.equal(run.status, "completed")
  assert.deepEqual(JSON.parse(run.state.userRequest), { request: "structured request", constraints: "short" })
  assert.deepEqual(seen, [{ request: "structured request", constraints: "short" }])
})

test("workflow engine rejects reserved manual result keys before prompting", async () => {
  let prompted = false
  const { engine } = createWorkflowEngineContext({
    engineOptions: {
      manualCompletion: async () => {
        prompted = true
        return { completed: true, formValues: { request: "unsafe" } }
      }
    }
  })
  const workflow = {
    id: "workflow-register.manual-reserved-result-key",
    name: "manual-reserved-result-key",
    label: "Manual Reserved Result Key",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    engineSteps: [
      {
        id: "collect-user-input",
        title: "Collect user input",
        type: "manual",
        form: {
          resultKey: "workflow.review.userRequest",
          fields: [
            { id: "request", type: "string", required: true }
          ]
        }
      }
    ]
  }

  const run = await engine.runWorkflow(workflow, {})

  assert.equal(run.status, "failed")
  assert.match(run.error, /Reserved workflow state key/)
  assert.equal(run.state["workflow.review.userRequest"], undefined)
  assert.equal(prompted, false)
})

test("workflow engine stores manual approval decisions and applies reject transitions", async () => {
  const { actions, engine } = createWorkflowEngineContext({
    engineOptions: {
      manualCompletion: async ({ step }) => {
        if (step.id !== "user-approval") return { completed: false }
        approvalCount += 1
        return {
          completed: true,
          approval: {
            decision: approvalCount === 1 ? "rejected" : "approved",
            reason: approvalCount === 1 ? "needs revision" : undefined
          }
        }
      }
    }
  })
  let collectCount = 0
  let approvalCount = 0
  actions.register({
    id: "sample.collect",
    execute: async () => ({ request: `request-${++collectCount}` })
  })
  actions.register({
    id: "sample.finalize",
    execute: async ({ state }) => ({ decision: JSON.parse(state.userApproval).decision })
  })
  const workflow = {
    id: "workflow-register.manual-approval",
    name: "manual-approval",
    label: "Manual Approval",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    branching: {
      enabled: true,
      loops: [
        {
          id: "approval-loop",
          entryStep: "collect-user-input",
          maxIterations: 5,
          extensionSize: 5
        }
      ]
    },
    engineSteps: [
      {
        id: "collect-user-input",
        title: "Collect user input",
        type: "command",
        action: { provider: "sample.collect" },
        resultKey: "userRequest"
      },
      {
        id: "user-approval",
        title: "User approval",
        type: "manual",
        includeState: ["userRequest"],
        approval: {
          resultKey: "userApproval",
          approveLabel: "Approve",
          rejectLabel: "Reject"
        },
        transition: {
          decisions: [
            {
              id: "user-rejected",
              when: { stateKey: "userApproval.decision", equals: "rejected" },
              goto: "collect-user-input",
              loop: "approval-loop"
            }
          ],
          default: "next"
        }
      },
      {
        id: "finalize",
        title: "Finalize",
        type: "command",
        includeState: ["userApproval"],
        action: { provider: "sample.finalize" },
        resultKey: "final"
      }
    ]
  }

  const run = await engine.runWorkflow(workflow, {})

  assert.equal(run.status, "completed")
  assert.equal(collectCount, 2)
  assert.equal(approvalCount, 2)
  assert.equal(JSON.parse(run.state.userApproval).decision, "approved")
  assert.equal(JSON.parse(run.state.final).decision, "approved")
  assert.equal(run.branching.loops["approval-loop"].count, 1)
  assert.equal(run.steps[1].attempt, 2)
  assert.equal(JSON.parse(run.steps[1].attempts[0].stateSnapshot.userApproval).decision, "rejected")
})
