# Workflow Platform Remediation Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruct the lost post-`8626df1` correctness work from observable acceptance criteria, close the six open P0 workflow-platform defects, and leave durable tests and evidence for the Contract v2, reproducible-runtime, and operator-UX follow-on phases.

**Architecture:** Keep the standalone engine as the source of workflow truth. Bob is an adapter whose step Promise remains pending while a run is at a human gate; host commands resolve that Promise only after the corresponding durable run-state transition. Command providers own their canonical artifacts, prompt rendering and semantic compilation are shared across entry points, and process rejection is an explicit terminal transition.

**Tech Stack:** TypeScript, Node.js built-in test runner, VS Code Extension API, IBM Bob 2.0.1 workflow adapter, YAML/JSON workflow fixtures.

## Global Constraints

- Production code changes require a focused failing regression test first and recorded RED output.
- `.bob/workflows/runs/<runId>/run.json` and provider-owned canonical files are authoritative; Bob Todo state is a projection.
- A Bob step execution Promise must not resolve while the run status is `reviewing`, `held`, `checkpoint`, or `paused`.
- Returning `false` is not a human-gate implementation because Bob 2.0.1 finalization may mark remaining Todo items complete.
- Only explicit acceptance may resolve a review gate with `true`; retry keeps the same gate pending and terminal abort rejects it.
- Prompt text supplied to an agent must be the same rendered prompt for standalone, Bob, and Operation Hub paths.
- Workflow registration and explicit validation must consume the same semantic compiler result.
- Provider-owned canonical artifacts must never be overwritten with serialized command envelopes.
- Process rejection must not execute record or campaign-summary side effects.
- Existing provider IDs, command IDs, workflow IDs, and v1 workflow compatibility remain stable.
- Workspace trust and workspace containment checks remain host-owned.
- Each task ends with focused tests, `npm.cmd run compile`, `git diff --check`, a commit, and an independent task review.

---

### Task 1: Hold Bob Review Gates Until Explicit Acceptance

**Files:**
- Create: `extensions/workflow-register/src/bobWorkflowGateRegistry.ts`
- Create: `extensions/workflow-register/test/bobWorkflowGateRegistry.test.js`
- Modify: `extensions/workflow-register/src/bobWorkflowRunner.ts`
- Modify: `extensions/workflow-register/src/commands/stepReview.ts`
- Modify: `extensions/workflow-register/src/workflowRuntimeFactory.ts`
- Modify: `extensions/workflow-register/src/workflowRegisterService.ts`
- Test: `extensions/workflow-register/test/runtimeWiring.test.js`

**Interfaces:**
- Produces: `BobWorkflowGateRegistry.waitForDecision({ runId, stepId, status }): Promise<boolean>`.
- Produces: `BobWorkflowGateRegistry.accept(runId, stepId): boolean`.
- Produces: `BobWorkflowGateRegistry.abort(runId, stepId, reason): boolean`.
- Produces: `BobWorkflowGateRegistry.isPending(runId, stepId): boolean` and idempotent `dispose()`.
- Consumes: `WorkflowRunState.runId`, `WorkflowRunState.currentStep`, and the existing `acceptCurrentStep` durable state transition.

- [x] **Step 1: Add a failing registry unit test**

  Cover a pending Promise, deduplicated wait for the same key, explicit accept resolving `true`, terminal abort rejecting, stale decisions returning `false`, and dispose rejecting every pending gate.

- [x] **Step 2: Run the registry test and record RED**

  Run: `npm.cmd run compile && node --test test/bobWorkflowGateRegistry.test.js`

  Expected: FAIL because `out/bobWorkflowGateRegistry.js` or the required API does not exist.

- [x] **Step 3: Implement the minimal registry**

  Use one `Map<string, PendingGate>` keyed by `${runId}:${stepId}`. Remove entries before resolving or rejecting them, reuse the existing Promise for duplicate waits, and make `dispose()` idempotent.

- [x] **Step 4: Add a failing Bob-runner review-gate behavior test**

  Execute a real one-step `stepReview.enabled: true` workflow through `BobWorkflowEngineRunner`; assert that the returned Promise remains unsettled after the run reaches `reviewing`, then call the same registry used by the runner and assert it resolves `true`.

- [x] **Step 5: Wire review waits and acceptance**

  Inject one service-owned registry through `WorkflowRuntimeFactory` into every `BobWorkflowEngineRunner`. When `runEngine` receives `reviewing`, call `waitForDecision` instead of returning a boolean. After `acceptReviewedStep` durably saves the accepted run, resolve the matching gate. When a live gate was resolved, do not manually advance Bob through `setStepComplete`; the original Bob execution Promise owns that advancement.

- [x] **Step 6: Dispose pending gates with the service**

  `WorkflowRegisterService.dispose()` must abort all pending gate Promises after UI resources are disposed and before source deactivation finishes.

