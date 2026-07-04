import { describe, expect, it } from "vitest";
import { buildBazaarExportArgs } from "../../src/core/bazaar";
import { buildWinMergeReportArgs } from "../../src/core/winmergeCommand";

describe("buildWinMergeReportArgs", () => {
  it("builds non-interactive report generation arguments", () => {
    expect(buildWinMergeReportArgs("C:/left/a.txt", "C:/right/a.txt", "C:/out/a.html")).toEqual([
      "/noninteractive",
      "/minimize",
      "/u",
      "C:/left/a.txt",
      "C:/right/a.txt",
      "/or",
      "C:/out/a.html"
    ]);
  });
});

describe("buildBazaarExportArgs", () => {
  it("builds revision export arguments", () => {
    expect(buildBazaarExportArgs("C:/repo", "123", "C:/tmp/rev123")).toEqual([
      "--no-aliases",
      "export",
      "-r",
      "123",
      "C:/tmp/rev123",
      "C:/repo"
    ]);
  });
});
