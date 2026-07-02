# Review-Gated Step Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote `WorkflowEngine` single-step execution into a review-gated workflow UX where each engine step can run, stop in `reviewing`, be accepted or retried, then advance to the next step.

**Architecture:** Keep execution shape and review policy separate. `stepExecution` controls whether Bob displays one workflow step, Todo-derived steps, or `steps[]` engine steps; `stepReview` controls whether successful step output pauses for human review before the step is marked completed. Reuse existing `WorkflowEngine`, `RunStateStore`, `stepReview`, `reviewing` status, and task snapshot infrastructure, adding only the missing schema, Bob adapter, command, and attempt-history behavior.

**Tech Stack:** TypeScript VS Code extension, Node.js test runner, AJV JSON schema, `js-yaml`, existing `workflow-register` runtime and tests.

---

## Scope Decisions

- Implement this as **review-gated step execution**, not generic free-form step jumping.
- Keep `manual completion` and `stepReview` separate:
  - `held` remains for manual/external waiting.
  - `reviewing` means execution succeeded and human accept/retry is required.
- Do not add `skipped` in the first implementation. There is no skip UX in the requested flow, and adding status without behavior would widen the contract unnecessarily.
- Default `stepReview` behavior already exists; this plan makes it effective for both `full` and `singleStep` runs.
- `allowOutOfOrder` defaults to `false`. Running arbitrary later steps before prior steps complete is rejected unless explicitly enabled.
- Workflow edits before retry are allowed only through existing `stepReview.allowEditBeforeRetry`; compatibility checks remain strict for step id/order and previous completed steps.

## File Map

- Modify `extensions/workflow-register/src/core/model.ts`
  - Add `WorkflowStepExecutionDefinition`.
  - Add attempt review fields to `RunStepAttempt`.
- Modify `extensions/workflow-register/src/core/workflowSchema.ts`
  - Add `stepExecution` runtime schema.
- Modify `extensions/workflow-register/schema/workflow-register.v1.schema.json`
  - Mirror `stepExecution` public JSON schema.
- Modify `extensions/workflow-register/src/core/parser/normalizers.ts`
  - Add `normalizeStepExecution`.
- Modify `extensions/workflow-register/src/core/parser/parseV1Workflow.ts`
  - Normalize `stepExecution` with backward-compatible defaults.
- Modify `extensions/workflow-register/src/core/engine/runState.ts`
  - Add single-step order validation.
  - Let `shouldPauseForStepReview` pause in `singleStep` as well as `full`.
  - Add reusable accept/archive helpers if needed.
- Modify `extensions/workflow-register/src/core/engine.ts`
  - Pass `allowOutOfOrder`.
  - Persist failed rejection for out-of-order requests.
  - Preserve attempt history on retry and reviewing rejection.
- Modify `extensions/workflow-register/src/core/runStateStore.ts`
  - Include `allowOutOfOrder` in lookup option types.
- Modify `extensions/workflow-register/src/bobWorkflowTypes.ts`
  - Add `stepExecution` to Bob adapter definition.
- Modify `extensions/workflow-register/src/workflowAdapter.ts`
  - Copy `core.stepExecution`.
- Modify `extensions/workflow-register/src/bobWorkflowFactory.ts`
  - Render `engineSteps` as visible Bob steps when configured.
- Modify `extensions/workflow-register/src/bobWorkflowRunner.ts`
  - Add `runEngineStep`.
  - Pass `allowOutOfOrder`.
  - Treat `reviewing` as successful execution handoff to the review gate.
- Modify `extensions/workflow-register/src/extension.ts`
  - Register `workflowRegister.runWorkflowStep` and core `workflowRegister.runNextStep`.
  - Add service methods for step pick and next-step execution.
- Modify `extensions/workflow-register/src/extensionWithAuthoring.ts`
  - Remove duplicate wrapper registration for `workflowRegister.runNextStep`.
- Modify `extensions/workflow-register/src/commands/stepReview.ts`
  - Keep accept/inspect/open commands.
  - Make `acceptAndRunNextStep` call the core `workflowRegister.runNextStep`.
  - Record rejected attempt metadata when retrying through existing retry command if command options are added.
- Modify `.bob/workflows/code-consistency-review/WORKFLOW.md`
  - Add `stepExecution.mode: engineSteps`.
  - Keep `stepReview` explicitly review-gated.
- Create `extensions/workflow-register/samples/review-gated-step-execution/README.md`
  - Manual Bob smoke instructions.
- Create `extensions/workflow-register/samples/review-gated-step-execution/.bob/workflows/review-gated-step-execution/WORKFLOW.md`
  - Deterministic sample workflow for real-machine testing.

---

### Task 1: Add `stepExecution` to the Core Schema and Parser

**Files:**
- Modify: `extensions/workflow-register/test/workflowEngineCore.test.js`
- Modify: `extensions/workflow-register/test/workflowAuthoring.test.js`
- Modify: `extensions/workflow-register/src/core/model.ts`
- Modify: `extensions/workflow-register/src/core/workflowSchema.ts`
- Modify: `extensions/workflow-register/schema/workflow-register.v1.schema.json`
- Modify: `extensions/workflow-register/src/core/parser/normalizers.ts`
- Modify: `extensions/workflow-register/src/core/parser/parseV1Workflow.ts`
- Modify: `extensions/workflow-register/src/bobWorkflowTypes.ts`
- Modify: `extensions/workflow-register/src/workflowAdapter.ts`

- [ ] **Step 1: Write the failing parser test**

In `extensions/workflow-register/test/workflowEngineCore.test.js`, extend the existing test named `v1 workflow parser preserves Bob adapter metadata from typed steps`.

Add this YAML immediately after `stepMessage: step`:

```yaml
stepExecution:
  mode: engineSteps
  allowOutOfOrder: false
  showInBob: true
```

Add these assertions after the existing `stepMessage` assertion:

```js
  assert.deepEqual(parsed.workflow.stepExecution, {
    mode: "engineSteps",
    allowOutOfOrder: false,
    showInBob: true
  })
```

