# Workflow Run State Schema v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Version `run.json`, migrate historical unversioned runs with exact-byte backup, protect future versions from downgrade writes, and isolate malformed run documents from the rest of the run list.

**Architecture:** Add one runtime codec that classifies current, unversioned, future, and invalid documents. `FileRunStateStore` owns migration and write protection; `runStatePath` owns contained backup I/O; existing diagnostics surfaces store-level load evidence.

**Tech Stack:** TypeScript, Node.js built-in test runner, JSON fixtures, existing contained run-file I/O and atomic rename helpers.

## Global Constraints

- Current persisted version is exactly `workflow-register/run-state/v1`.
- Existing unversioned `run.json` files are historical v0 and must migrate losslessly.
- Migration must preserve original bytes before replacing `run.json`.
- Migration must preserve the original `updatedAt`.
- Existing migration backup content must never be silently overwritten.
- Future `workflow-register/run-state/vN` documents are inspectable but read-only.
- Non-current explicit versions must never be recovered or saved.
- Invalid run documents must not make `listRuns()` reject.
- Existing path containment, direct-file, and atomic replacement rules remain mandatory.
- Production changes require a focused failing regression first.
- Full test, policy, package, Ubuntu, and Windows gates remain required before merge.

---

### Task 1: Add Historical Fixtures and RED Codec Contracts

**Files:**
- Create: `extensions/workflow-register/test/fixtures/run-state/v0-basic.json`
- Create: `extensions/workflow-register/test/fixtures/run-state/v1-basic.json`
- Create: `extensions/workflow-register/test/workflowRunStateCodec.test.js`

**Interfaces:**
- Consumes: future `decodeWorkflowRunState(value, expectedRunId?)` and `prepareWorkflowRunStateForWrite(run)`.
- Produces: fixed compatibility fixtures and codec acceptance tests.

- [ ] **Step 1: Add the unversioned v0 fixture**

Create a fixed current-shape document without `schemaVersion`:

```json
{
  "runId": "20260712T000000Z-history-000000000001",
  "workflowId": "workflow-register.history",
  "workflowName": "history",
  "workflowSchemaVersion": "workflow-register/v1",
  "workflowDefinitionHash": "sha256:history",
  "workflowFile": ".bob/workflows/history/WORKFLOW.md",
  "engineVersion": "0.1.0",
  "status": "paused",
  "currentStep": "review",
  "inputs": { "revision": "abc123" },
  "state": { "context": "preserved" },
  "steps": [
    {
      "id": "review",
      "title": "Review",
      "type": "manual",
      "status": "held"
    }
  ],
  "createdAt": "2026-07-12T00:00:00.000Z",
  "updatedAt": "2026-07-12T00:01:00.000Z"
}
```

Keep the file's final newline; migration backup tests compare the exact bytes.

- [ ] **Step 2: Add the v1 fixture**

Use the same document with this first property:

```json
"schemaVersion": "workflow-register/run-state/v1"
```

- [ ] **Step 3: Add codec RED tests**

Cover:

```js
test("run-state codec migrates an unversioned historical document in memory", () => {
  const decoded = decodeWorkflowRunState(JSON.parse(readFixture("v0-basic.json")))
  assert.equal(decoded.migrated, true)
  assert.equal(decoded.readOnly, false)
  assert.equal(decoded.sourceVersion, "unversioned")
  assert.equal(decoded.run.schemaVersion, CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION)
  assert.equal(decoded.run.updatedAt, "2026-07-12T00:01:00.000Z")
})
```

```js
test("run-state codec accepts current v1 without migration", () => {
  const decoded = decodeWorkflowRunState(JSON.parse(readFixture("v1-basic.json")))
  assert.equal(decoded.migrated, false)
  assert.equal(decoded.readOnly, false)
  assert.equal(decoded.sourceVersion, CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION)
})
```

```js
test("future run-state versions are inspectable and read-only", () => {
  const future = { ...JSON.parse(readFixture("v1-basic.json")), schemaVersion: "workflow-register/run-state/v2" }
  const decoded = decodeWorkflowRunState(future)
  assert.equal(decoded.readOnly, true)
  assert.equal(decoded.run.schemaVersion, "workflow-register/run-state/v2")
  assert.throws(() => prepareWorkflowRunStateForWrite(decoded.run), /read-only/)
})
```

