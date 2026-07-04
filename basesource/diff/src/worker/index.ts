import { runProcess } from "../core/processRunner";
import {
  generateDiffWorkbook,
  type GenerateDiffWorkbookInput,
  type GenerateDiffWorkbookSummary,
  type ReportProgress
} from "../core/reportJob";
import {
  isMainToWorkerMessage,
  type SerializedError,
  type WorkerToMainMessage
} from "../shared/jobMessages";

export interface WorkerPort {
  postMessage(message: WorkerToMainMessage): void;
  onMessage(listener: (message: unknown) => void): void;
}

export type WorkerJobInput = Omit<GenerateDiffWorkbookInput, "runProcess">;

export interface WorkerDependencies {
  runJob: (input: WorkerJobInput) => Promise<GenerateDiffWorkbookSummary>;
}

interface ActiveJob {
  jobId: string;
  controller: AbortController;
  phase?: ReportProgress["phase"];
}

const DEFAULT_DEPENDENCIES: WorkerDependencies = {
  runJob: (input) => generateDiffWorkbook({ ...input, runProcess })
};

export function createWorkerController(
  port: WorkerPort,
  dependencies: WorkerDependencies = DEFAULT_DEPENDENCIES
): void {
  let activeJob: ActiveJob | undefined;

  port.onMessage((value) => {
    if (!isMainToWorkerMessage(value)) {
      return;
    }

    if (value.type === "cancel") {
      if (!activeJob || activeJob.jobId !== value.jobId || activeJob.controller.signal.aborted) {
        return;
      }

      port.postMessage({
        type: "progress",
        jobId: activeJob.jobId,
        progress: {
          phase: "cancelling",
          message: "中止処理中",
          completed: 0,
          total: 0
        }
      });
      activeJob.controller.abort();
      return;
    }

    if (activeJob) {
      port.postMessage({
        type: "failed",
        jobId: value.jobId,
        error: {
          name: "JobAlreadyRunningError",
          message: "別のレポートジョブが実行中です。"
        }
      });
      return;
    }

    const controller = new AbortController();
    const job: ActiveJob = {
      jobId: value.jobId,
      controller
    };
    activeJob = job;

    void dependencies.runJob({
      ...value.request,
      jobId: value.jobId,
      signal: controller.signal,
      onProgress: (progress) => {
        if (activeJob !== job) {
          return;
        }
        job.phase = progress.phase;
        port.postMessage({
          type: "progress",
          jobId: job.jobId,
          progress
        });
      }
    }).then((summary) => {
      if (activeJob === job) {
        port.postMessage({ type: "completed", jobId: job.jobId, summary });
      }
    }).catch((error: unknown) => {
      if (activeJob !== job) {
        return;
      }

      if (controller.signal.aborted || isAbortError(error)) {
        port.postMessage({ type: "cancelled", jobId: job.jobId });
        return;
      }

      port.postMessage({
        type: "failed",
        jobId: job.jobId,
        error: serializeError(error, job.phase)
      });
    }).finally(() => {
      if (activeJob === job) {
        activeJob = undefined;
      }
    });
  });

  port.postMessage({ type: "ready" });
}

function serializeError(error: unknown, phase?: ReportProgress["phase"]): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      phase
    };
  }

  return {
    name: "Error",
    message: String(error),
    phase
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

type ElectronParentPort = {
  postMessage(message: WorkerToMainMessage): void;
  on(event: "message", listener: (event: MessageEvent) => void): void;
};

const parentPort = (process as NodeJS.Process & {
  parentPort?: ElectronParentPort;
}).parentPort;

if (parentPort) {
  createWorkerController({
    postMessage: (message) => parentPort.postMessage(message),
    onMessage: (listener) => {
      parentPort.on("message", (event) => listener(event.data));
    }
  });
}
