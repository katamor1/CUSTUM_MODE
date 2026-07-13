# Workflow Run State Schema v1 Design

- Date: 2026-07-12
- Repository: `katamor1/bob_builtin_analyze`
- Component: `extensions/workflow-register`
- Status: Approved for implementation by continuation request

## 1. Problem

`run.json` is the durable source of truth for workflow execution, but the file itself has no schema version and is loaded with an unchecked `JSON.parse(... as WorkflowRunState)` cast.

That creates four correctness risks:

1. old files cannot be migrated through an explicit, testable chain;
2. a future extension can write a shape that an older extension may silently reinterpret and overwrite;
3. malformed files can flow into runtime code as if they were valid `WorkflowRunState` values;
4. one malformed run currently rejects `listRuns()` and hides every otherwise valid run in the workspace.

The workflow definition schema and `engineVersion` do not solve this problem. They describe the workflow and producer, not the persisted `run.json` contract.

## 2. Goals

The first persisted run-state schema must:

- write `schemaVersion: workflow-register/run-state/v1` on every newly created or saved run;
- decode current v1 files through one codec before runtime use;
- treat an unversioned historical file as v0 and migrate it losslessly to v1;
- preserve the exact original v0 bytes in a migration backup before replacing `run.json`;
- make migration idempotent and safe to resume after a process failure;
- return structurally inspectable future-version runs as read-only;
- reject writes to any explicit schema version other than current v1;
- exclude read-only future-version runs from recovery and execution;
- isolate malformed run files so one bad directory does not break `listRuns()`;
- expose load and migration diagnostics for the existing run-diagnostics command;
- retain the existing workspace-containment, direct-file, and atomic-rename protections.

## 3. Non-goals

This change does not:

- redesign `control.json`, task snapshots, or artifact manifests;
- add a remote or cross-process lock;
- add fsync or a write-ahead journal;
- make arbitrary future schemas executable;
- delete historical backups automatically;
- change workflow definition version negotiation;
- change workflow engine step semantics.

Those formats remain in the compatibility table and can be versioned independently.

## 4. Approaches considered

### 4.1 Cast and add a field on save

Add a field to new files but keep loading with a type assertion.

This is rejected because it does not validate, migrate, protect future files, or isolate corruption.

### 4.2 Throw on every non-v1 file

Only exact v1 files would load.

This is rejected because all existing unversioned runs would become unusable and future-version runs would disappear from diagnostics instead of being visible as read-only evidence.

### 4.3 Central codec with explicit migration and read-only states

All `run.json` reads pass through a codec that classifies the document as current, migratable legacy, future read-only, or invalid. The store applies migration and write protection.

This is selected because it gives one contract boundary while preserving historical data and preventing downgrade writes.

## 5. Persisted v1 shape

The v1 shape is the current `WorkflowRunState` payload plus a top-level schema discriminator:

```json
{
  "schemaVersion": "workflow-register/run-state/v1",
  "runId": "20260712T000000Z-sample-0123456789ab",
  "workflowId": "workflow-register.sample",
  "workflowName": "sample",
  "status": "paused",
  "inputs": {},
  "state": {},
  "steps": [],
  "createdAt": "2026-07-12T00:00:00.000Z",
  "updatedAt": "2026-07-12T00:00:00.000Z"
}
```

`WorkflowRunState.schemaVersion` remains optional in the TypeScript transition model so existing in-memory test doubles and v0 decode input can be represented. Store-created and store-written files always contain the exact current value.

## 6. Codec contract

Create `src/core/runtime/runStateCodec.ts` with:

```ts
export const CURRENT_WORKFLOW_RUN_STATE_SCHEMA_VERSION = "workflow-register/run-state/v1" as const

export interface DecodedWorkflowRunState {
  run?: WorkflowRunState
  sourceVersion: "unversioned" | string
  migrated: boolean
  readOnly: boolean
  diagnostics: string[]
}

export function decodeWorkflowRunState(value: unknown, expectedRunId?: string): DecodedWorkflowRunState
export function prepareWorkflowRunStateForWrite(run: WorkflowRunState): WorkflowRunState
```

The codec classifies documents as follows:

| Input | Result |
| --- | --- |
| no `schemaVersion` | validate as historical v0, add current version in memory, `migrated: true` |
| exact current v1 | validate, `migrated: false`, writable |
| `workflow-register/run-state/vN` where `N` is not 1 | validate the stable inspectable core, return `readOnly: true` |
| malformed/foreign version value | invalid diagnostic, no runnable state |
| invalid JSON or invalid required core shape | invalid diagnostic, no runnable state |