Add table tests for invalid JSON object shapes, foreign schema strings, non-string versions, run-id mismatch, invalid statuses, invalid steps, and non-string state values.

- [ ] **Step 4: Verify RED**

Run from `extensions/workflow-register`:

```bash
npm.cmd run compile && node --test test/workflowRunStateCodec.test.js
```

Expected: FAIL because `out/core/runtime/runStateCodec.js` does not exist.

- [ ] **Step 5: Commit RED fixtures and tests**

```bash
git add extensions/workflow-register/test/fixtures/run-state \
  extensions/workflow-register/test/workflowRunStateCodec.test.js
git commit -m "test: define workflow run state schema v1"
```

### Task 2: Implement the Run-State Codec

**Files:**
- Modify: `extensions/workflow-register/src/core/modelRuntime.ts`
- Create: `extensions/workflow-register/src/core/runtime/runStateCodec.ts`
- Modify: `extensions/workflow-register/src/core/runStateStore.ts`

**Interfaces:**
- Produces: `CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION`.
- Produces: `DecodedWorkflowRunState`, `RunStateLoadDiagnostic`.
- Produces: `decodeWorkflowRunState(value, expectedRunId?)`.
- Produces: `prepareWorkflowRunStateForWrite(run)`.

- [ ] **Step 1: Add the transition field to the runtime model**

Add to `WorkflowRunState`:

```ts
schemaVersion?: string
```

The field stays optional in the TypeScript transition model; persisted writes are normalized by the codec.

- [ ] **Step 2: Implement version classification**

Create constants and types:

```ts
export const CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION = "workflow-register/run-state/v1" as const
const VERSION_PATTERN = /^workflow-register\/run-state\/v([1-9]\d*)$/

export interface DecodedWorkflowRunState {
  run?: WorkflowRunState
  sourceVersion: "unversioned" | string
  migrated: boolean
  readOnly: boolean
  diagnostics: string[]
}

export interface RunStateLoadDiagnostic {
  runId: string
  severity: "info" | "warning" | "error"
  code: "migrated" | "read-only" | "invalid"
  message: string
}
```

- [ ] **Step 3: Implement stable-core validation**

Validate object shape with small helpers:

```ts
function requiredString(record: Record<string, unknown>, key: string): string
function requiredRecord(record: Record<string, unknown>, key: string): Record<string, unknown>
function validateRunSteps(value: unknown): RunStepState[]
```

Require current status and step enums. Preserve unknown optional fields through object spreading, but do not coerce field types.

- [ ] **Step 4: Implement decode and write preparation**

Rules:

```ts
if (schemaVersion === undefined) {
  return { run: { ...validated, schemaVersion: CURRENT }, sourceVersion: "unversioned", migrated: true, readOnly: false, diagnostics: [...] }
}
if (schemaVersion === CURRENT) return current writable result
if (typeof schemaVersion === "string" && VERSION_PATTERN.test(schemaVersion)) return future read-only result
throw invalid-schema error
```

`prepareWorkflowRunStateForWrite()` returns a shallow clone with current schema when omitted, accepts exact current, and throws for every other explicit value.

- [ ] **Step 5: Verify codec GREEN**

```bash
npm.cmd run compile && node --test test/workflowRunStateCodec.test.js
```

Expected: all codec tests pass.

- [ ] **Step 6: Commit codec implementation**

```bash
git add extensions/workflow-register/src/core/modelRuntime.ts \
  extensions/workflow-register/src/core/runtime/runStateCodec.ts \
  extensions/workflow-register/src/core/runStateStore.ts
git commit -m "feat: add workflow run state codec"
```

### Task 3: Add Contained Migration Backup I/O

**Files:**
- Modify: `extensions/workflow-register/src/core/runtime/runStatePath.ts`
- Create: `extensions/workflow-register/test/workflowRunStateMigrationPath.test.js`

**Interfaces:**
- Produces: `readContainedRunStateMigrationBackup(workspaceRoot, runId)`.
- Produces: `ensureContainedRunStateMigrationBackup(workspaceRoot, runId, content)`.
- Uses backup name `run-state-v0.backup.json`.