- [ ] **Step 2: Write the failing public schema test**

In `extensions/workflow-register/test/workflowAuthoring.test.js`, extend `public JSON schema mirrors runtime schema shape` with:

```js
  assert.deepEqual(publicSchema.properties.stepExecution, workflowV1Schema.properties.stepExecution)
  assert.deepEqual(workflowV1Schema.properties.stepExecution.properties.mode.enum, ["full", "todo", "engineSteps"])
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```powershell
cd extensions\workflow-register
npm.cmd run compile
node --test test/workflowEngineCore.test.js test/workflowAuthoring.test.js
```

Expected: compile or tests fail because `stepExecution` is not defined on `CoreWorkflowDefinition` and is not in the schema.

- [ ] **Step 4: Add core model types**

In `extensions/workflow-register/src/core/model.ts`, add after `WorkflowStepMessageMode`:

```ts
export type WorkflowStepExecutionMode = "full" | "todo" | "engineSteps"

export interface WorkflowStepExecutionDefinition {
  mode: WorkflowStepExecutionMode
  allowOutOfOrder: boolean
  showInBob: boolean
}
```

Add to `CoreWorkflowDefinition` after `stepMessage`:

```ts
  stepExecution: WorkflowStepExecutionDefinition
```

In `extensions/workflow-register/src/bobWorkflowTypes.ts`, import `WorkflowStepExecutionDefinition` from `./core/model` and add to `WorkflowDefinition` after `stepMessage`:

```ts
  stepExecution: WorkflowStepExecutionDefinition
```

- [ ] **Step 5: Add runtime schema**

In `extensions/workflow-register/src/core/workflowSchema.ts`, add after `stepMessage`:

```ts
    stepExecution: {
      type: "object",
      properties: {
        mode: { enum: ["full", "todo", "engineSteps"] },
        allowOutOfOrder: { type: "boolean" },
        showInBob: { type: "boolean" }
      },
      additionalProperties: false
    },
```

Mirror the same JSON shape in `extensions/workflow-register/schema/workflow-register.v1.schema.json` after `"stepMessage"`.

- [ ] **Step 6: Add normalizer**

In `extensions/workflow-register/src/core/parser/normalizers.ts`, import `WorkflowStepExecutionDefinition` and `WorkflowStepExecutionMode`, then add:

```ts
export function normalizeStepExecution(
  value: unknown,
  fallbackMode: WorkflowStepExecutionMode
): WorkflowStepExecutionDefinition {
  const record = asRecord(value)
  const mode = optionalString(record, "mode")
  return {
    mode: mode === "full" || mode === "todo" || mode === "engineSteps" ? mode : fallbackMode,
    allowOutOfOrder: optionalBoolean(record, "allowOutOfOrder") ?? false,
    showInBob: optionalBoolean(record, "showInBob") ?? true
  }
}
```

- [ ] **Step 7: Normalize in parser**

In `extensions/workflow-register/src/core/parser/parseV1Workflow.ts`, import `normalizeStepExecution`.

Replace the inline `todoAsSteps` assignment with a local:

```ts
  const todoAsStepsValue = optionalBoolean(fields, "todoAsSteps") ?? (todoEnabled && todos.length > 0)
  const stepExecution = normalizeStepExecution(fields.stepExecution, todoAsStepsValue ? "todo" : "full")
```

Use these in the workflow object:

```ts
    todoAsSteps: todoAsStepsValue,
    stepExecution,
```

- [ ] **Step 8: Copy into Bob adapter**

In `extensions/workflow-register/src/workflowAdapter.ts`, add:

```ts
    stepExecution: core.stepExecution,
```

after `stepMessage: core.stepMessage`.

- [ ] **Step 9: Run focused tests and verify GREEN**

Run:

```powershell
cd extensions\workflow-register
npm.cmd run compile
node --test test/workflowEngineCore.test.js test/workflowAuthoring.test.js
```

Expected: both test files pass.

---

### Task 2: Enforce Ordered Single-Step Execution

**Files:**
- Modify: `extensions/workflow-register/test/workflowEngineCore.test.js`
- Modify: `extensions/workflow-register/test/workflowRunRecovery.test.js`
- Modify: `extensions/workflow-register/src/core/engine.ts`
- Modify: `extensions/workflow-register/src/core/engine/runState.ts`
- Modify: `extensions/workflow-register/src/core/runStateStore.ts`

- [ ] **Step 1: Write the failing out-of-order test**

In `extensions/workflow-register/test/workflowEngineCore.test.js`, add:

```js
test("workflow engine rejects out-of-order single-step execution by default", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  let analyzeCalls = 0
  const actions = new ActionRegistry()
  actions.register({ id: "sample.collect", execute: async () => "context" })
  actions.register({ id: "sample.analyze", execute: async () => { analyzeCalls += 1; return "analysis" } })
  const engine = new WorkflowEngine({
    actions,
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore: new FileRunStateStore({ workspaceRoot, now: () => "2026-07-03T00:00:00.000Z" })
  })
  const workflow = {
    id: "workflow-register.ordered-single",
    name: "ordered-single",
    label: "Ordered Single",
    description: "Ordered single-step workflow.",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    engineSteps: [
      { id: "collect", title: "Collect", type: "command", action: { provider: "sample.collect" }, resultKey: "context" },
      { id: "analyze", title: "Analyze", type: "command", action: { provider: "sample.analyze" }, resultKey: "analysis" }
    ]
  }

  const run = await engine.runWorkflow(workflow, {}, { executionMode: "singleStep", stepId: "analyze" })

  assert.equal(run.status, "failed")
  assert.equal(run.currentStep, "analyze")
  assert.equal(run.steps[0].status, "pending")
  assert.equal(run.steps[1].status, "failed")
  assert.match(run.error, /cannot run before previous step 'collect' is completed/)
  assert.equal(analyzeCalls, 0)
})
```

- [ ] **Step 2: Write the allow-out-of-order test**

Add:

```js
test("workflow engine can explicitly allow out-of-order single-step execution", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const actions = new ActionRegistry()
  actions.register({ id: "sample.analyze", execute: async () => "analysis" })
  const engine = new WorkflowEngine({
    actions,
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore: new FileRunStateStore({ workspaceRoot, now: () => "2026-07-03T00:00:00.000Z" })
  })
  const workflow = {
    id: "workflow-register.out-of-order",
    name: "out-of-order",
    label: "Out of Order",
    description: "Out-of-order workflow.",
    schemaVersion: "workflow-register/v1",
    inputs: {},
    engineSteps: [
      { id: "collect", title: "Collect", type: "command", action: { provider: "sample.collect" }, resultKey: "context" },
      { id: "analyze", title: "Analyze", type: "command", action: { provider: "sample.analyze" }, resultKey: "analysis" }
    ]
  }

  const run = await engine.runWorkflow(workflow, {}, { executionMode: "singleStep", stepId: "analyze", allowOutOfOrder: true })

  assert.equal(run.status, "completed")
  assert.equal(run.steps[0].status, "pending")
  assert.equal(run.steps[1].status, "completed")
  assert.equal(run.state.analysis, "analysis")
})
```

- [ ] **Step 3: Update the old missing-state recovery expectation**

In `extensions/workflow-register/test/workflowRunRecovery.test.js`, update `single-step later step without recoverable state fails before running the agent` to expect the order error instead of missing state:

```js
  assert.match(run.error, /cannot run before previous step 'collect-context' is completed/)
