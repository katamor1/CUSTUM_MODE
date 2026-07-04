import type { DiffSource, ReportProgress } from "../core/reportJob";
import type { JobResult } from "./jobMessages";
import type { AppSettings } from "./settings";

export type { AppSettings, RowOutputPolicy } from "./settings";

export interface StartJobRequest {
  source: DiffSource;
  winMergePath: string;
  outputWorkbookPath: string;
  outputPathTestWorkbookPath: string;
  outputChangeListPath: string;
  rowOutput: AppSettings["rowOutput"];
}

export interface DiffRepoApi {
  loadSettings: () => Promise<AppSettings>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  selectDirectory: () => Promise<string | null>;
  selectExecutable: (title: string) => Promise<string | null>;
  selectWorkbookOutput: () => Promise<string | null>;
  selectPathTestWorkbookOutput: () => Promise<string | null>;
  selectChangeListOutput: () => Promise<string | null>;
  isDirectory: (path: string) => Promise<boolean>;
  getDroppedFilePath: (file: File) => string;
  startJob: (request: StartJobRequest) => Promise<JobResult>;
  cancelJob: () => Promise<void>;
  onProgress: (callback: (progress: ReportProgress) => void) => () => void;
}

export function isStartJobRequest(value: unknown): value is StartJobRequest {
  const request = asRecord(value);
  return request !== undefined
    && isDiffSource(request.source)
    && isNonEmptyString(request.winMergePath)
    && isNonEmptyString(request.outputWorkbookPath)
    && isNonEmptyString(request.outputPathTestWorkbookPath)
    && isNonEmptyString(request.outputChangeListPath)
    && isRowOutput(request.rowOutput);
}

function isDiffSource(value: unknown): value is DiffSource {
  const source = asRecord(value);
  if (!source) {
    return false;
  }
  if (source.kind === "folders") {
    return isNonEmptyString(source.leftRoot) && isNonEmptyString(source.rightRoot);
  }
  return source.kind === "bazaar"
    && isNonEmptyString(source.repositoryPath)
    && isNonEmptyString(source.leftRevision)
    && isNonEmptyString(source.rightRevision)
    && isNonEmptyString(source.bazaarPath);
}

function isRowOutput(value: unknown): boolean {
  const rowOutput = asRecord(value);
  return rowOutput !== undefined
    && isRowOutputPolicy(rowOutput.cFiles)
    && isRowOutputPolicy(rowOutput.otherTextFiles);
}

function isRowOutputPolicy(value: unknown): boolean {
  const policy = asRecord(value);
  return policy !== undefined
    && typeof policy.contextRows === "number"
    && Number.isSafeInteger(policy.contextRows)
    && policy.contextRows >= 0
    && typeof policy.hideRetainedRows === "boolean";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
