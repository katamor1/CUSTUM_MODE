import { describe, expect, it } from "vitest";
import { isStartJobRequest } from "../../src/shared/ipcTypes";
import { DEFAULT_APP_SETTINGS } from "../../src/shared/settings";

const validRequest = {
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

describe("isStartJobRequest", () => {
  it("accepts valid folder and Bazaar requests", () => {
    expect(isStartJobRequest(validRequest)).toBe(true);
    expect(isStartJobRequest({
      ...validRequest,
      source: {
        kind: "bazaar",
        repositoryPath: "C:/repo",
        leftRevision: "10",
        rightRevision: "11",
        bazaarPath: "brz"
      }
    })).toBe(true);
  });

  it("rejects malformed renderer IPC payloads before a worker job is created", () => {
    expect(isStartJobRequest({ ...validRequest, rowOutput: { cFiles: { contextRows: -1 } } })).toBe(false);
    expect(isStartJobRequest({ ...validRequest, outputWorkbookPath: "" })).toBe(false);
    expect(isStartJobRequest({ ...validRequest, outputWorkbookPath: "   " })).toBe(false);
    expect(isStartJobRequest({ ...validRequest, source: { kind: "folders", leftRoot: "", rightRoot: "C:/after" } })).toBe(false);
    expect(isStartJobRequest({ ...validRequest, source: { kind: "folders", leftRoot: "C:/before", rightRoot: "\t" } })).toBe(false);
    expect(isStartJobRequest({ ...validRequest, rowOutput: {
      cFiles: { contextRows: Number.MAX_SAFE_INTEGER + 1, hideRetainedRows: true },
      otherTextFiles: DEFAULT_APP_SETTINGS.rowOutput.otherTextFiles
    } })).toBe(false);
  });
});
