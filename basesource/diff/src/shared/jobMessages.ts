import type {
  GenerateDiffWorkbookSummary,
  ReportProgress
} from "../core/reportJob";
import type { StartJobRequest } from "./ipcTypes";

export type WorkerJobRequest = StartJobRequest & {
  workDirectory: string;
};

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  phase?: string;
}

export type JobResult =
  | { status: "completed"; summary: GenerateDiffWorkbookSummary }
  | { status: "cancelled" };

export type MainToWorkerMessage =
  | { type: "start"; jobId: string; request: WorkerJobRequest }
  | { type: "cancel"; jobId: string };

export type WorkerToMainMessage =
  | { type: "ready" }
  | { type: "progress"; jobId: string; progress: ReportProgress }
  | { type: "completed"; jobId: string; summary: GenerateDiffWorkbookSummary }
  | { type: "cancelled"; jobId: string }
  | { type: "failed"; jobId: string; error: SerializedError };

export function isMainToWorkerMessage(value: unknown): value is MainToWorkerMessage {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  if (value.type === "cancel") {
    return isJobId(value.jobId);
  }

  return value.type === "start"
    && isJobId(value.jobId)
    && isWorkerJobRequest(value.request);
}

export function isWorkerToMainMessage(value: unknown): value is WorkerToMainMessage {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  if (value.type === "ready") {
    return true;
  }

  if (!isJobId(value.jobId)) {
    return false;
  }

  switch (value.type) {
    case "progress":
      return isReportProgress(value.progress);
    case "completed":
      return isGenerateDiffWorkbookSummary(value.summary);
    case "cancelled":
      return true;
    case "failed":
      return isSerializedError(value.error);
    default:
      return false;
  }
}

function isWorkerJobRequest(value: unknown): value is WorkerJobRequest {
  return isRecord(value)
    && isDiffSource(value.source)
    && isNonEmptyString(value.winMergePath)
    && isNonEmptyString(value.outputWorkbookPath)
    && isNonEmptyString(value.outputPathTestWorkbookPath)
    && isNonEmptyString(value.outputChangeListPath)
    && isNonEmptyString(value.workDirectory)
    && isRowOutput(value.rowOutput);
}

function isDiffSource(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if (value.kind === "folders") {
    return isNonEmptyString(value.leftRoot) && isNonEmptyString(value.rightRoot);
  }

  return value.kind === "bazaar"
    && isNonEmptyString(value.repositoryPath)
    && isNonEmptyString(value.leftRevision)
    && isNonEmptyString(value.rightRevision)
    && isNonEmptyString(value.bazaarPath);
}

function isRowOutput(value: unknown): boolean {
  return isRecord(value)
    && isRowOutputPolicy(value.cFiles)
    && isRowOutputPolicy(value.otherTextFiles);
}

function isRowOutputPolicy(value: unknown): boolean {
  return isRecord(value)
    && Number.isInteger(value.contextRows)
    && Number(value.contextRows) >= 0
    && typeof value.hideRetainedRows === "boolean";
}

function isReportProgress(value: unknown): value is ReportProgress {
  return isRecord(value)
    && isNonEmptyString(value.phase)
    && typeof value.message === "string"
    && isNonNegativeFiniteNumber(value.completed)
    && isNonNegativeFiniteNumber(value.total);
}

function isGenerateDiffWorkbookSummary(value: unknown): value is GenerateDiffWorkbookSummary {
  return isRecord(value)
    && isNonNegativeFiniteNumber(value.comparedFiles)
    && isNonNegativeFiniteNumber(value.changedFiles)
    && isNonEmptyString(value.outputWorkbookPath)
    && isNonEmptyString(value.outputPathTestWorkbookPath)
    && isNonEmptyString(value.outputChangeListPath)
    && isNonEmptyString(value.workDirectory);
}

function isSerializedError(value: unknown): value is SerializedError {
  return isRecord(value)
    && isNonEmptyString(value.name)
    && typeof value.message === "string"
    && (value.stack === undefined || typeof value.stack === "string")
    && (value.phase === undefined || typeof value.phase === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJobId(value: unknown): value is string {
  return isNonEmptyString(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
