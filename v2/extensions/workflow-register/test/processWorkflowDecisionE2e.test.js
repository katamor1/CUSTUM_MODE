const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const fsSync = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")
const yaml = require("js-yaml")

const { createDefaultActionRegistry } = require("../out/core/actionRegistry")
const { WorkflowEngine } = require("../out/core/engine")
const { parseWorkflowMarkdown } = require("../out/core/parser")
const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")

const repoRoot = path.resolve(__dirname, "..", "..", "..")
const catalog = yaml.load(fsSync.readFileSync(path.join(repoRoot, ".bob", "process", "process-catalog.yaml"), "utf8"))
const fixedTime = "2026-07-12T00:00:00.000Z"
const fixedInputs = { processInputPath: "process-input.yaml", catalogPath: ".bob/process/process-catalog.yaml" }
const terminalError = "Workflow transition 'default' failed the run at step 'human-gate'."

class FixedRunStateStore {
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot
    this.run = undefined
  }

  async createRun(workflow, inputs) {
    return {
      runId: "run-001",
      workflowId: workflow.id,
      workflowName: workflow.name,
      workflowSchemaVersion: workflow.schemaVersion,
      workflowDefinitionHash: workflow.definitionHash,
      workflowFile: workflow.filePath,
      status: "running",
      currentStep: workflow.engineSteps[0]?.id,
      inputs,
      state: {},
      steps: workflow.engineSteps.map((step) => ({
        id: step.id,
        title: step.title,
        type: step.type,
        status: "pending"
      })),
      createdAt: fixedTime,
      updatedAt: fixedTime
    }
  }

  async saveRun(run) {
    this.run = structuredClone({ ...run, updatedAt: fixedTime })
  }

  async loadRun(runId) {
    return this.run?.runId === runId ? structuredClone(this.run) : undefined
  }

  async listRuns() {
    return this.run ? [structuredClone(this.run)] : []
  }

  async findRecoverableRun() {
    return this.run ? structuredClone(this.run) : undefined
  }
}

test("catalog process workflows branch deterministically on human decisions", async (t) => {
  const scenarios = [
    { name: "approve", decision: "approved", approved: true },
    { name: "reject", decision: "rejected", approved: false },
    { name: "missing decision", decision: undefined, approved: false },
    { name: "unknown decision", decision: "unknown", approved: false }
  ]

  for (const entry of catalog.workflows) {
    await t.test(entry.name, async (t) => {
      for (const scenario of scenarios) {
        await t.test(scenario.name, async (t) => {
          const result = await runDecisionScenario(t, entry, scenario.decision)
          if (scenario.approved) {
            await assertApproved(result)
          } else {
            await assertTerminated(result, scenario.decision)
          }
        })
      }
    })
  }
})

async function assertApproved(result) {
  assert.equal(result.run.status, "completed")
  assert.equal(result.run.currentStep, undefined)
  assert.equal(result.run.error, undefined)
  assert.equal(result.calls.get("bobProcess.writeProcessRecord") ?? 0, 1)
  assert.equal(result.calls.get("bobProcess.generateCampaignSummary") ?? 0, 1)
  assert.deepEqual(result.reviewedSteps, ["write-process-record", "generate-campaign-summary"])
  assert.equal(JSON.parse(result.run.state.humanGate).decision, "approved")
  assert.equal(JSON.parse(result.run.state.processRecord).command, "bobProcess.writeProcessRecord")
  assert.equal(JSON.parse(result.run.state.campaignSummary).command, "bobProcess.generateCampaignSummary")
  assert.equal(await exists(result.recordPath), true)
  assert.equal(await exists(result.summaryPath), true)
}

