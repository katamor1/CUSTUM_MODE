const assert = require("node:assert/strict")
const { test } = require("node:test")
const { readSrc } = require("./helpers/sourceReader")

test("Operation Hub next-step execution passes an AgentProvider into the standalone engine", () => {
  const runCommands = readSrc("workflowRunCommands.ts")
  const runtimeFactory = readSrc("workflowRuntimeFactory.ts")

  assert.match(runCommands, /const agentProvider = reviewTaskRegistry\.agentProviderForRun\(run\.runId, workflow\)/)
  assert.match(runCommands, /this\.options\.runtimeFactory\.createEngine\(selection\.root, agentProvider\)/)
  assert.match(runCommands, /await this\.reconcileBobTask\(selection\.root, result, workflow, "operation-hub-next"\)/)
  assert.match(runtimeFactory, /createEngine\(workspaceRoot: string, agentProvider\?: AgentProvider\): WorkflowEngine/)
  assert.match(runtimeFactory, /agentProvider: agentProvider \?\? this\.options\.agentProvider\(\) \?\? this\.createCommandAgentProvider\(\)/)
})

test("Operation Hub retry and resume execution reuses the run-scoped Bob AgentProvider", () => {
  const runCommands = readSrc("workflowRunCommands.ts")

  assert.match(runCommands, /private async resumeOrRetryRun\(mode: "resume" \| "retry", runId\?: string\): Promise<unknown>/)
  assert.match(runCommands, /const agentProvider = reviewTaskRegistry\.agentProviderForRun\(run\.runId, workflow\)/)
  assert.match(runCommands, /const engine = this\.options\.runtimeFactory\.createEngine\(selection\.root, agentProvider\)/)
  assert.match(runCommands, /mode === "resume" \? "operation-hub-resume" : "operation-hub-retry"/)
})
