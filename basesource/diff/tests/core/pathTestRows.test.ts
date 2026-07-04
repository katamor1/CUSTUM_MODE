import { describe, expect, it } from "vitest";
import { analyzeCPathChanges } from "../../src/core/cPathAnalysis";
import type { HtmlReportCell, HtmlReportRow } from "../../src/core/htmlReport";
import { selectPathTestRows } from "../../src/core/pathTestRows";

describe("selectPathTestRows", () => {
  it("keeps a complete modified function but marks only changed executable code", async () => {
    const beforeSource = [
      "int changed(int value)",
      "{",
      "    // old explanation",
      "    int total = value + 1;",
      "    if (total > 10) {",
      "        return 10;",
      "    }",
      "    return total;",
      "}",
      "",
      "int comment_only(int value)",
      "{",
      "    // before",
      "    return value;",
      "}"
    ].join("\n");
    const afterSource = [
      "int changed(int value)",
      "{",
      "    // new explanation",
      "    int total = value + 2;",
      "    if (total > 20) {",
      "        return 10;",
      "    }",
      "    return total;",
      "}",
      "",
      "int comment_only(int value)",
      "{",
      "    // after",
      "    return value;",
      "}"
    ].join("\n");
    const plan = await analyzeCPathChanges({
      status: "modified",
      beforeSource,
      afterSource
    });
    const rows = makeReportRows(beforeSource, afterSource, new Set([3, 4, 5, 13]));

    const selected = selectPathTestRows(rows, plan);

    expect(selected).toBeDefined();
    expect(selected?.rows).toHaveLength(10);
    expect(selected?.rows[0]).toEqual(expect.objectContaining({
      sourceRowNumber: 1,
      reviewMarker: false
    }));
    expect(selected?.rows.slice(1).map((row) => row.afterLineNumber)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9
    ]);
    expect(selected?.rows.filter((row) => row.reviewMarker).map((row) => row.afterLineNumber)).toEqual([
      4, 5
    ]);
    expect(selected?.rows.filter((row) => row.reviewMarker).map((row) => row.reviewReason)).toEqual([
      "changed-executable", "changed-branch"
    ]);
    expect(selected?.rows.find((row) => row.afterLineNumber === 3)?.reviewMarker).toBe(false);
    expect(selected?.rows.some((row) => row.afterLineNumber === 13)).toBe(false);
  });

  it("uses C line facts instead of raw diff coloring for E-column marker reasons", async () => {
    const beforeSource = [
      "int changed(int value)",
      "{",
      "    int total = value + 1;",
      "    if (total > 10) {",
      "        return total;",
      "    }",
      "    return 0;",
      "}"
    ].join("\n");
    const afterSource = [
      "int changed(int value)",
      "{",
      "    int total = value + 2;",
      "    if (total > 20) {",
      "        return total;",
      "    }",
      "    return 0;",
      "}"
    ].join("\n");
    const plan = await analyzeCPathChanges({
      status: "modified",
      beforeSource,
      afterSource
    });
    const rows = makeReportRows(beforeSource, afterSource, new Set([3, 4, 5]));

    const selected = selectPathTestRows(rows, plan);

    expect(selected?.rows.filter((row) => row.reviewMarker).map((row) => ({
      line: row.afterLineNumber,
      reason: row.reviewReason
    }))).toEqual([
      { line: 3, reason: "changed-executable" },
      { line: 4, reason: "changed-branch" }
    ]);
    expect(selected?.rows.find((row) => row.afterLineNumber === 5)?.reviewMarker).toBe(false);
  });

  it("moves a deleted-only change marker to the next executable after-side row", async () => {
    const beforeSource = [
      "int changed(int value)",
      "{",
      "    value += 1;",
      "    value += 2;",
      "    return value;",
      "}"
    ].join("\n");
    const afterSource = [
      "int changed(int value)",
      "{",
      "    value += 2;",
      "    return value;",
      "}"
    ].join("\n");
    const plan = await analyzeCPathChanges({
      status: "modified",
      beforeSource,
      afterSource
    });
    const rows: HtmlReportRow[] = [
      headerRow(),
      codeRow(1, "int changed(int value)", 1, "int changed(int value)"),
      codeRow(2, "{", 2, "{"),
      codeRow(3, "    value += 1;", undefined, "", true),
      codeRow(4, "    value += 2;", 3, "    value += 2;"),
      codeRow(5, "    return value;", 4, "    return value;"),
      codeRow(6, "}", 5, "}")
    ];

    const selected = selectPathTestRows(rows, plan);

    expect(selected?.rows.filter((row) => row.reviewMarker).map((row) => ({
      line: row.afterLineNumber,
      reason: row.reviewReason
    }))).toEqual([{ line: 3, reason: "deleted-code-fallback" }]);
  });

  it("handles deleted lines when before and after function line numbers are shifted", async () => {
    const beforeSource = [
      "int changed(int value)",
      "{",
      "    value += 1;",
      "    return value;",
      "}"
    ].join("\n");
    const afterSource = [
      "int inserted_global_1;",
      "int inserted_global_2;",
      "int inserted_global_3;",
      "int inserted_global_4;",
      "",
      "int changed(int value)",
      "{",
      "    return value;",
      "}"
    ].join("\n");
    const plan = await analyzeCPathChanges({
      status: "modified",
      beforeSource,
      afterSource
    });
    const rows: HtmlReportRow[] = [
      headerRow(),
      codeRow(undefined, "", 1, "int inserted_global_1;", true),
      codeRow(undefined, "", 2, "int inserted_global_2;", true),
      codeRow(undefined, "", 3, "int inserted_global_3;", true),
      codeRow(undefined, "", 4, "int inserted_global_4;", true),
      codeRow(undefined, "", 5, ""),
      codeRow(1, "int changed(int value)", 6, "int changed(int value)"),
      codeRow(2, "{", 7, "{"),
      codeRow(3, "    value += 1;", undefined, "", true),
      codeRow(4, "    return value;", 8, "    return value;"),
      codeRow(5, "}", 9, "}")
    ];

    const selected = selectPathTestRows(rows, plan);

    expect(selected?.rows.filter((row) => row.reviewMarker).map((row) => ({
      line: row.afterLineNumber,
      reason: row.reviewReason
    }))).toEqual([{ line: 8, reason: "deleted-code-fallback" }]);
  });

  it("uses only structural marker lines for an added function and keeps comments unmarked", async () => {
    const afterSource = [
      "int added(int value)",
      "{",
      "    // branch explanation",
      "    if (value > 0) {",
      "        value++;",
      "    } else {",
      "        value--;",
      "    }",
      "    return value;",
      "}"
    ].join("\n");
    const plan = await analyzeCPathChanges({
      status: "added",
      afterSource
    });
    const rows = makeReportRows("", afterSource, new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));

    const selected = selectPathTestRows(rows, plan);

    expect(selected?.rows.filter((row) => row.reviewMarker).map((row) => row.afterLineNumber)).toEqual([
      2, 4, 6
    ]);
    expect(selected?.rows.filter((row) => row.reviewMarker).map((row) => row.reviewReason)).toEqual([
      "function-entry", "added-branch", "added-branch"
    ]);
    expect(selected?.rows.find((row) => row.afterLineNumber === 3)?.reviewMarker).toBe(false);
    expect(selected?.rows.find((row) => row.afterLineNumber === 5)?.reviewMarker).toBe(false);
  });

  it("clears an unrelated deleted function that WinMerge aligns with an added function", async () => {
    const beforeSource = [
      "int deleted_function(int value)",
      "{",
      "    return value + 1;",
      "}"
    ].join("\n");
    const afterSource = [
      "int added_function(int value)",
      "{",
      "    if (value > 0) {",
      "        return value;",
      "    }",
      "    return 0;",
      "}"
    ].join("\n");
    const plan = await analyzeCPathChanges({
      status: "modified",
      beforeSource,
      afterSource
    });
    const rows: HtmlReportRow[] = [
      headerRow(),
      codeRow(1, "int deleted_function(int value)", 1, "int added_function(int value)", true),
      codeRow(2, "{", 2, "{", true),
      codeRow(3, "    return value + 1;", 3, "    if (value > 0) {", true),
      codeRow(4, "}", 4, "        return value;", true),
      codeRow(undefined, "", 5, "    }", true),
      codeRow(undefined, "", 6, "    return 0;", true),
      codeRow(undefined, "", 7, "}", true)
    ];

    const selected = selectPathTestRows(rows, plan);

    expect(selected?.rows.slice(1).map((row) => row.cells[0].text)).toEqual([
      "", "", "", "", "", "", ""
    ]);
    expect(selected?.rows.slice(1).map((row) => row.cells[1].text)).toEqual([
      "", "", "", "", "", "", ""
    ]);
    expect(selected?.rows.filter((row) => row.reviewMarker).map((row) => row.afterLineNumber)).toEqual([
      2, 3
    ]);
    expect(selected?.rows.filter((row) => row.reviewMarker).map((row) => row.reviewReason)).toEqual([
      "function-entry", "added-branch"
    ]);
  });

  it("returns undefined when every changed function has no review marker", async () => {
    const beforeSource = [
      "int comment_only(void)",
      "{",
      "    // before",
      "    return 1;",
      "}"
    ].join("\n");
    const afterSource = [
      "int comment_only(void)",
      "{",
      "    // after",
      "    return 1;",
      "}"
    ].join("\n");
    const plan = await analyzeCPathChanges({
      status: "modified",
      beforeSource,
      afterSource
    });

    expect(selectPathTestRows(
      makeReportRows(beforeSource, afterSource, new Set([3])),
      plan
    )).toBeUndefined();
  });
});