- [x] **Step 7: Verify and commit**

  Run: `npm.cmd run compile && node --test test/bobWorkflowGateRegistry.test.js test/runtimeWiring.test.js`

  Run: `git diff --check`

  Commit: `fix: hold Bob review gates until acceptance`

### Task 2: Cover Held, Checkpoint, Pause, Retry, and Abort Gate Decisions

**Files:**
- Modify: `extensions/workflow-register/src/bobWorkflowGateRegistry.ts`
- Modify: `extensions/workflow-register/src/bobWorkflowRunner.ts`
- Modify: `extensions/workflow-register/src/workflowRunCommands.ts`
- Modify: `extensions/workflow-register/src/commands/runControl.ts`
- Modify: `extensions/workflow-register/test/bobWorkflowGateRegistry.test.js`
- Create: `extensions/workflow-register/test/bobGateLifecycle.test.js`

**Interfaces:**
- Consumes: Task 1 registry.
- Produces: gate-decision wiring for `held`, `checkpoint`, and `paused` without resolving on retry.

- [x] Add failing lifecycle tests for all gate statuses, retry, checkpoint approval/abort, pause/resume, duplicate UI commands, and service disposal.
- [x] Verify RED with the focused test file.
- [x] Keep retry bound to the original pending Promise; resolve only when durable state says the Bob-visible step was accepted/completed.
- [x] Reject terminal aborts with a stable error and never use `false` as a gate decision.
- [x] Run focused tests, compile, `git diff --check`, and commit `fix: synchronize Bob gate lifecycle decisions`.

### Task 3: Preserve Provider-Owned Canonical Artifacts

**Files:**
- Modify: `extensions/workflow-register/src/core/engine/stepExecutor.ts`
- Modify: `extensions/workflow-register/src/core/engine/resultWriters.ts`
- Modify: `extensions/workflow-register/src/core/modelSchema.ts`
- Modify: `extensions/workflow-register/src/core/schema/workflowSchema.ts`
- Modify: `extensions/workflow-register/src/commands/processCommands.ts`
- Modify: `.bob/process/templates/process-common-review/WORKFLOW.md`
- Create: `extensions/workflow-register/test/processWorkflowEngineArtifacts.test.js`

**Interfaces:**
- Produces: an explicit command-result ownership contract distinguishing provider-owned canonical paths from engine-owned result sinks.
- Consumes: existing process command envelopes and artifact declarations.

- [x] Add an engine-level failing test proving `evidence-index.json`, `process-record.yaml`, and campaign summary contents are overwritten today.
- [x] Add the smallest schema/runtime ownership field or envelope convention that prevents a second engine write while retaining state metadata.
- [x] Validate missing, conflicting, and duplicate ownership declarations.
- [x] Run process command, workflow engine, schema, compile, and diff checks.
- [x] Commit `fix: preserve provider-owned workflow artifacts`.

### Task 4: Use One Rendered Prompt Across Every Agent Entry Point

**Files:**
- Modify: `extensions/workflow-register/src/bobWorkflowRunner.ts`
- Modify: `extensions/workflow-register/src/reviewTaskRegistry.ts`
- Modify: `extensions/workflow-register/src/agentStep.ts`
- Create: `extensions/workflow-register/test/agentPromptParity.test.js`

**Interfaces:**
- Produces: one prompt-context builder that receives the engine-rendered `AgentExecutionInput.prompt`.
- Consumes: standalone engine, live Bob task, and Operation Hub continuation agent providers.

- [x] Add a failing parity test with `{{inputs.*}}`, `{{state.*}}`, and escaped data-only content.
- [x] Remove raw `stepDefinition.prompt` / `step.prompt` precedence from Bob adapters.
- [x] Prove standalone, Bob, and Operation Hub providers receive identical rendered step text.
- [x] Run focused tests, compile, diff checks, and commit `fix: share rendered prompts across workflow entry points`.

### Task 5: Compile Once for Registration and Validation

**Files:**
- Create: `extensions/workflow-register/src/core/workflowCompiler.ts`
- Modify: `extensions/workflow-register/src/workflowLoader.ts`
- Modify: `extensions/workflow-register/src/workflowRegistrationService.ts`
- Modify: `extensions/workflow-register/src/core/workflowValidator.ts`
- Modify: `extensions/workflow-register/src/commands/validateWorkflow.ts`
- Create: `extensions/workflow-register/test/workflowCompilerParity.test.js`

**Interfaces:**
- Produces: `compileWorkflowDocument(...)` returning the normalized definition plus deterministic diagnostics.
- Consumes: workspace reload, registration, current-document validation, workspace validation, and tests.

