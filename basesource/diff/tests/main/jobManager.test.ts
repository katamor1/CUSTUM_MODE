import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  JobManager,
  type JobProcess
} from "../../src/main/jobManager";
import type {
  MainToWorkerMessage,
  WorkerToMainMessage
} from "../../src/shared/jobMessages";
import { DEFAULT_APP_SETTINGS } from "../../src/shared/settings";

const request = {
  source: {
    kind: "folders" as const,
    leftRoot: "C:/before",
    rightRoot: "C:/after"
  },
  winMergePath: "C:/WinMerge/WinMergeU.exe",
  outputWorkbookPath: "C:/output/report.xlsx",
  outputPathTestWorkbookPath: "C:/output/path-test-report.xlsx",
  outputChangeListPath: "C:/output/changes.docx",
  rowOutput: DEFAULT_APP_SETTINGS.rowOutput
};

describe("JobManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs one job, routes progress, and ignores stale job messages", async () => {
    const process = new FakeJobProcess();
    const progress: string[] = [];
    const manager = createManager(process);
    const resultPromise = manager.start(request, (value) => progress.push(value.message), 7);

    await expect(manager.start(request, () => undefined, 7)).rejects.toThrow("実行中");
    process.emitMessage({ type: "ready" });
    await vi.waitFor(() => {
      expect(process.sent.length).toBe(1);
    });
    expect(process.sent.at(-1)).toMatchObject({
      type: "start",
      jobId: "job-1",
      request: { workDirectory: "C:/temp/job-1" }
    });

    process.emitMessage({
      type: "progress",
      jobId: "stale-job",
      progress: { phase: "reporting", message: "stale", completed: 0, total: 1 }
    });
    process.emitMessage({
      type: "progress",
      jobId: "job-1",
      progress: { phase: "reporting", message: "active", completed: 0, total: 1 }
    });
    process.emitMessage({
      type: "completed",
      jobId: "job-1",
      summary: {
        comparedFiles: 1,
        changedFiles: 1,
        outputWorkbookPath: request.outputWorkbookPath,
        outputPathTestWorkbookPath: request.outputPathTestWorkbookPath,
        outputChangeListPath: request.outputChangeListPath,
        workDirectory: "C:/temp/job-1"
      }
    });

    await expect(resultPromise).resolves.toMatchObject({
      status: "completed",
      summary: { comparedFiles: 1 }
    });
    expect(progress).toEqual(["active"]);
  });

  it("does not start the worker until existing output state is captured", async () => {
    const process = new FakeJobProcess();
    let finishInspection!: (value: {
      workbook: boolean;
      pathTestWorkbook: boolean;
      document: boolean;
    }) => void;
    const inspectExistingOutputs = vi.fn(() => new Promise<{
      workbook: boolean;
      pathTestWorkbook: boolean;
      document: boolean;
    }>((resolve) => {
      finishInspection = resolve;
    }));
    const manager = new JobManager({
      createProcess: () => process,
      createJobId: () => "job-1",
      createWorkDirectory: (jobId) => `C:/temp/${jobId}`,
      inspectExistingOutputs,
      cleanupInterruptedJob: async () => undefined
    });
    const resultPromise = manager.start(request, () => undefined);

    process.emitMessage({ type: "ready" });
    expect(process.sent).toEqual([]);

    finishInspection({ workbook: true, pathTestWorkbook: true, document: true });
    await vi.waitFor(() => {
      expect(process.sent.at(-1)).toMatchObject({ type: "start", jobId: "job-1" });
    });
    process.emitMessage({
      type: "cancelled",
      jobId: "job-1"
    });
    await resultPromise;
  });

  it("cancels the owning job and waits for worker cleanup", async () => {
    const process = new FakeJobProcess();
    const cleanup = vi.fn(async () => undefined);
    const manager = createManager(process, cleanup);
    const resultPromise = manager.start(request, () => undefined, 7);
    process.emitMessage({ type: "ready" });
    await vi.waitFor(() => {
      expect(process.sent.length).toBe(1);
    });

    await manager.cancel(8);
    expect(process.sent.some((message) => message.type === "cancel")).toBe(false);

    const cancelling = manager.cancel(7);
    expect(process.sent.at(-1)).toEqual({ type: "cancel", jobId: "job-1" });
    process.emitMessage({ type: "cancelled", jobId: "job-1" });

    await expect(cancelling).resolves.toBeUndefined();
    await expect(resultPromise).resolves.toEqual({ status: "cancelled" });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("force-stops an unresponsive worker after five seconds", async () => {
    const process = new FakeJobProcess();
    const cleanup = vi.fn(async () => undefined);
    const manager = createManager(process, cleanup);
    const resultPromise = manager.start(request, () => undefined);
    process.emitMessage({ type: "ready" });
    await vi.waitFor(() => {
      expect(process.sent.length).toBe(1);
    });

    const cancelling = manager.cancel();
    await vi.advanceTimersByTimeAsync(4999);
    expect(process.killed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(cancelling).resolves.toBeUndefined();
    await expect(resultPromise).resolves.toEqual({ status: "cancelled" });
    expect(process.killed).toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("waits for in-flight interrupted-output cleanup when cancellation is requested during settlement", async () => {
    const process = new FakeJobProcess();
    let finishCleanup!: () => void;
    const cleanup = vi.fn(() => new Promise<void>((resolve) => {
      finishCleanup = resolve;
    }));
    const manager = createManager(process, cleanup);
    const resultPromise = manager.start(request, () => undefined);
    process.emitMessage({ type: "ready" });
    await vi.waitFor(() => {
      expect(process.sent.length).toBe(1);
    });

    process.emitMessage({ type: "cancelled", jobId: "job-1" });
    await vi.waitFor(() => {
      expect(cleanup).toHaveBeenCalledOnce();
    });

    let cancelFinished = false;
    const cancelPromise = manager.cancel().then(() => {
      cancelFinished = true;
    });
    await Promise.resolve();
    expect(cancelFinished).toBe(false);

    finishCleanup();
    await expect(cancelPromise).resolves.toBeUndefined();
    await expect(resultPromise).resolves.toEqual({ status: "cancelled" });
  });

  it("force-stops cancellation before startup without waiting forever for output inspection", async () => {
    const process = new FakeJobProcess();
    const inspectExistingOutputs = vi.fn(() => new Promise<{
      workbook: boolean;
      pathTestWorkbook: boolean;
      document: boolean;
    }>(() => undefined));
    const cleanup = vi.fn(async () => undefined);
    const manager = new JobManager({
      createProcess: () => process,
      createJobId: () => "job-1",
      createWorkDirectory: (jobId) => `C:/temp/${jobId}`,
      inspectExistingOutputs,
      cleanupInterruptedJob: cleanup,
      forceStopDelayMs: 5000
    });
    const resultPromise = manager.start(request, () => undefined);
    process.emitMessage({ type: "ready" });
    expect(process.sent).toEqual([]);

    let cancelFinished = false;
    const cancelPromise = manager.cancel().then(() => {
      cancelFinished = true;
    });
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.resolve();

    expect(process.killed).toBe(true);
    expect(cancelFinished).toBe(true);
    expect(cleanup).not.toHaveBeenCalled();
    await expect(cancelPromise).resolves.toBeUndefined();
    await expect(resultPromise).resolves.toEqual({ status: "cancelled" });
  });

  it("rejects and cleans up when the worker crashes", async () => {
    const process = new FakeJobProcess();
    const cleanup = vi.fn(async () => undefined);
    const manager = createManager(process, cleanup);
    const resultPromise = manager.start(request, () => undefined);
    process.emitMessage({ type: "ready" });
    await vi.waitFor(() => {
      expect(process.sent.length).toBe(1);
    });
    process.emit("exit", 9);

    await expect(resultPromise).rejects.toThrow(/code 9/);
    expect(cleanup).toHaveBeenCalledOnce();
  });
});

function createManager(
  process: FakeJobProcess,
  cleanupInterruptedJob = vi.fn(async () => undefined)
): JobManager {
  return new JobManager({
    createProcess: () => process,
    createJobId: () => "job-1",
    createWorkDirectory: (jobId) => `C:/temp/${jobId}`,
    inspectExistingOutputs: async () => ({
      workbook: true,
      pathTestWorkbook: true,
      document: true
    }),
    cleanupInterruptedJob,
    forceStopDelayMs: 5000
  });
}

class FakeJobProcess extends EventEmitter implements JobProcess {
  readonly sent: MainToWorkerMessage[] = [];
  killed = false;

  postMessage(message: MainToWorkerMessage): void {
    this.sent.push(message);
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }

  emitMessage(message: WorkerToMainMessage): void {
    this.emit("message", message);
  }
}
