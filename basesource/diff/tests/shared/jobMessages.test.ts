import { describe, expect, it } from "vitest";
import {
  isMainToWorkerMessage,
  isWorkerToMainMessage
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
  workDirectory: "C:/temp/job-1",
  rowOutput: DEFAULT_APP_SETTINGS.rowOutput
};

describe("job message guards", () => {
  it("accepts valid start and cancel messages", () => {
    expect(isMainToWorkerMessage({ type: "start", jobId: "job-1", request })).toBe(true);
    expect(isMainToWorkerMessage({ type: "cancel", jobId: "job-1" })).toBe(true);
  });

  it("rejects malformed main messages", () => {
    expect(isMainToWorkerMessage({ type: "start", jobId: "", request })).toBe(false);
    expect(isMainToWorkerMessage({
      type: "start",
      jobId: "job-1",
      request: { ...request, outputPathTestWorkbookPath: undefined }
    })).toBe(false);
    expect(isMainToWorkerMessage({ type: "cancel", jobId: 12 })).toBe(false);
    expect(isMainToWorkerMessage({ type: "unknown", jobId: "job-1" })).toBe(false);
  });

  it("accepts valid ready, progress, completed, cancelled, and failed messages", () => {
    expect(isWorkerToMainMessage({ type: "ready" })).toBe(true);
    expect(isWorkerToMainMessage({
      type: "progress",
      jobId: "job-1",
      progress: {
        phase: "reporting",
        message: "reporting",
        completed: 1,
        total: 2
      }
    })).toBe(true);
    expect(isWorkerToMainMessage({
      type: "completed",
      jobId: "job-1",
      summary: {
        comparedFiles: 2,
        changedFiles: 3,
        outputWorkbookPath: "C:/output/report.xlsx",
        outputPathTestWorkbookPath: "C:/output/path-test-report.xlsx",
        outputChangeListPath: "C:/output/changes.docx",
        workDirectory: "C:/temp/job-1"
      }
    })).toBe(true);
    expect(isWorkerToMainMessage({ type: "cancelled", jobId: "job-1" })).toBe(true);
    expect(isWorkerToMainMessage({
      type: "failed",
      jobId: "job-1",
      error: {
        name: "Error",
        message: "failed",
        stack: "stack",
        phase: "workbook"
      }
    })).toBe(true);
  });

  it("rejects malformed worker messages", () => {
    expect(isWorkerToMainMessage({ type: "progress", jobId: "job-1", progress: null })).toBe(false);
    expect(isWorkerToMainMessage({ type: "completed", jobId: "job-1", summary: {} })).toBe(false);
    expect(isWorkerToMainMessage({ type: "cancelled", jobId: "" })).toBe(false);
    expect(isWorkerToMainMessage({
      type: "failed",
      jobId: "job-1",
      error: { name: "Error", message: 42 }
    })).toBe(false);
  });
});