- [ ] **Step 1: Add RED backup tests**

Cover:

- creates the backup inside the selected run directory;
- exact bytes and final newline are preserved;
- identical existing content is idempotent;
- differing existing content throws a stable conflict;
- symlinked run directory/file and workspace escape remain rejected;
- a create race re-reads and compares the winning file.

- [ ] **Step 2: Verify RED**

```bash
npm.cmd run compile && node --test test/workflowRunStateMigrationPath.test.js
```

Expected: FAIL because backup APIs do not exist.

- [ ] **Step 3: Implement contained backup helpers**

Use the existing `readContainedRunPath()` and `writeContainedRunPath()` internals. Add a `createOnly` option to the write helper so backup writes never replace an existing target.

Algorithm:

```ts
export async function ensureContainedRunStateMigrationBackup(root, runId, content) {
  const existing = await optionalReadBackup(root, runId)
  if (existing) {
    if (existing.bytes.toString("utf8") !== content) throw new Error(`Workflow run '${runId}' migration backup conflicts with the current unversioned run.`)
    return
  }
  try {
    await writeContainedRunPath(root, runId, [], BACKUP_NAME, content, { createOnly: true })
  } catch (error) {
    const raced = await optionalReadBackup(root, runId)
    if (raced && raced.bytes.toString("utf8") === content) return
    throw error
  }
}
```

- [ ] **Step 4: Verify GREEN and existing boundaries**

```bash
npm.cmd run compile
node --test test/workflowRunStateMigrationPath.test.js test/runStateStorePathBoundary.test.js
```

Expected: zero failures.

- [ ] **Step 5: Commit backup I/O**

```bash
git add extensions/workflow-register/src/core/runtime/runStatePath.ts \
  extensions/workflow-register/test/workflowRunStateMigrationPath.test.js
git commit -m "feat: preserve run state migration backups"
```

### Task 4: Integrate Migration, Read-only Protection, and List Isolation

**Files:**
- Modify: `extensions/workflow-register/src/core/runtime/runStateStore.ts`
- Create: `extensions/workflow-register/test/workflowRunStateMigration.test.js`

**Interfaces:**
- Consumes: codec and contained backup APIs.
- Produces: `FileRunStateStore.getLoadDiagnostics(): RunStateLoadDiagnostic[]`.

- [ ] **Step 1: Add store RED tests**

Cover:

- `createRun()` includes current schema;
- `saveRun()` persists current schema for an omitted in-memory field;
- loading v0 writes exact backup and v1 replacement without changing `updatedAt`;
- repeated load is idempotent;
- matching pre-created backup resumes migration;
- conflicting backup leaves `run.json` unchanged;
- future version loads for inspection, cannot save, and is not recoverable;
- one malformed run is omitted while a valid run remains listed;
- diagnostics are stable and sorted.

- [ ] **Step 2: Verify RED**

```bash
npm.cmd run compile && node --test test/workflowRunStateMigration.test.js
```

- [ ] **Step 3: Wire create and save**

`createRun()` sets the current schema. `saveRun()` prepares the run before calculating `updatedAt`, writes the prepared clone, and updates both `run.schemaVersion` and `run.updatedAt` only after success.

- [ ] **Step 4: Wire load migration**

Parse JSON with a stable invalid-JSON error, decode with expected run ID, and for `migrated: true`:

1. ensure exact-byte backup;
2. write formatted v1 JSON directly, preserving timestamps;
3. record an informational migration diagnostic.

For future versions, return the inspectable run and record a warning diagnostic.

- [ ] **Step 5: Isolate list failures**

Load each run in a per-entry try/catch. Record invalid diagnostics and continue. Sort returned runs by `updatedAt`, and sort diagnostics by run ID, severity, code, then message.

- [ ] **Step 6: Exclude non-current versions from recovery**

Add an exact schema check at the start of `isRecoverableRun()`.

- [ ] **Step 7: Verify GREEN and recovery regressions**

```bash
npm.cmd run compile
node --test test/workflowRunStateCodec.test.js \
  test/workflowRunStateMigrationPath.test.js \
  test/workflowRunStateMigration.test.js \
  test/workflowRunRecovery.test.js \
  test/runStateStorePathBoundary.test.js
```