```

Keep `agentCalls === 0`.

- [ ] **Step 4: Run focused tests and verify RED**

Run:

```powershell
cd extensions\workflow-register
npm.cmd run compile
node --test test/workflowEngineCore.test.js test/workflowRunRecovery.test.js
```

Expected: out-of-order test fails because the engine currently jumps directly to the requested step.

- [ ] **Step 5: Add option type**

In `extensions/workflow-register/src/core/engine.ts`, update:

```ts
export interface RunWorkflowOptions {
  executionMode?: WorkflowExecutionMode
  stepId?: string
  allowOutOfOrder?: boolean
}
```

In `extensions/workflow-register/src/core/runStateStore.ts`, add the same field to `RecoverableRunLookupOptions`.

In `extensions/workflow-register/src/core/engine/runState.ts`, add it to `RunWorkflowOptionsLike`.

- [ ] **Step 6: Add order validation helper**

In `extensions/workflow-register/src/core/engine/runState.ts`, add:

```ts
export function blockedPreviousStep(
  workflow: CoreWorkflowDefinition,
  run: WorkflowRunState,
  targetIndex: number,
  options: RunWorkflowOptionsLike
): string | undefined {
  if (options.executionMode !== "singleStep") return undefined
  if (options.allowOutOfOrder === true) return undefined
  for (let index = 0; index < targetIndex; index += 1) {
    if (run.steps[index]?.status !== "completed") {
      return `Step '${workflow.engineSteps[targetIndex].id}' cannot run before previous step '${workflow.engineSteps[index].id}' is completed.`
    }
  }
  return undefined
}
```

- [ ] **Step 7: Persist order rejection in the engine**

In `extensions/workflow-register/src/core/engine.ts`, import `blockedPreviousStep`.

After `const startIndex = startIndexForRun(workflow, run, options)`, add:

```ts
    const blocked = blockedPreviousStep(workflow, run, startIndex, options)
    if (blocked) {
      const stepState = run.steps[startIndex]
      if (stepState) {
        stepState.status = "failed"
        stepState.error = blocked
      }
      run.status = "failed"
      run.currentStep = workflow.engineSteps[startIndex]?.id
      run.error = blocked
      await this.runStore.saveRun(run)
      await this.emit(this.hooks.onWorkflowFailed, { workflow, run, error: blocked })
      return run
    }
```

- [ ] **Step 8: Run focused tests and verify GREEN**

Run:

```powershell
cd extensions\workflow-register
npm.cmd run compile
node --test test/workflowEngineCore.test.js test/workflowRunRecovery.test.js
```

Expected: both test files pass.

---

### Task 3: Make `stepReview` Pause After Successful Single-Step Runs

**Files:**
- Modify: `extensions/workflow-register/test/workflowEngineCore.test.js`
- Modify: `extensions/workflow-register/src/core/engine/runState.ts`
- Modify: `extensions/workflow-register/src/core/engine.ts`
- Modify: `extensions/workflow-register/src/core/model.ts`

- [ ] **Step 1: Write the failing review-gate test**

In `extensions/workflow-register/test/workflowEngineCore.test.js`, add:

```js
test("workflow engine pauses successful single-step execution for step review", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  const actions = new ActionRegistry()
  actions.register({ id: "sample.collect", execute: async () => "context" })
  const engine = new WorkflowEngine({
    actions,
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore: new FileRunStateStore({ workspaceRoot, now: () => "2026-07-03T00:00:00.000Z" })
  })
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
      { id: "collect", title: "Collect", type: "command", action: { provider: "sample.collect" }, resultKey: "context" },
      { id: "next", title: "Next", type: "command", action: { provider: "sample.next" } }
    ]
  }

  const run = await engine.runWorkflow(workflow, {}, { executionMode: "singleStep", stepId: "collect" })

  assert.equal(run.status, "reviewing")
  assert.equal(run.currentStep, "collect")
  assert.equal(run.steps[0].status, "reviewing")
  assert.equal(run.steps[0].completedAt, undefined)
  assert.equal(run.state.context, "context")
})
```

- [ ] **Step 2: Run focused test and verify RED**

Run:

```powershell
cd extensions\workflow-register
npm.cmd run compile
node --test test/workflowEngineCore.test.js
```

Expected: the new test fails because `shouldPauseForStepReview` ignores `singleStep`.

- [ ] **Step 3: Let step review apply to single-step mode**

In `extensions/workflow-register/src/core/engine/runState.ts`, replace:

```ts
  if (mode !== "full") return false
