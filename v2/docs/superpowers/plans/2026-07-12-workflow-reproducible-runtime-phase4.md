# Workflow Reproducible Runtime Through Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add immutable run events, crash-safe journal recovery, fsync durability, cross-process execution leases, and stale-write protection while preserving `run.json` compatibility.

**Architecture:** `run.json` remains the materialized current state. A full-snapshot hash-chained `events.ndjson` provides immutable evidence; `run-state.journal.json` makes the run/event commit recoverable; `run.lock.json` serializes cross-process writers and long-running execution. `FileRunStateStore` composes these contracts, while `coordinateWorkflowRunExecution()` owns the full-operation lease.

**Tech Stack:** TypeScript, Node.js `fs/promises`, `crypto`, `AsyncLocalStorage`, Node built-in test runner, child-process lock fixtures.

## Global Constraints

- Current run schema remains exactly `workflow-register/run-state/v1`.
- Current event schema is exactly `workflow-register/run-event/v1`.
- Current journal schema is exactly `workflow-register/run-journal/v1`.
- Current lock schema is exactly `workflow-register/run-lock/v1`.
- `run.json` remains the materialized source of current execution state through Phase 4.
- Existing v1 runs without event logs remain valid.
- Every new persisted path must reject symlinks, junctions, aliases, workspace escape, and unstable identity.
- File fsync is mandatory; unsupported directory fsync errors are recorded but do not corrupt the transaction.
- Future run-state versions remain inspectable and read-only.
- Production code requires a focused failing regression first.
- Draft/merge/release remains NO-GO without repository full-suite, policy, package, Ubuntu, Windows, and independent-review evidence.

---

### Task 1: Close Phase 1 Explicit-Target Semantics

**Files:**
- Modify: `extensions/workflow-register/src/core/runtime/runStateStore.ts`
- Modify: `extensions/workflow-register/test/workflowRunStateRecoveryPreference.test.js`

**Interfaces:**
- Produces: process-local association from a loaded `inputs` object to its exact `runId`.
- Preserves: ordinary inputs prefer a current recoverable run.

- [x] **Step 1: Add the failing explicit-target regression**

Load a matching future run, pass its exact `inputs` object to `findRecoverableRun()`, and require a read-only rejection even when a current run also matches.

- [x] **Step 2: Verify RED in the isolated runtime harness**

Expected: `Missing expected rejection`.

- [x] **Step 3: Add a `WeakMap<object, string>` target association**

Record loaded/created/saved run input objects and consult the explicit target before ordinary recoverable selection.

- [x] **Step 4: Verify GREEN**

Expected: ordinary current preference and explicit future rejection both pass.

### Task 2: Define Phase 2 Event-Log Contracts

**Files:**
- Create: `extensions/workflow-register/test/workflowRunEventLog.test.js`
- Create: `extensions/workflow-register/test/workflowRunDurabilityPath.test.js`

**Interfaces:**
- Consumes future APIs:
  - `buildWorkflowRunEvent(input): WorkflowRunEventV1`
  - `parseWorkflowRunEventLog(text, expectedRunId): WorkflowRunEventLogState`
  - `appendWorkflowRunEvent(root, runId, event): Promise<void>`
  - `readWorkflowRunEventLog(root, runId): Promise<WorkflowRunEventV1[]>`
- Produces RED contracts for hash chains and path safety.

- [ ] **Step 1: Add event construction tests**

Require sequence 1, full snapshot, exact `runHash`, deterministic event `hash`, and no mutation of the input run.

- [ ] **Step 2: Add chain validation tests**

Cover valid sequence increments, previous-event hash, duplicate event IDs, altered snapshots, altered hashes, run-ID mismatch, blank lines, truncated final JSON, and future event schema.

- [ ] **Step 3: Add append/path tests**

Cover direct-file creation, append-only growth, final newline, symlink target rejection, aliased run directory rejection, and workspace escape rejection.

- [ ] **Step 4: Verify RED**

Run:

```bash
npm.cmd run compile && node --test \
  test/workflowRunEventLog.test.js \
  test/workflowRunDurabilityPath.test.js
```

Expected: FAIL because the event and durability modules do not exist.

- [ ] **Step 5: Commit RED tests**

```bash
git add extensions/workflow-register/test/workflowRunEventLog.test.js \
  extensions/workflow-register/test/workflowRunDurabilityPath.test.js
git commit -m "test: define immutable workflow run events"
```

### Task 3: Implement the Durability Path Adapter and Event Log