- [ ] **Step 8: Commit store integration**

```bash
git add extensions/workflow-register/src/core/runtime/runStateStore.ts \
  extensions/workflow-register/test/workflowRunStateMigration.test.js
git commit -m "feat: migrate and protect workflow run state"
```

### Task 5: Surface Run Document Diagnostics and Synchronize Docs

**Files:**
- Modify: `extensions/workflow-register/src/core/runDiagnostics.ts`
- Modify: `extensions/workflow-register/src/commands/inspectRunDiagnostics.ts`
- Modify: `extensions/workflow-register/test/workflowRuntime.test.js`
- Modify: `extensions/workflow-register/docs/basic-design-ja.md`
- Modify: `extensions/workflow-register/docs/detailed-design-ja.md`
- Modify: `extensions/workflow-register/docs/unit-test-spec-ja.md`
- Create: `extensions/workflow-register/docs/run-state-schema-v1-ja.md`

**Interfaces:**
- Consumes: `RunStateLoadDiagnostic[]` and current schema constant.
- Produces: diagnostic report evidence for migration, read-only, and invalid files.

- [ ] **Step 1: Add diagnostic RED tests**

Assert the report contains:

```text
- run state schema: workflow-register/run-state/v1
```

For future runs:

```text
- run state schema: workflow-register/run-state/v2
- run state access: read-only
```

And a separate section:

```text
Run document diagnostics:
- <runId> [error/invalid]: ...
```

- [ ] **Step 2: Wire diagnostics**

Extend `WorkflowRunDiagnosticOptions` with `runDocumentDiagnostics?: RunStateLoadDiagnostic[]`. Pass `store.getLoadDiagnostics()` from `inspectRunDiagnostics()`.

- [ ] **Step 3: Add compatibility documentation**

Document:

- v0 unversioned migration;
- v1 current format;
- future-version read-only behavior;
- backup path and idempotence;
- `control.json`, snapshots, and manifest remain separately versioned contracts;
- residual crash/fsync and cross-process risks.

- [ ] **Step 4: Verify focused docs/diagnostics tests**

```bash
npm.cmd run compile
node --test test/workflowRuntime.test.js test/workflowRunStateMigration.test.js
```

- [ ] **Step 5: Commit diagnostics and docs**

```bash
git add extensions/workflow-register/src/core/runDiagnostics.ts \
  extensions/workflow-register/src/commands/inspectRunDiagnostics.ts \
  extensions/workflow-register/test/workflowRuntime.test.js \
  extensions/workflow-register/docs
git commit -m "docs: expose workflow run state migration diagnostics"
```

### Task 6: Full Verification and Release Evidence

**Files:**
- Create: `docs/release-evidence/workflow-run-state-schema-v1-2026-07-12.md`
- Modify: `docs/superpowers/plans/2026-07-12-workflow-run-state-schema-v1.md`

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: durable RED/GREEN, migration, policy, package, CI, and residual-risk evidence.

- [ ] **Step 1: Run full extension gates**

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
```

- [ ] **Step 2: Run repository diff checks**

```bash
git diff --check main...HEAD
```

- [ ] **Step 3: Inspect the VSIX**

Record size, SHA-256, generation time, and confirm source, tests, docs, fixtures, backups, and local runtime state are not packaged.

- [ ] **Step 4: Review the complete branch**

Review codec strictness, timestamp preservation, backup ordering, write rejection, future-version recovery exclusion, diagnostics isolation, path containment, and test fixture fidelity. Fix every Critical and Important finding.

- [ ] **Step 5: Record external CI honestly**

If jobs again end with `steps: null` / `logs_url: null`, record the run/job IDs as a runner-side blocker. Do not label repository tests green.

- [ ] **Step 6: Commit evidence and plan completion state**

```bash
git add docs/release-evidence/workflow-run-state-schema-v1-2026-07-12.md \
  docs/superpowers/plans/2026-07-12-workflow-run-state-schema-v1.md
git commit -m "docs: record workflow run state schema v1 evidence"
```

## Completion Rule

Keep the pull request draft and Merge/Release NO-GO until every local/full/package gate and Ubuntu/Windows runner job has fresh green evidence. A passing isolated codec harness may supplement diagnosis but cannot replace repository verification.