```

with no mode-based early return. Keep the `mode` parameter for compatibility, but mark it intentionally unused:

```ts
export function shouldPauseForStepReview(workflow: CoreWorkflowDefinition, step: EngineStep, _mode: WorkflowExecutionMode): boolean {
```

- [ ] **Step 4: Ensure reviewing has no completed timestamp**

In `extensions/workflow-register/src/core/engine.ts`, the existing review pause block should remain before completed status assignment:

```ts
      if (shouldPauseForStepReview(workflow, step, mode)) {
        stepState.status = "reviewing"
        stepState.reviewStartedAt = new Date().toISOString()
        stepState.error = undefined
        run.status = "reviewing"
        run.currentStep = step.id
        run.error = undefined
        await this.runStore.saveRun(run)
        await this.emit(this.hooks.onStepReviewRequired, { workflow, run, step })
        return run
      }
```

- [ ] **Step 5: Run focused test and verify GREEN**

Run:

```powershell
cd extensions\workflow-register
npm.cmd run compile
node --test test/workflowEngineCore.test.js
```

Expected: the review-gate test passes.

---

### Task 4: Preserve Attempt History for Review Rejection and Retry

**Files:**
- Modify: `extensions/workflow-register/test/workflowEngineCore.test.js`
- Modify: `extensions/workflow-register/src/core/model.ts`
- Modify: `extensions/workflow-register/src/core/engine.ts`
- Modify: `extensions/workflow-register/src/core/engine/runState.ts`

- [ ] **Step 1: Write the failing retry-history test**

In `extensions/workflow-register/test/workflowEngineCore.test.js`, add:

```js
test("retrying a reviewing step archives the rejected attempt state", async () => {
  const { ActionRegistry } = require("../out/core/actionRegistry")
  const { WorkflowEngine } = require("../out/core/engine")
  const { createDefaultResultSinkRegistry } = require("../out/core/resultSinkRegistry")
  const { FileRunStateStore } = require("../out/core/runStateStore")

  const workspaceRoot = tempDir()
  let count = 0
  const actions = new ActionRegistry()
  actions.register({ id: "sample.collect", execute: async () => `context-${++count}` })
  const runStore = new FileRunStateStore({ workspaceRoot, now: () => "2026-07-03T00:00:00.000Z" })
  const engine = new WorkflowEngine({
    actions,
    resultSinks: createDefaultResultSinkRegistry({ workspaceRoot, executeCommand: async () => undefined }),
    runStore
  })
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
      { id: "collect", title: "Collect", type: "command", action: { provider: "sample.collect" }, resultKey: "context" }
    ]
  }

  const first = await engine.runWorkflow(workflow, {}, { executionMode: "singleStep", stepId: "collect" })
  const retried = await engine.retryCurrentStep(first.runId, workflow)

  assert.equal(retried.status, "reviewing")
  assert.equal(retried.state.context, "context-2")
  assert.equal(retried.steps[0].attempt, 2)
  assert.equal(retried.steps[0].attempts.length, 1)
  assert.equal(retried.steps[0].attempts[0].status, "reviewing")
  assert.equal(retried.steps[0].attempts[0].reviewDecision, "rejected")
  assert.equal(retried.steps[0].attempts[0].stateSnapshot.context, "context-1")
})
```

- [ ] **Step 2: Run focused test and verify RED**

Run:

```powershell
cd extensions\workflow-register
npm.cmd run compile
node --test test/workflowEngineCore.test.js
```

Expected: test fails because archived attempts do not record `reviewDecision`, or retry does not preserve the expected attempt metadata.

- [ ] **Step 3: Extend attempt model**

In `extensions/workflow-register/src/core/model.ts`, add fields to `RunStepAttempt`:

```ts
  reviewDecision?: "accepted" | "rejected"
  reviewComment?: string