**Files:**
- Create: `extensions/workflow-register/src/core/runtime/runDurabilityPath.ts`
- Create: `extensions/workflow-register/src/core/runtime/runEventLog.ts`
- Modify: `extensions/workflow-register/src/core/runStateStore.ts`

**Interfaces:**
- Produces:

```ts
export type RunDurabilityFileName =
  | "events.ndjson"
  | "run-state.journal.json"
  | "run.lock.json"

export async function readRunDurabilityFile(...): Promise<ContainedRunFileSnapshot | undefined>
export async function replaceRunDurabilityFile(...): Promise<void>
export async function appendRunDurabilityFile(...): Promise<void>
export async function createRunDurabilityFile(...): Promise<boolean>
export async function removeRunDurabilityFile(...): Promise<void>
export async function syncRunMaterializedFile(...): Promise<void>
```

- Produces `WorkflowRunEventV1`, `WorkflowRunEventLogState`, event build/parse/read/append APIs.

- [ ] **Step 1: Implement direct contained path resolution**

Reuse `assertSafeWorkflowRunId()`. Canonicalize the workspace root, walk `.bob/workflows/runs/<runId>` one direct directory at a time, reject symlinks/junctions, and revalidate directory identity before and after I/O.

- [ ] **Step 2: Implement replace/create/append/remove operations**

Use unique owned temp files for replacement, `wx` for create-only files, `O_APPEND | O_NOFOLLOW` for event append where supported, token/identity verification before remove, and cleanup owned temp files on every failure path.

- [ ] **Step 3: Implement durability barriers**

Call `FileHandle.sync()` after file writes and append. Attempt directory sync after create/rename/append/remove. Ignore only `EINVAL`, `EPERM`, `EISDIR`, and `ENOTSUP` for directory sync.

- [ ] **Step 4: Implement event hashing and parser**

Use stable recursive key ordering. Verify every sequence, event ID, previous hash, run ID, snapshot run ID, `runHash`, and event `hash`.

- [ ] **Step 5: Verify GREEN**

Run the two Task 2 files plus existing `runStateStorePathBoundary.test.js`.

- [ ] **Step 6: Commit Phase 2**

```bash
git add extensions/workflow-register/src/core/runtime/runDurabilityPath.ts \
  extensions/workflow-register/src/core/runtime/runEventLog.ts \
  extensions/workflow-register/src/core/runStateStore.ts \
  extensions/workflow-register/test/workflowRunEventLog.test.js \
  extensions/workflow-register/test/workflowRunDurabilityPath.test.js
git commit -m "feat: add immutable workflow run event log"
```

### Task 4: Define and Implement Phase 3 Journal Recovery

**Files:**
- Create: `extensions/workflow-register/test/workflowRunJournal.test.js`
- Create: `extensions/workflow-register/src/core/runtime/runStateJournal.ts`

**Interfaces:**
- Produces:

```ts
export interface WorkflowRunJournalV1 { ... }
export function buildWorkflowRunJournal(input): WorkflowRunJournalV1
export function parseWorkflowRunJournal(value, expectedRunId): WorkflowRunJournalV1
export async function readWorkflowRunJournal(root, runId): Promise<WorkflowRunJournalV1 | undefined>
export async function writeWorkflowRunJournal(root, runId, journal): Promise<void>
export async function removeWorkflowRunJournal(root, runId): Promise<void>
export async function recoverWorkflowRunJournal(input): Promise<JournalRecoveryResult>
```

- [ ] **Step 1: Add RED journal parser tests**

Reject malformed schema, mismatched run IDs, event/run hash disagreement, next-event sequence mismatch, and invalid previous hashes.

- [ ] **Step 2: Add RED recovery matrix tests**

Cover crashes after journal write, after `run.json` replacement, and after event append. Re-running recovery must not duplicate an event or advance timestamps.

- [ ] **Step 3: Add conflict tests**

Require hard failure when materialized run hash or event head matches neither the previous nor next journal value. Preserve journal, run, and event files unchanged.

- [ ] **Step 4: Verify RED**

Expected: journal module missing.

- [ ] **Step 5: Implement parser/build/read/write/remove**

Use the durability path adapter. Serialization is formatted JSON with a final newline.

- [ ] **Step 6: Implement idempotent recovery**

Apply the state machine from the design exactly: materialized run first, event second, journal removal last.

- [ ] **Step 7: Verify GREEN**

Run journal, event, and durability-path tests.

- [ ] **Step 8: Commit Phase 3 core**

```bash
git add extensions/workflow-register/src/core/runtime/runStateJournal.ts \
  extensions/workflow-register/test/workflowRunJournal.test.js
git commit -m "feat: recover interrupted workflow run commits"
```

