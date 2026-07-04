import type {
  CPathFilePlan,
  CPathFunctionPlan,
  CPathReviewMarkerReason,
  CPathSourceLineFact,
  SourceLineRange
} from "./cPathAnalysis";
import type { HtmlReportCell, HtmlReportRow } from "./htmlReport";

const PLAIN_SOURCE_BACKGROUNDS = new Set(["FFFFFF"]);

export interface PathTestReportRow extends HtmlReportRow {
  sourceRowNumber: number;
  beforeLineNumber?: number;
  afterLineNumber?: number;
  reviewMarker: boolean;
  reviewReason?: CPathReviewMarkerReason;
}

export interface PathTestRowSelection {
  rows: PathTestReportRow[];
}

interface IndexedReportRow {
  index: number;
  row: HtmlReportRow;
  beforeLineNumber?: number;
  afterLineNumber?: number;
  beforeSourceCell?: HtmlReportCell;
  afterSourceCell?: HtmlReportCell;
}

export function selectPathTestRows(
  rows: HtmlReportRow[],
  plan: CPathFilePlan
): PathTestRowSelection | undefined {
  if (rows.length === 0 || plan.functions.length === 0) {
    return undefined;
  }

  const indexedRows = rows.map((row, index) => indexReportRow(row, index));
  const selectedIndexes = new Set<number>();
  const selectedRows = new Map<number, HtmlReportRow>();
  const markerReasons = new Map<number, CPathReviewMarkerReason>();

  for (const fn of plan.functions) {
    const functionRows = indexedRows.filter((row) => rowBelongsToFunction(row, fn));
    const functionMarkers = fn.status === "added"
      ? addedFunctionMarkerReasons(functionRows, fn)
      : modifiedFunctionMarkerReasons(functionRows, fn, plan);
    if (functionMarkers.size === 0) {
      continue;
    }

    for (const row of functionRows) {
      selectedIndexes.add(row.index);
      if (!selectedRows.has(row.index)) {
        selectedRows.set(row.index, sanitizeRowForFunction(row, fn));
      }
    }
    for (const [markerIndex, reason] of functionMarkers) {
      markerReasons.set(markerIndex, reason);
    }
  }

  if (markerReasons.size === 0) {
    return undefined;
  }

  selectedIndexes.add(0);
  return {
    rows: [...selectedIndexes]
      .sort((left, right) => left - right)
      .map((index) => {
        const indexed = indexedRows[index];
        return {
          ...(selectedRows.get(index) ?? indexed.row),
          sourceRowNumber: index + 1,
          beforeLineNumber: indexed.beforeLineNumber,
          afterLineNumber: indexed.afterLineNumber,
          reviewMarker: markerReasons.has(index),
          reviewReason: markerReasons.get(index)
        };
      })
  };
}

function sanitizeRowForFunction(
  row: IndexedReportRow,
  fn: CPathFunctionPlan
): HtmlReportRow {
  const cells = expandCells(row.row.cells).map((cell) => ({ ...cell }));
  if (!lineInRange(row.beforeLineNumber, fn.beforeRange)) {
    cells[0] = clearedCounterpartCell(cells[0]);
    cells[1] = clearedCounterpartCell(cells[1]);
  }
  if (!lineInRange(row.afterLineNumber, fn.afterRange)) {
    cells[2] = clearedCounterpartCell(cells[2]);
    cells[3] = clearedCounterpartCell(cells[3]);
  }
  return { cells };
}

function clearedCounterpartCell(cell: HtmlReportCell | undefined): HtmlReportCell {
  return {
    ...(cell ?? { text: "" }),
    text: "",
    richText: undefined,
    backgroundColor: "C0C0C0",
    fontColor: undefined,
    bold: undefined,
    italic: undefined
  };
}

function addedFunctionMarkerReasons(
  rows: IndexedReportRow[],
  fn: CPathFunctionPlan
): Map<number, CPathReviewMarkerReason> {
  const markers = new Map<number, CPathReviewMarkerReason>();
  const mappedLines = new Set<number>();
  const markerByLine = new Map(fn.newFunctionReviewMarkers.map((marker) => [marker.afterLine, marker]));
  for (const row of rows) {
    if (row.afterLineNumber === undefined) {
      continue;
    }
    const marker = markerByLine.get(row.afterLineNumber);
    if (marker && !fn.commentLines.has(row.afterLineNumber)) {
      markers.set(row.index, marker.reason);
      mappedLines.add(row.afterLineNumber);
    }
  }

  for (const marker of fn.newFunctionReviewMarkers) {
    if (!fn.commentLines.has(marker.afterLine) && !mappedLines.has(marker.afterLine)) {
      throw new Error(`パステスト行をWinMerge HTMLへ対応付けできません: ${fn.name}:${marker.afterLine}`);
    }
  }

  return markers;
}

