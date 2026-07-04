import { describe, expect, it } from "vitest";
import { areOutputPathsDistinct } from "../../src/renderer/src/outputPaths";

describe("areOutputPathsDistinct", () => {
  it("accepts three distinct output paths", () => {
    expect(areOutputPathsDistinct([
      "C:\\output\\diff-report.xlsx",
      "C:\\output\\path-test-report.xlsx",
      "C:\\output\\changes.docx"
    ])).toBe(true);
  });

  it("rejects case and separator variants of the same Windows path", () => {
    expect(areOutputPathsDistinct([
      "C:\\Output\\Report.xlsx",
      "c:/output/report.xlsx",
      "C:\\output\\changes.docx"
    ])).toBe(false);
  });

  it("rejects dot-segment aliases of the same output path", () => {
    expect(areOutputPathsDistinct([
      "C:\\output\\report.xlsx",
      "C:\\output\\sub\\..\\report.xlsx",
      "C:\\output\\changes.docx"
    ])).toBe(false);
  });
});
