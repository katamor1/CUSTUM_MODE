import { describe, expect, it } from "vitest";
import type {
  GenerateDiffWorkbookSummary
} from "../../src/core/reportJob";
import type {
  MainToWorkerMessage,
  WorkerToMainMessage
} from "../../src/shared/jobMessages";
import { DEFAULT_APP_SETTINGS } from "../../src/shared/settings";
import {
  createWorkerController,
  type WorkerPort
} from "../../src/worker/index";

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
  workDirectory: "C:/temp/job-1",
  rowOutput: DEFAULT_APP_SETTINGS.rowOutput
};

describe("worker protocol", () => {
  it("announces ready and forwards progress and completion", async () => {
    const port = new FakeWorkerPort();
    createWorkerController(port, {
      runJob: async (input) => {
        input.onProgress?.({
          phase: "reporting",
          message: "reporting",
          completed: 1,
          total: 2
        });
        return {
          comparedFiles: 2,
          changedFiles: 3,
          outputWorkbookPath: input.outputWorkbookPath,
          outputPathTestWorkbookPath: input.outputPathTestWorkbookPath,
          outputChangeListPath: input.outputChangeListPath,
          workDirectory: "C:/temp/job-1"
        };
      }
    });

    port.deliver({ type: "start", jobId: "job-1", request });
    await port.waitForType("completed");

    expect(port.messages).toEqual([
      { type: "ready" },
      {
        type: "progress",
        jobId: "job-1",
        progress: {
          phase: "reporting",
          message: "reporting",
          completed: 1,
          total: 2
        }
      },
      {
        type: "completed",
        jobId: "job-1",
        summary: {
          comparedFiles: 2,
          changedFiles: 3,
          outputWorkbookPath: request.outputWorkbookPath,
          outputPathTestWorkbookPath: request.outputPathTestWorkbookPath,
          outputChangeListPath: request.outputChangeListPath,
          workDirectory: "C:/temp/job-1"
        }
      }
    ]);
  });

  it("aborts the active matching job and reports cancellation", async () => {
    const port = new FakeWorkerPort();
    createWorkerController(port, {
      runJob: (input) => waitForAbort(input.signal)
    });

    port.deliver({ type: "start", jobId: "job-2", request });
    port.deliver({ type: "cancel", jobId: "stale-job" });
    expect(port.messages).toEqual([{ type: "ready" }]);

    port.deliver({ type: "cancel", jobId: "job-2" });
    await port.waitForType("cancelled");

    expect(port.messages).toContainEqual({
      type: "progress",
      jobId: "job-2",
      progress: {
        phase: "cancelling",
        message: "中止処理中",
        completed: 0,
        total: 0
      }
    });
    expect(port.messages.at(-1)).toEqual({ type: "cancelled", jobId: "job-2" });
  });

  it("serializes failures with the last progress phase", async () => {
    const port = new FakeWorkerPort();
    createWorkerController(port, {
      runJob: async (input) => {
        input.onProgress?.({
          phase: "workbook",
          message: "workbook",
          completed: 0,
          total: 1
        });
        throw new TypeError("export failed");
      }
    });

    port.deliver({ type: "start", jobId: "job-3", request });
    await port.waitForType("failed");

    expect(port.messages.at(-1)).toMatchObject({
      type: "failed",
      jobId: "job-3",
      error: {
        name: "TypeError",
        message: "export failed",
        phase: "workbook"
      }
    });
  });
});

class FakeWorkerPort implements WorkerPort {
  readonly messages: WorkerToMainMessage[] = [];
  private listener?: (message: unknown) => void;

  postMessage(message: WorkerToMainMessage): void {
    this.messages.push(message);
  }

  onMessage(listener: (message: unknown) => void): void {
    this.listener = listener;
  }

  deliver(message: MainToWorkerMessage): void {
    this.listener?.(message);
  }

  async waitForType(type: WorkerToMainMessage["type"]): Promise<void> {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (this.messages.some((message) => message.type === type)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    throw new Error(`Timed out waiting for worker message: ${type}`);
  }
}

async function waitForAbort(
  signal: AbortSignal | undefined
): Promise<GenerateDiffWorkbookSummary> {
  if (!signal) {
    throw new Error("signal is required");
  }

  await new Promise<void>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(abortError()), { once: true });
  });
  throw new Error("unreachable");
}

function abortError(): Error {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}
