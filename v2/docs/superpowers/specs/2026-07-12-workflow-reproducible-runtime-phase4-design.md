# Workflow Reproducible Runtime Through Phase 4 Design

- Date: 2026-07-12
- Repository: `katamor1/bob_builtin_analyze`
- Component: `extensions/workflow-register`
- Base: Phase 1 run-state schema branch (`agent/workflow-run-state-schema-v1-20260712`)
- Status: Approved for implementation by the explicit request to complete through Phase 4

## 1. Scope and phase boundaries

This design completes the remaining reproducible-runtime work through Phase 4.

| Phase | Contract |
| --- | --- |
| Phase 1 | Finish explicit run-state versioning and preserve an explicitly selected future-version run as a read-only target. |
| Phase 2 | Add an immutable, hash-chained run event log containing complete run snapshots. |
| Phase 3 | Add a crash-recovery journal and file/directory durability barriers around run-state commits. |
| Phase 4 | Add a cross-process run lease plus optimistic revision checks to prevent duplicate execution and stale overwrites. |

The existing `run.json` remains the materialized source of current execution state through Phase 4. The event log is immutable audit and recovery evidence; it does not replace `run.json` yet.

## 2. Goals

- Every successful persisted run transition has a verifiable immutable event.
- A process crash between journal creation, `run.json` replacement, event append, and journal cleanup can be recovered deterministically and idempotently.
- Two extension hosts cannot execute or mutate the same run concurrently.
- A stale in-memory run cannot overwrite a newer `run.json` written by another process.
- Existing unversioned and current-v1 runs remain usable.
- Future run-state versions remain inspectable but cannot be used for execution, recovery, pause/control mutation, artifact reuse, or save.
- All new files obey the existing workspace-containment, direct-directory, direct-file, no-symlink, and stable-identity rules.
- Failure evidence is surfaced through run diagnostics without treating an invalid or locked run as empty state.

## 3. Non-goals

- Replacing `run.json` with full event sourcing.
- Event-log compaction or retention.
- Distributed consensus across machines.
- Provider cancellation, AI token budgets, or command process termination.
- Journaling arbitrary external provider side effects.
- Changing workflow definition schema negotiation.

## 4. Approaches considered

### 4.1 Lock-only persistence

Use a lock file around existing `run.json` writes.

Rejected because it prevents overlap but provides no immutable history and cannot finish an interrupted multi-file commit.

### 4.2 Full event-sourced runtime

Make the event log authoritative and rebuild all state by replay.

Deferred because it would require broad engine, diagnostics, Builder, and migration changes. It is larger than the requested Phase 4 boundary.

### 4.3 Materialized state plus event log, journal, and lease

Keep `run.json` as the materialized current state, append full snapshots to a hash chain, journal the next state and event before mutation, and serialize writers with a lease and revision check.

Selected because it closes the identified crash and cross-process risks while preserving current runtime APIs and compatibility.

## 5. Persisted files

Each run directory may contain:

```text
.bob/workflows/runs/<runId>/
  run.json
  control.json
  events.ndjson
  run-state.journal.json
  run.lock.json
  run-state-v0.backup.json
```

`run.lock.json` and `run-state.journal.json` are operational files. A cleanly completed transaction leaves no journal or lock file.

## 6. Phase 2: immutable event log

### 6.1 Event schema

Each line of `events.ndjson` is one JSON object:

```ts
interface WorkflowRunEventV1 {
  schemaVersion: "workflow-register/run-event/v1"
  sequence: number
  eventId: string
  runId: string
  kind: "run.created" | "run.updated" | "run.migrated" | "run.recovered"
  occurredAt: string
  previousEventHash?: string
  previousRunHash?: string
  runHash: string
  snapshot: WorkflowRunState
  hash: string
}
```

The event `hash` is SHA-256 over stable JSON of every field except `hash`. `previousEventHash` forms a chain. `runHash` is SHA-256 over the exact formatted `run.json` bytes represented by `snapshot`.

### 6.2 Compatibility

- Existing v1 runs without `events.ndjson` remain valid.
- Their first mutation creates sequence 1 with `previousRunHash` set to the pre-mutation `run.json` hash.
- Unversioned migration records `run.migrated`.
- Unknown event schema versions, broken sequences, invalid hashes, duplicate event IDs, or mismatched run IDs fail closed for mutation.
- Reads may still show the current `run.json`, but diagnostics report the invalid event log.

### 6.3 Append rules

- The event file is direct, workspace-contained, and never atomically replaced after creation.
- Append uses an append-only file descriptor and fsync.
- The complete chain is validated before choosing the next sequence and previous hash.
- Under the Phase 4 lease, only one writer may append.

## 7. Phase 3: crash journal and durability

### 7.1 Journal schema

```ts
interface WorkflowRunJournalV1 {
  schemaVersion: "workflow-register/run-journal/v1"
  transactionId: string
  runId: string
  createdAt: string
  previousRunHash?: string
  nextRunHash: string
  previousEventHash?: string
  nextRun: WorkflowRunState
  nextEvent: WorkflowRunEventV1
}
```

### 7.2 Commit sequence

A run-state commit executes under the Phase 4 lease:

1. Read and validate current `run.json`, event chain, and any existing journal.
2. Verify the caller's expected revision.
3. Build the next run and next event.
4. Atomically write `run-state.journal.json`.
5. fsync the journal file and run directory.
6. Atomically replace `run.json`.
7. fsync `run.json` and the run directory.
8. Append the event.
9. fsync `events.ndjson` and the run directory.
10. Remove the journal and fsync the run directory.

### 7.3 Recovery state machine

When a valid journal exists:

- If `run.json` has `previousRunHash`, write `nextRun`.
- If `run.json` already has `nextRunHash`, do not rewrite it.
- Otherwise, stop with a journal conflict.
- If the event log head is `previousEventHash`, append `nextEvent`.
- If the event log head already equals `nextEvent.hash`, do not append it again.
- Otherwise, stop with an event-head conflict.
- Remove the journal only after both materialized state and event evidence match.

Recovery is idempotent. A malformed or foreign journal is never deleted automatically.

### 7.4 Durability behavior

File fsync is mandatory. Directory fsync is attempted after create, rename, append, and remove. Platforms that reject directory fsync with documented unsupported errors may continue after recording that the directory barrier was unavailable; other errors fail the transaction.

## 8. Phase 4: cross-process lease and stale-write prevention

### 8.1 Lease schema

```ts
interface WorkflowRunLockV1 {
  schemaVersion: "workflow-register/run-lock/v1"
  runId: string
  token: string
  pid: number
  hostname: string
  createdAt: string
  heartbeatAt: string
}
```

### 8.2 Acquisition

- Create `run.lock.json` with exclusive create semantics.
- Verify the run directory and lock file are direct and contained.
- The same async execution chain may re-enter its own lease.
- Other writers wait with bounded polling and then fail with a stable busy error.
- A heartbeat refreshes ownership during long provider or agent execution.

### 8.3 Stale lease recovery

- Same hostname and live PID: never reclaim based only on age.
- Same hostname and dead PID: reclaim after identity revalidation.
- Different hostname: reclaim only after the heartbeat exceeds the configured stale interval.
- Malformed lock: reclaim only after the file modification time exceeds the stale interval.
- Release removes the file only when the on-disk token still matches the owner token.

### 8.4 Operation boundary

`coordinateWorkflowRunExecution()` acquires the lease around the full run mutation, including provider execution. `FileRunStateStore.saveRun()` also acquires it defensively; reentrant acquisition is a no-op for the owning async chain. Checkpoint operations are routed through the coordinator as well.

`FileRunControlStore` uses the same lease for control mutations, so pause and resume-control writes cannot race a state transition.

### 8.5 Optimistic revision check

Loaded run objects are associated with the SHA-256 revision of their exact `run.json` bytes in a process-local `WeakMap`.

- A newly created run expects no existing file.
- A loaded run expects the recorded revision.
- Before commit, the current file hash must equal the expected revision.
- A mismatch throws a stable stale-write error before journal creation.
- After a successful commit or recovery, the revision association is updated.

This check prevents a writer that waited for the lease from overwriting a transition made while it was stale.

## 9. Phase 1 explicit-target closure

A loaded run's `inputs` object is associated with its `runId` in a process-local `WeakMap`. When command code passes those exact inputs to single-step recovery, the store preserves the selected run identity.

- An explicitly selected future run throws the read-only error even when a matching current run exists.
- Ordinary user-provided inputs still prefer a matching current recoverable run over newer future evidence.
- No marker is persisted into `run.json`.

## 10. Diagnostics

Extend `RunStateLoadDiagnostic.code` with:

```text
event-log-invalid
journal-recovered
journal-conflict
lock-reclaimed
lock-busy
stale-write
```

Run diagnostics show:

- event count and head hash;
- pending or recovered journal status;
- read-only schema status;
- stale-lock reclamation evidence;
- stale-write and event-chain failures.

No diagnostic includes workflow state values, prompts, provider payloads, or artifact content.

## 11. Testing strategy

### Phase 1

- current recovery remains preferred for ordinary inputs;
- an explicitly loaded future run remains the selected target and is rejected.

### Phase 2

- first event, sequence increments, full snapshot, exact run hash;
- hash-chain validation and tamper detection;
- append idempotency by event hash;
- symlink and workspace escape rejection;
- future event schema rejection.

### Phase 3

Inject failures after journal write, run replacement, and event append. Reopen the store and verify exactly-once recovery, stable timestamps, journal cleanup, and unchanged data on conflicts.

### Phase 4

- two independent store instances serialize the same run;
- child-process tests prove a second process cannot acquire an active lease;
- dead-owner stale lock is reclaimed;
- token mismatch prevents accidental release;
- stale loaded state fails revision comparison;
- same run ID in different physical workspace roots remains independent;
- workspace aliases map to the same lease key;
- future-version runs never acquire a mutation lease.

## 12. Rollout and PR structure

Phase 1 remains in PR #71. Phases 2-4 are implemented on `agent/workflow-reproducible-runtime-phase4-20260712` and proposed as a Draft PR targeting the Phase 1 branch until PR #71 is merged.

The Draft must remain Merge/Release NO-GO until repository compile, focused tests, full suite, policies, package, Ubuntu/Windows Actions, and independent review have fresh green evidence. Runner jobs that end before checkout are recorded as external blockers, not test results.