function makeReportRows(
  beforeSource: string,
  afterSource: string,
  diffLines: Set<number>
): HtmlReportRow[] {
  const beforeLines = beforeSource.length > 0 ? beforeSource.split(/\r?\n/) : [];
  const afterLines = afterSource.length > 0 ? afterSource.split(/\r?\n/) : [];
  const length = Math.max(beforeLines.length, afterLines.length);
  return [
    headerRow(),
    ...Array.from({ length }, (_, index) => codeRow(
      beforeLines[index] === undefined ? undefined : index + 1,
      beforeLines[index] ?? "",
      afterLines[index] === undefined ? undefined : index + 1,
      afterLines[index] ?? "",
      diffLines.has(index + 1)
    ))
  ];
}

function headerRow(): HtmlReportRow {
  return {
    cells: [
      { text: "【変更前】$/src/sample.c", colspan: 2, backgroundColor: "0000FF" },
      { text: "【変更後】$/src/sample.c", colspan: 2, backgroundColor: "0000FF" }
    ]
  };
}

function codeRow(
  beforeLine: number | undefined,
  beforeText: string,
  afterLine: number | undefined,
  afterText: string,
  isDiff = false
): HtmlReportRow {
  return {
    cells: [
      lineNumberCell(beforeLine),
      sourceCell(beforeText, isDiff),
      lineNumberCell(afterLine),
      sourceCell(afterText, isDiff)
    ]
  };
}

function lineNumberCell(value: number | undefined): HtmlReportCell {
  return { text: value === undefined ? "" : String(value), backgroundColor: "F0F0F0" };
}

function sourceCell(value: string, isDiff: boolean): HtmlReportCell {
  return { text: value, backgroundColor: isDiff ? "FFD700" : "FFFFFF" };
}