```

- [ ] **Step 4: Add archive option**

In `extensions/workflow-register/src/core/engine/runState.ts`, change `archiveAttempt` to accept optional metadata:

```ts
export function archiveAttempt(
  stepState: RunStepState,
  state: Record<string, string>,
  review?: { decision?: "accepted" | "rejected"; comment?: string }
): void {
```

Add these properties to the archived attempt object:

```ts
      reviewDecision: review?.decision,
      reviewComment: review?.comment,
```

- [ ] **Step 5: Mark retry of reviewing as rejected**

In `extensions/workflow-register/src/core/engine.ts`, update:

```ts
    if (review.preserveAttempts) archiveAttempt(stepState, run.state)
```

to:

```ts
    if (review.preserveAttempts) {
      archiveAttempt(stepState, run.state, stepState.status === "reviewing" ? { decision: "rejected" } : undefined)
    }
```

Keep deleting the current step `resultKey` after archiving.

- [ ] **Step 6: Run focused test and verify GREEN**

Run:

```powershell
cd extensions\workflow-register
npm.cmd run compile
node --test test/workflowEngineCore.test.js
```

Expected: retry-history test passes.

---

### Task 5: Add Formal Standalone Step Commands

**Files:**
- Modify: `extensions/workflow-register/test/workflowRegister.test.js`
- Modify: `extensions/workflow-register/test/runtimeWiring.test.js`
- Modify: `extensions/workflow-register/package.json`
- Modify: `extensions/workflow-register/src/extension.ts`
- Modify: `extensions/workflow-register/src/extensionWithAuthoring.ts`
- Modify: `extensions/workflow-register/src/commands/stepReview.ts`

- [ ] **Step 1: Write failing command contribution test**

In `extensions/workflow-register/test/workflowRegister.test.js`, extend `package contributes standalone workflow launcher commands without a hard Bob dependency` command list:

```js
    "workflowRegister.runWorkflowStep",
    "workflowRegister.runNextStep",
```

Add:

```js
  assert.match(source, /registerCommand\("workflowRegister\.runWorkflowStep", \(workflowId\?: string, stepId\?: string, inputs\?: Record<string, unknown>\) => service\.runWorkflowStep\(workflowId, stepId, inputs\)\)/)
  assert.match(source, /registerCommand\("workflowRegister\.runNextStep", \(runId\?: string\) => service\.runNextStep\(runId\)\)/)
```

- [ ] **Step 2: Write failing wrapper de-duplication test**

In `extensions/workflow-register/test/workflowRegister.test.js`, add:

```js
test("authoring wrapper delegates accept-and-run-next to the core next-step command without duplicate registration", () => {
  const wrapper = readSrc("extensionWithAuthoring.ts")
  const stepReview = readSrc("commands", "stepReview.ts")

  assert.doesNotMatch(wrapper, /registerCommand\("workflowRegister\.runNextStep"/)
  assert.match(stepReview, /vscode\.commands\.executeCommand\("workflowRegister\.runNextStep", accepted\.runId\)/)
  assert.doesNotMatch(stepReview, /vscode\.commands\.executeCommand\("workflowRegister\.resumeRun", accepted\.runId\)/)
})
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```powershell
cd extensions\workflow-register
npm.cmd run compile
node --test test/workflowRegister.test.js test/runtimeWiring.test.js
```

Expected: tests fail because core does not register `runWorkflowStep`, wrapper still registers `runNextStep`, and `acceptAndRunNextStep` delegates to `resumeRun`.

- [ ] **Step 4: Add package contribution**

In `extensions/workflow-register/package.json`:

Add activation event:

```json
"onCommand:workflowRegister.runWorkflowStep",
```

Add command contribution near `runWorkflow`:

```json
{ "command": "workflowRegister.runWorkflowStep", "title": "Bob ワークフロー: 指定ステップを実行", "category": "Bob ワークフロー" },
```

Add command palette entry:

```json
{ "command": "workflowRegister.runWorkflowStep" },
```

`workflowRegister.runNextStep` already exists in `package.json`; keep it there.

- [ ] **Step 5: Register commands in core activation**

In `extensions/workflow-register/src/extension.ts`, add to `context.subscriptions.push` after `workflowRegister.runWorkflow`:

```ts
    vscode.commands.registerCommand(
      "workflowRegister.runWorkflowStep",
      (workflowId?: string, stepId?: string, inputs?: Record<string, unknown>) => service.runWorkflowStep(workflowId, stepId, inputs)
    ),
    vscode.commands.registerCommand("workflowRegister.runNextStep", (runId?: string) => service.runNextStep(runId)),
```

Add to `WorkflowRegisterApi`:

```ts
  runWorkflowStep: (workflowId?: string, stepId?: string, inputs?: Record<string, unknown>) => Promise<unknown>
  runNextStep: (runId?: string) => Promise<unknown>
```

Add to returned API:

```ts
    runWorkflowStep: (workflowId, stepId, inputs) => service.runWorkflowStep(workflowId, stepId, inputs),
    runNextStep: (runId) => service.runNextStep(runId)
```

- [ ] **Step 6: Implement `runWorkflowStep` service method**

In `WorkflowRegisterService`, add:

```ts
  async runWorkflowStep(workflowId?: string, stepId?: string, inputs: Record<string, unknown> = {}): Promise<unknown> {
    if (this.coreWorkflows.size === 0) await this.reload({ showReport: false })
    const workflow = workflowId
      ? this.coreWorkflows.get(workflowId)
      : await this.pickCoreWorkflow()
    if (!workflow) return "No workflow selected."
    const step = stepId
      ? workflow.engineSteps.find((candidate) => candidate.id === stepId)
      : await this.pickWorkflowStep(workflow)
    if (!step) return stepId ? `Workflow step not found: ${stepId}` : "No workflow step selected."
    const root = workflow.workflowRoot ?? await this.pickWorkflowRoot("Select workflow workspace")
    if (!root) {
      const message = "No workspace folder is open."
      await vscode.window.showErrorMessage(message)
      return message
    }
    const resolvedInputs = await this.collectWorkflowInputs(workflow, inputs)
    if (!resolvedInputs) return "Workflow input was cancelled."
    const engine = this.runtimeFactory.createEngine(root)
    const run = await engine.runWorkflow(workflow, resolvedInputs, {
      executionMode: "singleStep",
      stepId: step.id,
      allowOutOfOrder: workflow.stepExecution.allowOutOfOrder
    })
    await vscode.window.showInformationMessage(`Workflow step ${step.id} run ${run.status}: ${run.runId}`)
    return run
  }
```

Add helper:

```ts
  private async pickWorkflowStep(workflow: CoreWorkflowDefinition) {
    if (workflow.engineSteps.length === 0) return undefined
    if (workflow.engineSteps.length === 1) return workflow.engineSteps[0]
    const picked = await vscode.window.showQuickPick(workflow.engineSteps.map((step) => ({
      label: step.title,
      description: step.id,
      detail: step.type,
      step
    })), { title: "Run Workflow Step" })
    return picked?.step
  }
```

- [ ] **Step 7: Implement `runNextStep` service method**

In `WorkflowRegisterService`, add:

```ts
  async runNextStep(runId?: string): Promise<unknown> {
    if (this.coreWorkflows.size === 0) await this.reload({ showReport: false })
    const roots = await this.workflowRootCandidates()
    const selection = runId
      ? await findRunSelection(runId, roots, (root) => this.runtimeFactory.createRunStore(root))
      : await pickRunSelection(roots, (root) => this.runtimeFactory.createRunStore(root))
    if (!selection) {
      if (!runId) return "No workflow run selected."
      await vscode.window.showErrorMessage(`Workflow run not found: ${runId}`)
      return `Workflow run not found: ${runId}`
    }
    const runStore = this.runtimeFactory.createRunStore(selection.root)
    const run = selection.run ?? await runStore.loadRun(selection.runId)
    if (!run) throw new Error(`Workflow run not found: ${selection.runId}`)
    if (run.status === "reviewing") {
      const message = "Current step is waiting for review. Accept or retry it before running the next step."
      await vscode.window.showWarningMessage(message)
      return message
    }
    if (run.status === "held") {
      const message = "Current step is held. Complete the held step before running the next step."
      await vscode.window.showWarningMessage(message)
      return message
    }
    if (run.status === "failed") {
      const message = "Current step failed. Retry the current step before running the next step."
      await vscode.window.showWarningMessage(message)
      return message
    }
    const workflow = this.coreWorkflows.get(run.workflowId)
    if (!workflow) throw new Error(`Workflow definition is not loaded: ${run.workflowId}`)
    const next = run.steps.find((step) => step.status === "pending")
    if (!next) {
      run.status = "completed"
      run.currentStep = undefined
      run.error = undefined
      await runStore.saveRun(run)
      await vscode.window.showInformationMessage(`Workflow run completed: ${run.runId}`)
      return run
    }
    const engine = this.runtimeFactory.createEngine(selection.root)
    const result = await engine.runWorkflow(workflow, run.inputs, {
      executionMode: "singleStep",
      stepId: next.id,
      allowOutOfOrder: workflow.stepExecution.allowOutOfOrder
    })
    await vscode.window.showInformationMessage(`Workflow step ${next.id} run ${result.status}: ${result.runId}`)
    return result
  }
```

- [ ] **Step 8: Remove duplicate wrapper next-step registration**

In `extensions/workflow-register/src/extensionWithAuthoring.ts`, remove `runNextStep` from the import list and remove:

```ts
    vscode.commands.registerCommand("workflowRegister.runNextStep", (runId?: string) => runNextStep(stepReviewOptions, runId)),
```

In `extensions/workflow-register/src/commands/stepReview.ts`, change `acceptAndRunNextStep` final line to:

```ts
  return vscode.commands.executeCommand("workflowRegister.runNextStep", accepted.runId)
```

Remove the exported `runNextStep` function from this file.

- [ ] **Step 9: Run focused tests and verify GREEN**

Run:

```powershell
cd extensions\workflow-register
npm.cmd run compile
node --test test/workflowRegister.test.js test/runtimeWiring.test.js
```

Expected: command contribution and wiring tests pass.

---

### Task 6: Render Engine Steps in Bob UI

**Files:**
- Create: `extensions/workflow-register/test/bobWorkflowFactory.test.js`
- Modify: `extensions/workflow-register/src/bobWorkflowFactory.ts`
- Modify: `extensions/workflow-register/src/bobWorkflowRunner.ts`

- [ ] **Step 1: Write the failing Bob factory test**

Create `extensions/workflow-register/test/bobWorkflowFactory.test.js`:

```js
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
```

- [ ] **Step 2: Run focused test and verify RED**

Run:

```powershell
cd extensions\workflow-register
npm.cmd run compile
node --test test/bobWorkflowFactory.test.js
```

Expected: compile fails because `runEngineStep` is not part of `BobWorkflowStepRunner`, or runtime fails because factory still uses Todo steps.

- [ ] **Step 3: Add runner interface method**

In `extensions/workflow-register/src/bobWorkflowFactory.ts`, update `BobWorkflowStepRunner`:

```ts
  runEngineStep: (stepId: string, task: BobWorkflowTask) => Promise<boolean>
```

- [ ] **Step 4: Render engine steps first**

In `buildWorkflowSteps`, add before the Todo block:

```ts
  if (definition.stepExecution.mode === "engineSteps" && definition.stepExecution.showInBob) {
    return definition.core.engineSteps.map((step) => ({
      id: step.id,
      title: step.title,
      execution: async (task) => runner.runEngineStep(step.id, task)
    }))
  }
```

Change the Todo condition to:

```ts
  if (definition.stepExecution.mode === "todo" && definition.todoEnabled && definition.todoAsSteps && definition.todos.length > 0) {
```

- [ ] **Step 5: Implement runner method**

In `extensions/workflow-register/src/bobWorkflowRunner.ts`, add:

```ts
  async runEngineStep(stepId: string, task: BobWorkflowTask): Promise<boolean> {
    return this.runEngine(task, {
      executionMode: "singleStep",
      stepId,
      allowOutOfOrder: this.options.definition.stepExecution.allowOutOfOrder
    })
  }
```

Update `runEngine` request type:

```ts
    request: { executionMode: "full" | "singleStep"; stepId?: string; allowOutOfOrder?: boolean }
```

Pass the option:

```ts
        allowOutOfOrder: request.allowOutOfOrder
```

Update return success:

```ts
      return run.status === "completed" || run.status === "running" || run.status === "reviewing"
```

- [ ] **Step 6: Run focused test and verify GREEN**

Run:

```powershell
cd extensions\workflow-register
npm.cmd run compile
node --test test/bobWorkflowFactory.test.js
```

Expected: Bob factory tests pass.

---

### Task 7: Apply Review-Gated Execution to Code Consistency Workflow

**Files:**
- Modify: `.bob/workflows/code-consistency-review/WORKFLOW.md`
- Modify: `extensions/workflow-register/test/workflowEngineCore.test.js`

- [ ] **Step 1: Write the failing fixture parse test**

In `extensions/workflow-register/test/workflowEngineCore.test.js`, add:

```js
test("repository code-consistency workflow opts into review-gated engine step execution", () => {
  const fs = require("node:fs")
  const path = require("node:path")
  const { parseWorkflowMarkdown } = require("../out/core/parser")
  const workflowFile = path.resolve(__dirname, "..", "..", "..", ".bob", "workflows", "code-consistency-review", "WORKFLOW.md")
  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: ".bob/workflows/code-consistency-review/WORKFLOW.md",
    text: fs.readFileSync(workflowFile, "utf8")
  })

  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  assert.equal(parsed.workflow.stepExecution.mode, "engineSteps")
  assert.equal(parsed.workflow.stepExecution.allowOutOfOrder, false)
  assert.equal(parsed.workflow.stepExecution.showInBob, true)
  assert.equal(parsed.workflow.stepReview.enabled, true)
  assert.equal(parsed.workflow.stepReview.pauseAfter, "everyStep")
  assert.equal(parsed.workflow.stepReview.requireAcceptBeforeNext, true)
})
```

- [ ] **Step 2: Run focused test and verify RED**

Run:

```powershell
cd extensions\workflow-register
npm.cmd run compile
node --test test/workflowEngineCore.test.js
```

Expected: test fails because the workflow has no explicit `stepExecution`.

- [ ] **Step 3: Add explicit workflow settings**

In `.bob/workflows/code-consistency-review/WORKFLOW.md`, after `stepMessage: step`, add:

```yaml
stepExecution:
  mode: engineSteps
  allowOutOfOrder: false
  showInBob: true
stepReview:
  enabled: true
  pauseAfter: everyStep
  requireAcceptBeforeNext: true
  allowRetry: true
  allowEditBeforeRetry: true
  preserveAttempts: true
```

If a `stepReview` block already exists later, remove the duplicate and keep this block near the step execution settings.

- [ ] **Step 4: Run focused test and verify GREEN**

Run:

```powershell
cd extensions\workflow-register
npm.cmd run compile
node --test test/workflowEngineCore.test.js
```

Expected: fixture parse test passes.

---

### Task 8: Add a Real-Machine Review-Gated Sample

**Files:**
- Create: `extensions/workflow-register/samples/review-gated-step-execution/README.md`
- Create: `extensions/workflow-register/samples/review-gated-step-execution/.bob/workflows/review-gated-step-execution/WORKFLOW.md`
- Create or modify: `extensions/workflow-register/test/workflowSamples.test.js`

- [ ] **Step 1: Write the failing sample validation test**

Create `extensions/workflow-register/test/workflowSamples.test.js`:

```js
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const outRoot = path.resolve(__dirname, "..", "out")
const { parseWorkflowMarkdown } = require(path.join(outRoot, "core", "parser.js"))

test("review-gated step execution sample workflow validates", () => {
  const workflowFile = path.resolve(__dirname, "..", "samples", "review-gated-step-execution", ".bob", "workflows", "review-gated-step-execution", "WORKFLOW.md")
  const parsed = parseWorkflowMarkdown({
    sourceId: "workflow-register",
    filePath: ".bob/workflows/review-gated-step-execution/WORKFLOW.md",
    text: fs.readFileSync(workflowFile, "utf8")
  })

  assert.equal(parsed.ok, true, parsed.diagnostics.join("\n"))
  assert.equal(parsed.workflow.stepExecution.mode, "engineSteps")
  assert.equal(parsed.workflow.stepReview.enabled, true)
  assert.deepEqual(parsed.workflow.engineSteps.map((step) => step.id), ["collect-input", "draft-output", "save-output"])
})
```

- [ ] **Step 2: Run focused test and verify RED**

Run:

```powershell
cd extensions\workflow-register
npm.cmd run compile
node --test test/workflowSamples.test.js
```

Expected: test fails because the sample file does not exist.

- [ ] **Step 3: Add sample workflow**

Create `extensions/workflow-register/samples/review-gated-step-execution/.bob/workflows/review-gated-step-execution/WORKFLOW.md`:

```markdown
---
schemaVersion: workflow-register/v1
name: review-gated-step-execution
description: Review-gated engine step execution smoke sample.
title: Review-gated Step Execution
mode: agent
todo: true
todoAsSteps: false
stepCompletion: auto
stepMessage: step
stepExecution:
  mode: engineSteps
  allowOutOfOrder: false
  showInBob: true
stepReview:
  enabled: true
  pauseAfter: everyStep
  requireAcceptBeforeNext: true
  allowRetry: true
  allowEditBeforeRetry: true
  preserveAttempts: true
permissions:
  - read
  - mcp
  - skill
autoApproval: true
workspaceRequired: false
inputs:
  topic:
    type: string
    title: Topic
    default: review gate smoke
guardrails:
  allowedCommands:
    - vscode.open
  deniedCommands:
    - shell
artifacts:
  - id: draftText
    producedBy: draft-output
    path: .bob/workflows/runs/{{run.id}}/draft-output.txt
completion:
  summary: markdown
  includeArtifacts: true
  validateResult: false
steps:
  - id: collect-input
    title: Collect input
    type: result
    result:
      source: literal
      text: "Collected topic: {{inputs.topic}}"
      sinks:
        - type: file
          path: .bob/workflows/runs/{{run.id}}/collect-input.txt
  - id: draft-output
    title: Draft output
    type: agent
    prompt: |
      Produce a three-line smoke-test note for topic: {{inputs.topic}}
    resultKey: draftText
    result:
      source: agent
      sinks:
        - type: file
          path: .bob/workflows/runs/{{run.id}}/draft-output.txt
  - id: save-output
    title: Save final output
    type: result
    includeState:
      - draftText
    stateRequired: true
    result:
      source: state
      stateKey: draftText
      sinks:
        - type: file
          path: .bob/workflows/runs/{{run.id}}/final-output.txt
---
# Review-gated Step Execution

Use this sample to verify that each `steps[]` item appears as a Bob-visible step and that successful execution stops in `reviewing` until accepted.
```

- [ ] **Step 4: Add sample README**

Create `extensions/workflow-register/samples/review-gated-step-execution/README.md`:

```markdown
# Review-gated Step Execution Sample

This sample verifies `stepExecution.mode: engineSteps` plus `stepReview.enabled: true`.

## Manual smoke

1. Package the extension.

```powershell
cd extensions\workflow-register
npm.cmd run package
```

2. Copy this sample folder content into a temporary workspace root, preserving `.bob/workflows/review-gated-step-execution/WORKFLOW.md`.

3. Install the VSIX into an isolated Bob/VS Code extension directory.

4. Open the temporary workspace in Bob.

5. Run `Review-gated Step Execution`.

Expected:

- Bob shows `Collect input`, `Draft output`, and `Save final output` as separate visible steps.
- After `Collect input`, the run state in `.bob/workflows/runs/<runId>/run.json` is `reviewing`.
- `workflowRegister.runNextStep` refuses to advance while the current step is `reviewing`.
- `workflowRegister.acceptCurrentStep` marks the current step completed.
- `workflowRegister.runNextStep` then runs exactly the next pending step.
- `workflowRegister.retryCurrentStep` archives the rejected attempt in `steps[].attempts`.
```

- [ ] **Step 5: Run focused test and verify GREEN**

Run:

```powershell
cd extensions\workflow-register
npm.cmd run compile
node --test test/workflowSamples.test.js
```

Expected: sample validation test passes.

---

### Task 9: Documentation Updates

**Files:**
- Modify: `extensions/workflow-register/README.md`
- Modify: `extensions/workflow-register/docs/workflow-authoring-guide.md`
- Modify: `extensions/workflow-register/docs/workflow-runtime-debugging.md`
- Modify: `extensions/workflow-register/docs/basic-design-ja.md`
- Modify: `extensions/workflow-register/docs/detailed-design-ja.md`

- [ ] **Step 1: Add README section**

In `extensions/workflow-register/README.md`, add a section near runtime commands:

```markdown
## レビューゲート付きステップ実行

`stepExecution.mode: engineSteps` を指定すると、`steps[]` が Bob 上の表示ステップになります。
`stepReview.enabled: true` と組み合わせると、各 step は実行成功後に `reviewing` で停止し、人間が承認またはリトライを選ぶまで次 step へ進みません。

```yaml
stepExecution:
  mode: engineSteps
  allowOutOfOrder: false
  showInBob: true

stepReview:
  enabled: true
  pauseAfter: everyStep
  requireAcceptBeforeNext: true
  allowRetry: true
  allowEditBeforeRetry: true
  preserveAttempts: true
```

主なコマンド:

| Command | Purpose |
| --- | --- |
| `workflowRegister.runWorkflowStep` | 新規 run または復旧可能 run で指定 step を1つ実行する。 |
| `workflowRegister.runNextStep` | 既存 run の次の pending step を1つ実行する。 |
| `workflowRegister.acceptCurrentStep` | `reviewing` の current step を completed にする。 |
| `workflowRegister.retryCurrentStep` | current step をリトライし、前回 attempt を保存する。 |
| `workflowRegister.acceptAndRunNextStep` | 承認して次の pending step を1つ実行する。 |
```

- [ ] **Step 2: Update authoring guide**

In `extensions/workflow-register/docs/workflow-authoring-guide.md`, add a concise example with the same YAML and explain:

```markdown
Use `stepExecution.mode: engineSteps` when the authoring intent is to tune `steps[]` prompts, `includeState`, command args, and result handoff one step at a time. Keep `allowOutOfOrder: false` unless the workflow is explicitly designed for independent steps.
```

- [ ] **Step 3: Update runtime debugging guide**

In `extensions/workflow-register/docs/workflow-runtime-debugging.md`, add:

```markdown
When a run is `reviewing`, the step executed successfully. Inspect `steps[].attempts`, task snapshots, and state keys before deciding whether to accept or retry. Use `retryCurrentStep` for NG and `acceptCurrentStep` followed by `runNextStep` for OK.
```

- [ ] **Step 4: Update Japanese design docs**

In `extensions/workflow-register/docs/basic-design-ja.md` and `extensions/workflow-register/docs/detailed-design-ja.md`, update the command tables and execution-state sections to describe:

```text
stepExecution は Bob 上の表示・実行単位を決める。
stepReview は実行後レビューゲートを決める。
held は手動作業待ち、reviewing は実行結果の承認待ち。
```

- [ ] **Step 5: Run docs-related test gate**

Run:

```powershell
cd extensions\workflow-register
npm.cmd run test
```

Expected: full workflow-register tests pass.

---

### Task 10: Final Verification

**Files:**
- No new source files unless failures require fixes.

- [ ] **Step 1: Run workflow-register full gate**

Run:

```powershell
cd extensions\workflow-register
npm.cmd run test
```

Expected: all tests pass, including compile and Node tests.

- [ ] **Step 2: Run bob-code-consistency-review gate**

Run:

```powershell
cd extensions\bob-code-consistency-review
npm.cmd run test
```

Expected: all tests pass. This protects the `.bob/workflows/code-consistency-review/WORKFLOW.md` integration assumptions and companion action providers.

- [ ] **Step 3: Run whitespace gate**

Run:

```powershell
cd C:\Users\stell\source\repos\bob_builtin_analyze
git diff --check
```

Expected: exit code 0. CRLF warnings are acceptable only if they are existing platform warnings and no whitespace errors are reported.

- [ ] **Step 4: Inspect diff scope**

Run:

```powershell
git status --short
git diff --stat
```

Expected: changes are limited to workflow-register runtime/tests/docs, the code-consistency workflow config, and the review-gated sample.

---

## Self-Review

**Spec coverage:**
- Review-gated execution is covered by Tasks 2, 3, 4, and 5.
- `stepExecution` schema and Bob `engineSteps` display are covered by Tasks 1 and 6.
- accept/retry/next command UX is covered by Task 5.
- attempt preservation is covered by Task 4.
- code-consistency-review opt-in is covered by Task 7.
- real-machine sample is covered by Task 8.

**Intentional deferrals:**
- `skipped` status is deferred because no skip command or UX is requested.
- Fine-grained workflow-edit diff validation is deferred to the existing `stepReview.allowEditBeforeRetry` compatibility path. This first implementation still forbids unsafe step id/order mismatches through existing compatibility checks.
- GUI Builder step-jump already exists as `openCurrentStepInBuilder`; this plan updates command flow and docs but does not redesign the Builder UI.

**Verification commands:**
- Primary gate: `npm.cmd run test` in `extensions/workflow-register`.
- Companion gate: `npm.cmd run test` in `extensions/bob-code-consistency-review`.
- Repository whitespace gate: `git diff --check`.
