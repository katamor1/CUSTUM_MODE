import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import type { HtmlReportRow } from "../../src/core/htmlReport";
import { selectReportRows } from "../../src/core/reportRowSelection";

describe("selectReportRows", () => {
  it("keeps structure rows, visible blank-line context, and an outer retained range", () => {
    const rows = reportRows([
      line("far before"),
      line("retained before"),
      line(""),
      line("near before"),
      line("old target", "new target", true),
      line("near after"),
      line(""),
      line("retained after"),
      line("far after")
    ]);

    expect(summary(selectReportRows("notes/sample.txt", rows, policy(1)))).toEqual([
      [1, "structure"],
      [2, "retained"],
      [3, "visible"],
      [4, "visible"],
      [5, "visible"],
      [6, "visible"],
      [7, "visible"],
      [8, "visible"],
      [9, "visible"],
      [10, "retained"]
    ]);
  });

  it("does not add post-blank or retained rows when contextRows is zero", () => {
    const rows = reportRows([
      line("far before"),
      line(""),
      line("near before"),
      line("old target", "new target", true),
      line("near after"),
      line(""),
      line("far after")
    ]);

    expect(summary(selectReportRows("include/sample.H", rows, policy(0)))).toEqual([
      [1, "structure"],
      [3, "visible"],
      [4, "visible"],
      [5, "visible"],
      [6, "visible"],
      [7, "visible"]
    ]);
  });

  it("merges overlapping visible and retained ranges without changing original row numbers", () => {
    const rows = reportRows([
      line("before"),
      line(""),
      line("old first", "new first", true),
      line("between"),
      line("old second", "new second", true),
      line(""),
      line("after")
    ]);

    expect(summary(selectReportRows("README.md", rows, policy(1)))).toEqual([
      [1, "structure"],
      [2, "visible"],
      [3, "visible"],
      [4, "visible"],
      [5, "visible"],
      [6, "visible"],
      [7, "visible"],
      [8, "visible"]
    ]);
  });

  it("shows a changed C function and retains adjacent rows across function boundaries", () => {
    const rows = reportRows([
      line("static int unchanged(void)"),
      line("{"),
      line("    return 1;"),
      line("}"),
      line(""),
      line("int changed(void)"),
      line("{"),
      line("    return 10;", "    return 20;", true),
      line("}"),
      line(""),
      line("static int trailing(void)"),
      line("{"),
      line("    return 3;"),
      line("}")
    ]);

    expect(summary(selectReportRows("src/sample.c", rows, policy(2)))).toEqual([
      [1, "structure"],
      [5, "retained"],
      [6, "retained"],
      [7, "visible"],
      [8, "visible"],
      [9, "visible"],
      [10, "visible"],
      [11, "retained"],
      [12, "retained"]
    ]);
  });

  it("does not apply C function parsing to other text files", () => {
    const rows = reportRows([
      line("function unchanged()"),
      line("{"),
      line("  return 1"),
      line("}"),
      line(""),
      line("function changed()"),
      line("{"),
      line("  return 10", "  return 20", true),
      line("}"),
      line("")
    ]);

    expect(summary(selectReportRows("scripts/sample.TXT", rows, policy(0)))).toEqual([
      [1, "structure"],
      [6, "visible"],
      [7, "visible"],
      [8, "visible"],
      [9, "visible"],
      [10, "visible"],
      [11, "visible"]
    ]);
  });

  it("treats WinMerge-colored added and deleted rows as visible differences", () => {
    const rows: HtmlReportRow[] = [
      { cells: [{ text: "left" }, { text: "right" }] },
      dataRow(undefined, "added", true, 1),
      dataRow(1, "deleted", true, undefined)
    ];

    expect(summary(selectReportRows("sample.cfg", rows, policy(0)))).toEqual([
      [1, "structure"],
      [2, "visible"],
      [3, "visible"]
    ]);
  });

  it("classifies large all-diff files without rescanning from every changed row", () => {
    const rows = reportRows(Array.from({ length: 5000 }, (_, index) =>
      line(`old ${index}`, `new ${index}`, true)
    ));

    const startedAt = performance.now();
    const selected = selectReportRows("generated/new-file.txt", rows, policy(100));
    const elapsedMs = performance.now() - startedAt;

    expect(selected).toHaveLength(5001);
    expect(elapsedMs).toBeLessThan(1000);
  });
});

function policy(contextRows: number): { contextRows: number; hideRetainedRows: boolean } {
  return { contextRows, hideRetainedRows: true };
}

function summary(rows: ReturnType<typeof selectReportRows>): Array<[number, string]> {
  return rows.map((row) => [row.sourceRowNumber, row.visibility]);
}

interface LineInput {
  before: string;
  after: string;
  diff: boolean;
}

function line(before: string, after = before, diff = false): LineInput {
  return { before, after, diff };
}

function reportRows(lines: LineInput[]): HtmlReportRow[] {
  return [
    { cells: [{ text: "left", colspan: 2 }, { text: "right", colspan: 2 }] },
    ...lines.map((value, index) => dataRow(index + 1, value.before, value.diff, index + 1, value.after))
  ];
}

function dataRow(
  beforeLineNumber: number | undefined,
  beforeText: string,
  diff: boolean,
  afterLineNumber: number | undefined,
  afterText = beforeText
): HtmlReportRow {
  const backgroundColor = diff ? "FFDDDD" : "FFFFFF";
  return {
    cells: [
      { text: beforeLineNumber?.toString() ?? "" },
      { text: beforeText, backgroundColor },
      { text: afterLineNumber?.toString() ?? "" },
      { text: afterText, backgroundColor }
    ]
  };
}
