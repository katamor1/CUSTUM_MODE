import { describe, expect, it } from "vitest";
import { buildStartJobRequest } from "../../src/renderer/src/jobRequestValidation";
import { DEFAULT_APP_SETTINGS } from "../../src/shared/settings";

const baseForm = {
  settings: {
    ...DEFAULT_APP_SETTINGS,
    winMergePath: " C:/Tools/WinMergeU.exe ",
    bazaarPath: " brz "
  },
  leftFolder: " C:/before ",
  rightFolder: " C:/after ",
  repoPath: " C:/repo ",
  leftRevision: " 10 ",
  rightRevision: " 11 ",
  outputWorkbookPath: " C:/out/diff-report.xlsx ",
  outputPathTestWorkbookPath: " C:/out/path-test-report.xlsx ",
  outputChangeListPath: " C:/out/diff-change-list.docx "
};

describe("buildStartJobRequest", () => {
  it("normalizes whitespace before constructing a folder job request", () => {
    expect(buildStartJobRequest({ ...baseForm, mode: "folders" })).toMatchObject({
      winMergePath: "C:/Tools/WinMergeU.exe",
      outputWorkbookPath: "C:/out/diff-report.xlsx",
      outputPathTestWorkbookPath: "C:/out/path-test-report.xlsx",
      outputChangeListPath: "C:/out/diff-change-list.docx",
      source: {
        kind: "folders",
        leftRoot: "C:/before",
        rightRoot: "C:/after"
      }
    });
  });

  it("normalizes Bazaar request fields", () => {
    expect(buildStartJobRequest({ ...baseForm, mode: "bazaar" })).toMatchObject({
      winMergePath: "C:/Tools/WinMergeU.exe",
      source: {
        kind: "bazaar",
        repositoryPath: "C:/repo",
        leftRevision: "10",
        rightRevision: "11",
        bazaarPath: "brz"
      }
    });
  });

  it("rejects whitespace-only fields, duplicate aliases, and wrong output extensions", () => {
    expect(buildStartJobRequest({ ...baseForm, mode: "folders", leftFolder: "   " })).toBeUndefined();
    expect(buildStartJobRequest({
      ...baseForm,
      mode: "folders",
      outputPathTestWorkbookPath: "C:/out/sub/../diff-report.xlsx"
    })).toBeUndefined();
    expect(buildStartJobRequest({
      ...baseForm,
      mode: "folders",
      outputWorkbookPath: "C:/out/report.docx"
    })).toBeUndefined();
    expect(buildStartJobRequest({
      ...baseForm,
      mode: "folders",
      outputChangeListPath: "C:/out/changes.xlsx"
    })).toBeUndefined();
  });
});
