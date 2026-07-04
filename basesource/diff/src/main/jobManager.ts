import { access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { recoverInterruptedOutputTransaction } from "../core/outputTransaction";
import type { ReportProgress } from "../core/reportJob";
import {
  isWorkerToMainMessage,
  type JobResult,
  type MainToWorkerMessage,
  type SerializedError,
  type WorkerJobRequest
} from "../shared/jobMessages";
import type { StartJobRequest } from "../shared/ipcTypes";

export interface JobProcess {
  postMessage(message: MainToWorkerMessage): void;
  kill(): boolean;
  on(event: "message", listener: (message: unknown) => void): this;
  on(event: "exit", listener: (code: number) => void): this;
  on(event: "error", listener: (type: string, location: string, report: string) => void): this;
}

export interface ExistingOutputs {
  workbook: boolean;
  pathTestWorkbook: boolean;
  document: boolean;
}

export interface InterruptedJobContext {
  jobId: string;
  request: WorkerJobRequest;
  existedBefore: ExistingOutputs;
}

export interface JobManagerOptions {
  createProcess: () => JobProcess;
  createJobId?: () => string;
  createWorkDirectory?: (jobId: string) => string;
  inspectExistingOutputs?: (request: StartJobRequest) => Promise<ExistingOutputs>;
  cleanupInterruptedJob?: (context: InterruptedJobContext) => Promise<void>;
  forceStopDelayMs?: number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}

interface ActiveJob {
  jobId: string;
  ownerId?: number;
  process: JobProcess;
  request: WorkerJobRequest;
  existedBefore: Promise<ExistingOutputs>;
  onProgress: (progress: ReportProgress) => void;
  result: Promise<JobResult>;
  done: Promise<void>;
  resolveResult: (result: JobResult) => void;
  rejectResult: (error: Error) => void;
  resolveDone: () => void;
  ready: boolean;
  started: boolean;
  settled: boolean;
  cancelRequested: boolean;
  forceStopTimer?: ReturnType<typeof setTimeout>;
  fatalError?: string;
}

const DEFAULT_FORCE_STOP_DELAY_MS = 5000;

export class JobManager {
  private readonly options: Required<
    Pick<
      JobManagerOptions,
      | "createProcess"
      | "createJobId"
      | "createWorkDirectory"
      | "inspectExistingOutputs"
      | "cleanupInterruptedJob"
      | "forceStopDelayMs"
      | "setTimeout"
      | "clearTimeout"
    >
  >;
  private activeJob?: ActiveJob;

  constructor(options: JobManagerOptions) {
    this.options = {
      createProcess: options.createProcess,
      createJobId: options.createJobId ?? randomUUID,
      createWorkDirectory: options.createWorkDirectory
        ?? ((jobId) => path.join(tmpdir(), `diffrepo-report-${jobId}`)),
      inspectExistingOutputs: options.inspectExistingOutputs ?? inspectExistingOutputs,
      cleanupInterruptedJob: options.cleanupInterruptedJob ?? cleanupInterruptedJob,
      forceStopDelayMs: options.forceStopDelayMs ?? DEFAULT_FORCE_STOP_DELAY_MS,
      setTimeout: options.setTimeout ?? setTimeout,
      clearTimeout: options.clearTimeout ?? clearTimeout
    };
  }

  start(
    request: StartJobRequest,
    onProgress: (progress: ReportProgress) => void,
    ownerId?: number
  ): Promise<JobResult> {
    if (this.activeJob) {
      return Promise.reject(new Error("別のレポートジョブが実行中です。"));
    }

    const jobId = this.options.createJobId();
    const workerRequest: WorkerJobRequest = {
      ...request,
      workDirectory: this.options.createWorkDirectory(jobId)
    };
    const process = this.options.createProcess();
    let resolveResult!: (result: JobResult) => void;
    let rejectResult!: (error: Error) => void;
    let resolveDone!: () => void;
    const result = new Promise<JobResult>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const activeJob: ActiveJob = {
      jobId,
      ownerId,
      process,
      request: workerRequest,
      existedBefore: this.options.inspectExistingOutputs(request),
      onProgress,
      result,
      done,
      resolveResult,
      rejectResult,
      resolveDone,
      ready: false,
      started: false,
      settled: false,
      cancelRequested: false
    };
    this.activeJob = activeJob;

    process.on("message", (message) => {
      this.handleWorkerMessage(activeJob, message);
    });
    process.on("error", (type, location) => {
      activeJob.fatalError = `${type} at ${location}`;
    });
    process.on("exit", (code) => {
      if (activeJob.settled) {
        return;
      }
      const detail = activeJob.fatalError ? ` (${activeJob.fatalError})` : "";
      void this.settleFailed(
        activeJob,
        new Error(`Report worker exited with code ${code}${detail}`),
        activeJob.started
      );
    });

    return result;
  }

  async cancel(ownerId?: number): Promise<void> {
    const activeJob = this.activeJob;
    if (!activeJob) {
      return;
    }

    if (ownerId !== undefined
      && activeJob.ownerId !== undefined
      && ownerId !== activeJob.ownerId) {
      return;
    }

    if (activeJob.settled) {
      await activeJob.done;
      return;
    }

    if (!activeJob.cancelRequested) {
      activeJob.cancelRequested = true;
      if (activeJob.started) {
        activeJob.process.postMessage({ type: "cancel", jobId: activeJob.jobId });
      }
      activeJob.forceStopTimer = this.options.setTimeout(() => {
        void this.forceStop(activeJob);
      }, this.options.forceStopDelayMs);
    }

    await activeJob.done;
  }

  hasActiveJob(): boolean {
    return this.activeJob !== undefined;
  }

  private handleWorkerMessage(activeJob: ActiveJob, value: unknown): void {
    if (this.activeJob !== activeJob || activeJob.settled || !isWorkerToMainMessage(value)) {
      return;
    }

    if (value.type === "ready") {
      if (activeJob.ready) {
        return;
      }
      activeJob.ready = true;
      void this.startWorkerWhenPrepared(activeJob);
      return;
    }

    if (value.jobId !== activeJob.jobId) {
      return;
    }

    switch (value.type) {
      case "progress":
        activeJob.onProgress(value.progress);
        break;
      case "completed":
        void this.settleCompleted(activeJob, {
          status: "completed",
          summary: value.summary
        });
        break;
      case "cancelled":
        void this.settleCompleted(activeJob, { status: "cancelled" }, true);
        break;
      case "failed":
        void this.settleFailed(activeJob, deserializeError(value.error), true);
        break;
    }
  }

  private async startWorkerWhenPrepared(activeJob: ActiveJob): Promise<void> {
    try {
      await activeJob.existedBefore;
    } catch (error) {
      await this.settleFailed(activeJob, asError(error), false);
      return;
    }

    if (this.activeJob !== activeJob || activeJob.settled) {
      return;
    }

    if (activeJob.cancelRequested) {
      await this.settleCompleted(activeJob, { status: "cancelled" });
      return;
    }

    activeJob.started = true;
    activeJob.process.postMessage({
      type: "start",
      jobId: activeJob.jobId,
      request: activeJob.request
    });
  }

  private async forceStop(activeJob: ActiveJob): Promise<void> {
    if (this.activeJob !== activeJob || activeJob.settled) {
      return;
    }

    activeJob.process.kill();
    await this.settleCompleted(activeJob, { status: "cancelled" }, activeJob.started);
  }

  private async settleCompleted(
    activeJob: ActiveJob,
    result: JobResult,
    cleanup = false
  ): Promise<void> {
    if (!this.beginSettlement(activeJob)) {
      return;
    }

    try {
      if (cleanup) {
        await this.cleanup(activeJob);
      }
      activeJob.resolveResult(result);
    } catch (error) {
      activeJob.rejectResult(asError(error));
    } finally {
      this.finishSettlement(activeJob);
    }
  }

  private async settleFailed(
    activeJob: ActiveJob,
    error: Error,
    cleanup: boolean
  ): Promise<void> {
    if (!this.beginSettlement(activeJob)) {
      return;
    }

    try {
      if (cleanup) {
        await this.cleanup(activeJob);
      }
      activeJob.rejectResult(error);
    } catch (cleanupError) {
      activeJob.rejectResult(new AggregateError(
        [error, cleanupError],
        `${error.message}; interrupted job cleanup also failed`
      ));
    } finally {
      this.finishSettlement(activeJob);
    }
  }

  private beginSettlement(activeJob: ActiveJob): boolean {
    if (activeJob.settled) {
      return false;
    }

    activeJob.settled = true;
    if (activeJob.forceStopTimer) {
      this.options.clearTimeout(activeJob.forceStopTimer);
    }
    return true;
  }

  private finishSettlement(activeJob: ActiveJob): void {
    activeJob.process.kill();
    if (this.activeJob === activeJob) {
      this.activeJob = undefined;
    }
    activeJob.resolveDone();
  }

  private async cleanup(activeJob: ActiveJob): Promise<void> {
    await this.options.cleanupInterruptedJob({
      jobId: activeJob.jobId,
      request: activeJob.request,
      existedBefore: await activeJob.existedBefore
    });
  }
}

async function inspectExistingOutputs(request: StartJobRequest): Promise<ExistingOutputs> {
  const [workbook, pathTestWorkbook, document] = await Promise.all([
    pathExists(request.outputWorkbookPath),
    pathExists(request.outputPathTestWorkbookPath),
    pathExists(request.outputChangeListPath)
  ]);
  return { workbook, pathTestWorkbook, document };
}

async function cleanupInterruptedJob(context: InterruptedJobContext): Promise<void> {
  await recoverInterruptedOutputTransaction({
    jobId: context.jobId,
    outputWorkbookPath: context.request.outputWorkbookPath,
    outputPathTestWorkbookPath: context.request.outputPathTestWorkbookPath,
    outputChangeListPath: context.request.outputChangeListPath,
    existedBefore: context.existedBefore
  });
  await rm(context.request.workDirectory, { recursive: true, force: true });
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

function deserializeError(error: SerializedError): Error {
  const result = new Error(error.message);
  result.name = error.name;
  if (error.stack) {
    result.stack = error.stack;
  }
  return result;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