### Task 5: Define and Implement Phase 4 Cross-Process Lease

**Files:**
- Create: `extensions/workflow-register/test/workflowRunLock.test.js`
- Create: `extensions/workflow-register/test/fixtures/run-lock-holder.js`
- Create: `extensions/workflow-register/src/core/runtime/runLock.ts`

**Interfaces:**
- Produces:

```ts
export interface WorkflowRunLockOptions {
  timeoutMs?: number
  staleMs?: number
  heartbeatMs?: number
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  processAlive?: (pid: number) => boolean
  hostname?: string
}

export async function withWorkflowRunLock<T>(
  workspaceRoot: string,
  runId: string,
  operation: () => Promise<T>,
  options?: WorkflowRunLockOptions
): Promise<T>
```

- [ ] **Step 1: Add RED exclusive-lock tests**

Two independent callers for the same physical root/run must serialize; different roots and run IDs proceed independently; workspace aliases share a key.

- [ ] **Step 2: Add RED child-process test**

A fixture process acquires the lock and reports readiness. A second process/caller must receive the stable busy error without entering its operation.

- [ ] **Step 3: Add stale/release tests**

Cover dead same-host PID reclamation, live PID non-reclamation, foreign-host stale heartbeat, malformed recent lock, malformed stale lock, and token mismatch during release.

- [ ] **Step 4: Verify RED**

Expected: lock module missing.

- [ ] **Step 5: Implement exclusive create and bounded wait**

Use `run.lock.json`, random ownership token, `AsyncLocalStorage` for same-chain reentrancy, and direct contained I/O.

- [ ] **Step 6: Implement heartbeat and stale recovery**

Refresh `heartbeatAt` while the operation runs. Revalidate bytes/identity before stale removal.

- [ ] **Step 7: Verify GREEN**

Run lock tests on the current OS. Child-process test must use deterministic handshakes, not fixed sleeps.

- [ ] **Step 8: Commit Phase 4 lease**

```bash
git add extensions/workflow-register/src/core/runtime/runLock.ts \
  extensions/workflow-register/test/workflowRunLock.test.js \
  extensions/workflow-register/test/fixtures/run-lock-holder.js
git commit -m "feat: serialize workflow runs across processes"
```

### Task 6: Integrate Transactional Save, CAS, and Full-Operation Lease

**Files:**
- Modify: `extensions/workflow-register/src/core/runtime/runStateStore.ts`
- Modify: `extensions/workflow-register/src/core/runtime/runControlStore.ts`
- Modify: `extensions/workflow-register/src/core/engine/runExecutionCoordinator.ts`
- Modify: `extensions/workflow-register/src/core/engine.ts`
- Create: `extensions/workflow-register/test/workflowRunDurableStore.test.js`
- Create: `extensions/workflow-register/test/workflowRunCrossProcessCas.test.js`

**Interfaces:**
- Extends `RunStateStore` with optional:

```ts
withRunLock?: <T>(runId: string, operation: () => Promise<T>) => Promise<T>
```

- `coordinateWorkflowRunExecution()` uses `withRunLock` around writable validation and the complete operation.

- [ ] **Step 1: Add RED store transaction tests**

Require save order journal → run → event → journal removal, event kinds, migration event, exact timestamps, and caller-object updates only after commit.

- [ ] **Step 2: Add RED stale-write tests**

Load the same run in two stores, save A, then save B. B must fail before journal creation and preserve A's bytes and event head.

- [ ] **Step 3: Add RED recovery-on-load tests**

Seed each crash point and require `loadRun()` to recover under the lease, report `journal-recovered`, and return the next snapshot.

- [ ] **Step 4: Implement revision tracking**

Use a module-level `WeakMap<object, "missing" | string>` keyed by run objects. Record exact `run.json` hashes on create/load/save/recovery.

- [ ] **Step 5: Implement `saveRun()` transaction**

Acquire/re-enter the lease, recover any journal, compare revision, build event/journal, commit with durability barriers, and update the caller object after cleanup.

- [ ] **Step 6: Route migration through the transaction**

Keep the exact-byte v0 backup. Preserve original `updatedAt`; emit `run.migrated`; do not expose a partially migrated run.

- [ ] **Step 7: Integrate coordinator and checkpoint operations**

`coordinateWorkflowRunExecution()` holds the cross-process lease. Wrap approve/abort checkpoint public methods in the coordinator so direct API use is also serialized.

- [ ] **Step 8: Integrate run-control writes**

`requestPause`, `clearPause`, and `recordResumeNote` acquire the same run lease before checking writable state and writing `control.json`.

- [ ] **Step 9: Verify GREEN**