async function assertTerminated(result, decision) {
  assert.equal(result.run.status, "failed")
  assert.equal(result.run.currentStep, "human-gate")
  assert.equal(result.run.error, terminalError)
  assert.equal(result.calls.get("bobProcess.writeProcessRecord") ?? 0, 0)
  assert.equal(result.calls.get("bobProcess.generateCampaignSummary") ?? 0, 0)
  assert.deepEqual(result.reviewedSteps, [])
  assert.equal(result.run.state.processRecord, undefined)
  assert.equal(result.run.state.campaignSummary, undefined)
  if (decision === undefined) {
    assert.equal(result.run.state.humanGate, undefined)
  } else {
    assert.equal(JSON.parse(result.run.state.humanGate).decision, decision)
  }
  assert.equal(await exists(result.recordPath), false)
  assert.equal(await exists(result.summaryPath), false)
  const humanGate = result.run.steps.find((step) => step.id === "human-gate")
  assert.equal(humanGate.status, "completed")
  assert.equal(result.run.branching.history.at(-1).decisionId, "default")
  assert.equal(result.run.branching.history.at(-1).action, "fail")
}

async function runDecisionScenario(t, entry, decision) {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "process-workflow-decision-"))
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }))
  const workflow = parseCatalogWorkflow(entry)
  workflow.workflowRoot = workspaceRoot
  const calls = new Map()
  const actions = createDefaultActionRegistry({
    executeCommand: async (command) => {
      calls.set(command, (calls.get(command) ?? 0) + 1)
      return { status: "ok", diagnostics: [], command }
    }
  })
  const runStore = new FixedRunStateStore(workspaceRoot)
  const engine = new WorkflowEngine({
    actions,
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore,
    manualCompletion: async ({ step }) => {
      assert.equal(step.id, "human-gate")
      return decision === undefined
        ? { completed: true }
        : { completed: true, approval: { decision } }
    }
  })
  const seeded = await runStore.createRun(workflow, fixedInputs)
  const humanGateIndex = workflow.engineSteps.findIndex((step) => step.id === "human-gate")
  assert.notEqual(humanGateIndex, -1)
  for (let index = 0; index < humanGateIndex; index += 1) {
    seeded.steps[index].status = "completed"
    seeded.steps[index].completedAt = fixedTime
  }
  seeded.status = "running"
  seeded.currentStep = "human-gate"
  seeded.state.processInput = JSON.stringify({ input: { campaignId: "campaign-alpha" } })
  await runStore.saveRun(seeded)

  let run = seeded
  const reviewedSteps = []
  for (let guard = 0; guard < 10 && (run.status === "running" || run.status === "reviewing"); guard += 1) {
    if (run.status === "reviewing") {
      reviewedSteps.push(run.currentStep)
      run = acceptReviewingStep(run)
      await runStore.saveRun(run)
      continue
    }
    const nextStep = nextPendingStep(run)
    if (!nextStep) break
    run = await engine.runWorkflow(workflow, fixedInputs, { executionMode: "singleStep", stepId: nextStep.id })
  }

  return {
    calls,
    recordPath: path.join(workspaceRoot, ".bob-process-records", "campaigns", "campaign-alpha", "records", "run-001", "record.yaml"),
    reviewedSteps,
    run,
    summaryPath: path.join(workspaceRoot, ".bob-process-records", "campaigns", "campaign-alpha", "summary.yaml"),
    workflow
  }
}

function parseCatalogWorkflow(entry) {
  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: entry.workflowPath,
    text: fsSync.readFileSync(path.join(repoRoot, ...entry.workflowPath.split("/")), "utf8")
  })
  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  return parsed.workflow
}

function nextPendingStep(run) {
  const current = run.currentStep ? run.steps.find((step) => step.id === run.currentStep) : undefined
  if (current?.status === "pending") return current
  return run.steps.find((step) => step.status === "pending")
}

function acceptReviewingStep(run) {
  assert.equal(run.status, "reviewing")
  const currentIndex = run.steps.findIndex((step) => step.id === run.currentStep)
  assert.notEqual(currentIndex, -1)
  const current = run.steps[currentIndex]
  assert.equal(current.status, "reviewing")
  current.status = "completed"
  current.acceptedAt = fixedTime
  current.completedAt = fixedTime
  current.error = undefined
  const next = run.steps.find((step, index) => index > currentIndex && step.status === "pending")
  run.status = next ? "running" : "completed"
  run.currentStep = next?.id
  run.error = undefined
  return run
}

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