The stable inspectable core is:

- `runId`, `workflowId`, `workflowName` as non-empty strings;
- known current `status`;
- object `inputs` and `state`;
- array `steps` with current stable step identity/status fields;
- string `createdAt` and `updatedAt`.

Unknown future versions are not assumed executable merely because this core is present. The core only allows diagnostics and listing.

## 7. Migration protocol

The v0-to-v1 migration occurs during `FileRunStateStore.loadRun()`.

1. Read stable `run.json` bytes through `readContainedRunFile()`.
2. Parse JSON and decode it.
3. For an unversioned valid v0 document, ensure an exact-byte backup exists at:

   ```text
   .bob/workflows/runs/<runId>/run-state-v0.backup.json
   ```

4. If the backup already exists with identical bytes, continue. If it exists with different bytes, stop with a conflict diagnostic and do not replace `run.json`.
5. Atomically replace `run.json` with the migrated v1 document while preserving the original `updatedAt` and all existing fields.
6. Return the migrated in-memory run.

The backup is written before the v1 replacement and is never silently overwritten. If the process exits after backup creation but before replacement, the next load repeats the decode, observes the matching backup, and completes migration.

Migration itself does not count as a workflow mutation, so it must not advance `updatedAt`.

## 8. Write protection

`saveRun()` calls `prepareWorkflowRunStateForWrite()` before serializing.

- Missing `schemaVersion` on an in-memory current object is normalized to current v1 for source compatibility.
- Exact current v1 is writable.
- Every other explicit version throws a stable read-only error before `updatedAt` changes or filesystem I/O begins.

`findRecoverableRun()` additionally requires the exact current schema version, so future-version runs cannot be selected for engine continuation.

## 9. Listing and diagnostics

`listRuns()` loads each run independently.

- Valid current and migrated v1 runs are returned.
- Inspectable future-version runs are returned, but marked read-only by their non-current `schemaVersion` and excluded from recovery.
- Invalid/corrupt runs are omitted from the runnable list rather than rejecting the whole operation.
- Every migration, read-only classification, and load failure is recorded as a `RunStateLoadDiagnostic`.

`FileRunStateStore.getLoadDiagnostics()` returns a stable sorted snapshot. `inspectRunDiagnostics()` passes these diagnostics to `buildWorkflowRunDiagnosticReport()`, which displays a separate “Run document diagnostics” section.

Run-level diagnostics display:

- the run-state schema version;
- `read-only: yes` when the schema is not current;
- migration/load diagnostics without pretending the run is executable.

## 10. Path and concurrency safety

The migration backup uses the same direct-directory, direct-regular-file, containment, identity, temporary-file, and atomic-rename checks as `run.json`.

The backup helper is create-once:

- identical existing content is accepted;
- differing existing content is a hard conflict;
- a race that creates the backup between observation and rename is re-read and compared.

This preserves the existing same-process and path-race protections. Cross-process locking and crash fsync remain explicit residual risks.

## 11. Error handling

Stable error families:

- invalid JSON;
- invalid required run-state field;
- run ID mismatch;
- unsupported/foreign run-state schema;
- future schema is read-only;
- migration backup conflict;
- contained path or atomic replacement failure.

Errors include the run ID but do not include full persisted state or task content.

## 12. Tests

Add deterministic tests for:

1. new runs and saves include the current schema version;
2. v1 round-trip preserves state;
3. historical unversioned fixture migrates losslessly;
4. exact original bytes are backed up before replacement;
5. repeated migration is idempotent;
6. a pre-existing matching backup resumes migration;
7. a conflicting backup blocks replacement;
8. future version loads as read-only and cannot be saved or recovered;
9. malformed version and malformed shape fail decode;
10. one malformed run does not hide valid runs;
11. load diagnostics are stable and sorted;
12. path-boundary tests cover the migration backup;
13. run diagnostics display current, migrated, read-only, and invalid-document evidence.

Historical fixtures live under `test/fixtures/run-state/` and contain fixed timestamps and IDs.

## 13. Rollout

This ships as a draft PR independent of workflow schema-version PR #70.

Merge remains blocked until:

- focused codec/store tests pass;
- the full extension suite passes;
- dependency, architecture, source, schema, unused, and audit gates pass;
- VSIX package and package policy pass;
- Ubuntu and Windows GitHub Actions begin runner steps and finish green;
- an independent diff review reports no Critical or Important findings.

The current GitHub-hosted runner allocation blocker is recorded as an external gate, not reclassified as a repository test result.