- [x] Add failing tests where schema-valid but semantically invalid workflows are rejected identically by registration and commands.
- [x] Route every entry point through one compiler and deterministic diagnostic ordering.
- [x] Ensure invalid definitions are never passed to `source.registerWorkflow` and valid definitions retain stable hashes/IDs.
- [x] Run loader, validation, registration, strict contract, compile, and diff checks.
- [x] Commit `fix: unify workflow compilation and registration validation`.

### Task 6: Stop Process Workflows on Human Rejection

**Files:**
- Modify: `.bob/process/templates/*/WORKFLOW.md`
- Modify: `.bob/workflows/*/WORKFLOW.md` where process mirrors exist
- Modify: `extensions/workflow-register/src/commands/processCommands.ts`
- Modify: `extensions/workflow-register/test/processWorkflowContracts.test.js`
- Create: `extensions/workflow-register/test/processWorkflowDecisionE2e.test.js`

**Interfaces:**
- Produces: explicit approved/rejected transitions for every process review gate.
- Consumes: normalized `humanGate` decision and record/summary providers.

- [x] Add a contract test enumerating every process workflow and failing when reject has no terminal transition.
- [x] Add deterministic approve and reject E2E fixtures; reject must leave record/summary providers uncalled.
- [x] Update all templates and mirrors together, preserving their declared synchronization contract.
- [x] Cover missing review artifacts and stable rejected diagnostics.
- [x] Run process, workflow contract, compile, and diff checks.
- [x] Commit `fix: terminate process workflows on rejection`.

### Task 7: Make Operation Hub Mutations Transactional

**Files:**
- Modify: `extensions/workflow-register/src/gui/operationHubProvider.ts`
- Modify: `extensions/workflow-register/src/gui/operationHubModel.ts`
- Modify: `extensions/workflow-register/src/webview/workflowBuilderPanel.ts`
- Modify: `extensions/workflow-register/src/commands/editWorkflowInBuilder.ts`
- Modify: `extensions/workflow-register/src/workflowRunCommands.ts`
- Add focused Operation Hub and Builder tests.

**Interfaces:**
- Produces: single-flight action execution, preserved builder inputs, explicit overwrite confirmation, and compare-and-set traceability updates.

- [x] Add separate failing tests for duplicate action messages, input round-trip, existing-file save, and stale traceability writes.
- [x] Implement per-action/run single-flight keys and release them in `finally`.
- [x] Preserve unknown and inactive-tab builder fields through preview/save.
- [x] Require host confirmation before overwriting and reject stale state revisions with a refresh diagnostic.
- [x] Run focused UI-model tests, cumulative isolated/full-equivalent verification, compile, policy, and diff checks.
- [x] Commit `fix: make workflow operator mutations transactional` plus independent-review hardening follow-ups.

### Task 8: P0 End-to-End Closure and Follow-On Phase Rebaseline

**Files:**
- Create: `extensions/workflow-register/test/workflowPlatformP0E2e.test.js`
- Create: `docs/release-evidence/workflow-platform-remediation-2026-07-12.md`
- Modify: this plan's checkboxes and continuation notes.

**Interfaces:**
- Consumes: Tasks 1-7.
- Produces: deterministic approve, reject, missing-artifact, and invalid-definition parity evidence plus a current gap list for Contract v2, reproducible runtime, and operator UX.

- [x] Add deterministic fixtures that do not depend on wall-clock timing, random run IDs, network, or an installed IBM Bob instance.
- [x] Run approve E2E, reject/missing-artifact E2E, and invalid-definition parity independently.
- [x] Run `npm.cmd test`, architecture/source/schema/dependency policies, package, package policy, and `git diff --check`.
- [x] Perform a broad whole-branch review and fix every Critical/Important finding.
- [x] Re-audit the Contract v2, reproducible-runtime, and operator-UX plans against the new tree before continuing those phases.
- [x] Commit `test: close workflow platform P0 regressions`.

**Task 8 verification note:** This Windows host enters periodic high-load states that make fixed wall-clock tests non-deterministic. Per operator direction, a full-equivalent PASS may be assembled from a broad run plus isolated green reruns when every test has green evidence against unchanged relevant source. Preserve the raw broad-run failures and the cumulative mapping in release evidence rather than relabeling an individual failing command as green.

**Task 8 review debt:** Recheck Operation Hub artifact payload/open physical containment during the whole-branch review. The lexical-only open behavior predates Task 7, so it was excluded from Task 7's diff verdict but remains relevant to the Phase 0 workspace-boundary acceptance criteria.

**Task 8 completion note (2026-07-12):** Phase 0 code closure is recorded in `5c9744f8` and the final independent-review hardening commit `0105c92a`. Current `workflow-register` full suite is 654/654, package/policy gates pass, and the final whole-branch verdict is Critical 0 / Important 0. Detailed raw/cumulative evidence, VSIX hashes, remaining Phase 1 work, and external release blockers are in `docs/release-evidence/workflow-platform-remediation-2026-07-12.md`.
