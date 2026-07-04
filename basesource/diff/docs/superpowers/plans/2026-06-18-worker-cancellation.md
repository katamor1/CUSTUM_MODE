# Worker Isolation and Cancellation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the complete report job in an Electron utility process while keeping the UI responsive and supporting reliable cancellation and cleanup.

**Architecture:** Main owns a single-job `JobManager`; a separately built worker owns all core processing and child processes. Outputs are written to job-specific staging files and atomically promoted only after both Excel and Word complete.

**Tech Stack:** Electron 33 `utilityProcess`, TypeScript, Node child processes, AbortController, Vitest

---

### Task 1: Job Message Contract

**Files:**
- Create: `src/shared/jobMessages.ts`
- Modify: `src/shared/ipcTypes.ts`
- Test: `tests/shared/jobMessages.test.ts`

- [ ] **Step 1: Write failing tests for type guards on start, cancel, progress, completed, cancelled, and failed messages**
- [ ] **Step 2: Verify failure**
- [ ] **Step 3: Implement serializable message types, `JobResult`, and defensive runtime guards**
- [ ] **Step 4: Verify pass**
- [ ] **Step 5: Commit `feat: define worker job protocol`**

### Task 2: Abortable Process Runner

**Files:**
- Modify: `src/core/processRunner.ts`
- Modify: `src/core/reportJob.ts`
- Test: `tests/core/processRunner.test.ts`

- [ ] **Step 1: Write a failing test that starts a long-running Node child and aborts it**

```ts
const controller = new AbortController();
const running = runProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], controller.signal);
controller.abort();
await expect(running).rejects.toMatchObject({ name: "AbortError" });
```

- [ ] **Step 2: Verify the child remains active or signature is unsupported**
- [ ] **Step 3: Track spawned children, attach abort listeners, terminate the owned process tree on Windows, and reject with `AbortError`**
- [ ] **Step 4: Verify focused process tests pass**
- [ ] **Step 5: Commit `feat: make external processes cancellable`**

### Task 3: Staged Output Transaction

**Files:**
- Create: `src/core/outputTransaction.ts`
- Test: `tests/core/outputTransaction.test.ts`

- [ ] **Step 1: Write failing tests for temporary names, two-file commit, rollback, and cleanup**
- [ ] **Step 2: Verify failure**
- [ ] **Step 3: Implement same-directory `.diffrepo-<jobId>.tmp.xlsx/.docx` staging, backup, promotion, rollback, and idempotent cleanup**
- [ ] **Step 4: Verify existing outputs survive failed second-file promotion**
- [ ] **Step 5: Commit `feat: stage report outputs transactionally`**

### Task 4: Abortable Report Job

**Files:**
- Modify: `src/core/reportJob.ts`
- Modify: `src/core/excelExporter.ts`
- Modify: `src/core/htmlReport.ts`
- Modify: `src/core/filePairs.ts`
- Modify: `src/core/changeListDocument.ts`
- Test: `tests/core/reportJob.test.ts`

- [ ] **Step 1: Write failing tests that abort during reporting and workbook phases and assert staged outputs and work directory are removed**
- [ ] **Step 2: Verify failure**
- [ ] **Step 3: Add `signal`, `jobId`, stage paths, `throwIfAborted`, and progress checkpoints at file/row batches**
- [ ] **Step 4: Promote both staged outputs only after successful completion**
- [ ] **Step 5: Verify focused job tests pass**
- [ ] **Step 6: Commit `feat: support report job cancellation`**

### Task 5: Utility Worker Entrypoint

**Files:**
- Create: `src/worker/index.ts`
- Modify: `electron.vite.config.ts`
- Test: `tests/worker/workerProtocol.test.ts`

- [ ] **Step 1: Write a failing worker protocol test using an injected port adapter**
- [ ] **Step 2: Verify failure**
- [ ] **Step 3: Implement ready/start/cancel handling, one AbortController, progress forwarding, serialized failure, and final cleanup**
- [ ] **Step 4: Add worker as a separate main-build Rollup input and verify `out/worker/index.js` exists**
- [ ] **Step 5: Commit `feat: run reports in utility worker`**

### Task 6: Main JobManager

**Files:**
- Create: `src/main/jobManager.ts`
- Modify: `src/main/index.ts`
- Test: `tests/main/jobManager.test.ts`

- [ ] **Step 1: Write failing fake-process tests for single job, progress routing, cancel, stale job IDs, worker crash, and five-second forced stop**
- [ ] **Step 2: Verify failure**
- [ ] **Step 3: Implement `JobManager` with injected process factory/timers/filesystem cleanup for testability**
- [ ] **Step 4: Replace direct `generateDiffWorkbook` call in Main with manager start/cancel**
- [ ] **Step 5: Verify focused tests pass**
- [ ] **Step 6: Commit `feat: manage isolated report jobs`**

### Task 7: Renderer Cancellation UX

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/uiText.ts`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/shared/ipcTypes.ts`
- Test: `tests/renderer/uiText.test.ts`

- [ ] **Step 1: Write failing tests for running/cancelling/cancelled Japanese labels**
- [ ] **Step 2: Verify failure**
- [ ] **Step 3: Add `cancelJob`, run states, Stop icon button, disabled editing while running, and cancelled result handling**
- [ ] **Step 4: Verify renderer tests and build**
- [ ] **Step 5: Commit `feat: add report cancellation UI`**

### Task 8: Window Close Coordination

**Files:**
- Modify: `src/main/index.ts`
- Test: `tests/main/windowClose.test.ts`

- [ ] **Step 1: Write a failing test for preventing first close, awaiting cancellation, then allowing destroy**
- [ ] **Step 2: Verify failure**
- [ ] **Step 3: Extract close coordinator and use it for window close and app quit**
- [ ] **Step 4: Verify focused tests pass**
- [ ] **Step 5: Commit `feat: cancel reports before app exit`**