Run focused store, migration, recovery, lock, coordinator, run-control, Bob gate, and Operation Hub mutation tests.

- [ ] **Step 10: Commit integration**

```bash
git add extensions/workflow-register/src/core/runtime/runStateStore.ts \
  extensions/workflow-register/src/core/runtime/runControlStore.ts \
  extensions/workflow-register/src/core/engine/runExecutionCoordinator.ts \
  extensions/workflow-register/src/core/engine.ts \
  extensions/workflow-register/test/workflowRunDurableStore.test.js \
  extensions/workflow-register/test/workflowRunCrossProcessCas.test.js
git commit -m "feat: commit workflow run state crash-safely"
```

### Task 7: Diagnostics, Documentation, and Evidence

**Files:**
- Modify: `extensions/workflow-register/src/core/runDiagnostics.ts`
- Modify: `extensions/workflow-register/src/commands/inspectRunDiagnostics.ts`
- Modify: `extensions/workflow-register/docs/README-ja.md`
- Modify: `extensions/workflow-register/docs/run-state-schema-v1-ja.md`
- Create: `extensions/workflow-register/docs/reproducible-runtime-phase4-ja.md`
- Create: `docs/release-evidence/workflow-reproducible-runtime-phase4-2026-07-12.md`
- Create: `extensions/workflow-register/test/workflowRunDurabilityDiagnostics.test.js`

**Interfaces:**
- Surfaces event head/count, recovered journal, lock reclamation, stale write, and invalid durability evidence.

- [ ] **Step 1: Add RED diagnostics test**

Require a dedicated durability section and no state/prompt/payload leakage.

- [ ] **Step 2: Extend diagnostic codes and report model**

Keep deterministic ordering and existing migrated/read-only/invalid output.

- [ ] **Step 3: Write operator documentation**

Document files, recovery rules, busy/stale errors, manual evidence collection, and explicit non-goals.

- [ ] **Step 4: Record TDD and CI evidence**

Include RED/GREEN commands, test counts, runner run/job IDs, and limitations of isolated verification.

- [ ] **Step 5: Commit docs/evidence**

```bash
git add extensions/workflow-register/src/core/runDiagnostics.ts \
  extensions/workflow-register/src/commands/inspectRunDiagnostics.ts \
  extensions/workflow-register/docs \
  extensions/workflow-register/test/workflowRunDurabilityDiagnostics.test.js \
  docs/release-evidence/workflow-reproducible-runtime-phase4-2026-07-12.md
git commit -m "docs: expose reproducible runtime evidence"
```

### Task 8: Full Verification and Independent Review

**Files:**
- Modify: `docs/release-evidence/workflow-reproducible-runtime-phase4-2026-07-12.md`
- Modify: this plan's checkboxes.

- [ ] **Step 1: Run focused tests**

```bash
npm.cmd run compile
node --test \
  test/workflowRunEventLog.test.js \
  test/workflowRunDurabilityPath.test.js \
  test/workflowRunJournal.test.js \
  test/workflowRunLock.test.js \
  test/workflowRunDurableStore.test.js \
  test/workflowRunCrossProcessCas.test.js \
  test/workflowRunDurabilityDiagnostics.test.js \
  test/workflowRunState*.test.js \
  test/workflowRunExecutionCoordinator.test.js \
  test/runControlStorePathBoundary.test.js
```

- [ ] **Step 2: Run full and policy gates**

```bash
npm.cmd test
npm.cmd run dependency:policy
npm.cmd run architecture:policy
npm.cmd run source:policy
npm.cmd run schema:policy
npm.cmd run unused:report
npm.cmd run audit:prod
npm.cmd run package
npm.cmd run package:policy
git diff --check
```

- [ ] **Step 3: Review the complete diff**

Review event integrity, journal state machine, fsync ordering, path containment, lease ownership, stale reclamation, CAS, reentrancy, cleanup, future-version boundaries, and test determinism. Fix every Critical and Important finding.

- [ ] **Step 4: Inspect GitHub Actions honestly**

If jobs have `steps: null` or no logs, record a runner-side blocker and keep the Draft/NO-GO status.

- [ ] **Step 5: Open the stacked Draft PR**

Base it on `agent/workflow-run-state-schema-v1-20260712` until Phase 1 merges. Include exact head, verification evidence, residual risks, and the unmerged dependency.

## Completion Rule

Phase 4 implementation is code-complete only after every focused requirement has executable evidence. The PR remains Draft and Merge/Release NO-GO until the repository full suite, policies, package, Ubuntu/Windows jobs, and independent review are green on the same head.