function modifiedFunctionMarkerReasons(
  rows: IndexedReportRow[],
  fn: CPathFunctionPlan,
  plan: CPathFilePlan
): Map<number, CPathReviewMarkerReason> {
  const markers = new Map<number, CPathReviewMarkerReason>();
  const deletedDiffIndexes: number[] = [];

  for (const row of rows) {
    if (!isDiffSourceCell(row.beforeSourceCell) && !isDiffSourceCell(row.afterSourceCell)) {
      continue;
    }

    const beforeLine = row.beforeLineNumber;
    const afterLine = row.afterLineNumber;
    if (afterLine === undefined) {
      if (
        beforeLine !== undefined
        && isReviewableChangedLine(
          plan.beforeLineFacts.get(beforeLine),
          fn.beforeBodyStartLine ?? fn.beforeRange?.startLine ?? 1,
          beforeLine
        )
      ) {
        deletedDiffIndexes.push(row.index);
      }
      continue;
    }

    const reason = markerReasonForChangedAfterLine(
      plan.afterLineFacts.get(afterLine),
      fn.afterBodyStartLine,
      afterLine
    );
    if (!reason) {
      continue;
    }

    const beforeCode = beforeLine === undefined ? undefined : plan.beforeCodeByLine.get(beforeLine);
    const afterCode = plan.afterCodeByLine.get(afterLine);
    if (
      beforeLine !== undefined
      && normalizedLine(beforeCode) === normalizedLine(afterCode)
    ) {
      continue;
    }
    markers.set(row.index, reason);
  }

  for (const deletedIndex of deletedDiffIndexes) {
    const nextRow = rows.find((row) => (
      row.index > deletedIndex
      && row.afterLineNumber !== undefined
      && isReviewableChangedLine(
        plan.afterLineFacts.get(row.afterLineNumber),
        fn.afterBodyStartLine,
        row.afterLineNumber
      )
    ));
    if (nextRow) {
      markers.set(nextRow.index, "deleted-code-fallback");
      continue;
    }

    const bodyStartRow = rows.find((row) => row.afterLineNumber === fn.afterBodyStartLine);
    if (bodyStartRow) {
      markers.set(bodyStartRow.index, "deleted-code-fallback");
    }
  }

  return markers;
}

function markerReasonForChangedAfterLine(
  fact: CPathSourceLineFact | undefined,
  bodyStartLine: number,
  lineNumber: number
): CPathReviewMarkerReason | undefined {
  if (!isReviewableChangedLine(fact, bodyStartLine, lineNumber)) {
    return undefined;
  }
  return fact?.kind === "branch" || fact?.kind === "case"
    ? "changed-branch"
    : "changed-executable";
}

function indexReportRow(row: HtmlReportRow, index: number): IndexedReportRow {
  const cells = expandCells(row.cells);
  return {
    index,
    row,
    beforeLineNumber: parseLineNumber(cells[0]?.text),
    afterLineNumber: parseLineNumber(cells[2]?.text),
    beforeSourceCell: cells[1],
    afterSourceCell: cells[3]
  };
}

function rowBelongsToFunction(
  row: IndexedReportRow,
  fn: CPathFunctionPlan
): boolean {
  return lineInRange(row.afterLineNumber, fn.afterRange)
    || lineInRange(row.beforeLineNumber, fn.beforeRange);
}

function lineInRange(
  lineNumber: number | undefined,
  range: SourceLineRange | undefined
): boolean {
  return lineNumber !== undefined
    && range !== undefined
    && lineNumber >= range.startLine
    && lineNumber <= range.endLine;
}

function expandCells(cells: HtmlReportCell[]): HtmlReportCell[] {
  const expanded: HtmlReportCell[] = [];
  for (const cell of cells) {
    expanded.push(cell);
    for (let offset = 1; offset < (cell.colspan ?? 1); offset += 1) {
      expanded.push({ text: "" });
    }
  }
  return expanded;
}

function parseLineNumber(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  return trimmed && /^\d+$/.test(trimmed)
    ? Number.parseInt(trimmed, 10)
    : undefined;
}

function isDiffSourceCell(cell: HtmlReportCell | undefined): boolean {
  return cell !== undefined && (
    isDiffBackground(cell.backgroundColor)
    || (cell.richText ?? []).some((run) => isDiffBackground(run.backgroundColor))
  );
}

function isDiffBackground(color: string | undefined): boolean {
  return color !== undefined && !PLAIN_SOURCE_BACKGROUNDS.has(color);
}

function isReviewableChangedLine(
  fact: CPathSourceLineFact | undefined,
  bodyStartLine: number,
  lineNumber: number
): fact is CPathSourceLineFact {
  if (lineNumber < bodyStartLine) {
    return false;
  }
  return fact !== undefined
    && fact.normalizedCode.length > 0
    && fact.kind !== "blank"
    && fact.kind !== "comment"
    && fact.kind !== "brace"
    && fact.kind !== "declaration";
}

function normalizedLine(code: string | undefined): string {
  return (code ?? "").replace(/\s+/g, " ").trim();
}
