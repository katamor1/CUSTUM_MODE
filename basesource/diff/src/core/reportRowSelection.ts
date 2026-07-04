import type { RowOutputPolicy } from "../shared/settings";
import type { HtmlReportCell, HtmlReportRow } from "./htmlReport";

const SOURCE_COLUMNS = [1, 3];
const PLAIN_BACKGROUNDS = new Set(["FFFFFF"]);
const FUNCTION_KEYWORDS = new Set(["if", "for", "while", "switch", "catch"]);

export type ReportRowVisibility = "structure" | "visible" | "retained";

export interface SelectedReportRow extends HtmlReportRow {
  sourceRowNumber: number;
  visibility: ReportRowVisibility;
}

interface CodeReportRow {
  sourceRowNumber: number;
  representativeText: string;
  isDiff: boolean;
  isUnchangedBlank: boolean;
}

interface FunctionRange {
  startIndex: number;
  endIndex: number;
  hasDiff: boolean;
}

interface CommentState {
  inBlockComment: boolean;
}

export function selectReportRows(
  relativePath: string,
  rows: HtmlReportRow[],
  policy: RowOutputPolicy
): SelectedReportRow[] {
  const codeRows = extractCodeRows(rows);
  const visibleIndexes = new Set<number>();

  if (isCSource(relativePath)) {
    markCSourceVisibility(codeRows, visibleIndexes, policy.contextRows);
  } else {
    markBlankLineContexts(codeRows, diffRowIndexes(codeRows), visibleIndexes, policy.contextRows);
  }

  const retainedIndexes = expandIndexes(visibleIndexes, codeRows.length, policy.contextRows);
  const codeIndexBySourceRow = new Map(codeRows.map((row, index) => [row.sourceRowNumber, index]));

  return rows.flatMap<SelectedReportRow>((row, index) => {
    const sourceRowNumber = index + 1;
    const codeIndex = codeIndexBySourceRow.get(sourceRowNumber);
    if (codeIndex === undefined) {
      return [{ ...row, sourceRowNumber, visibility: "structure" }];
    }
    if (visibleIndexes.has(codeIndex)) {
      return [{ ...row, sourceRowNumber, visibility: "visible" }];
    }
    if (retainedIndexes.has(codeIndex)) {
      return [{ ...row, sourceRowNumber, visibility: "retained" }];
    }
    return [];
  });
}

function markCSourceVisibility(
  codeRows: CodeReportRow[],
  visibleIndexes: Set<number>,
  contextRows: number
): void {
  const functionRanges = findFunctionRanges(codeRows);
  const functionIndexes = new Set<number>();

  for (const range of functionRanges) {
    for (let index = range.startIndex; index <= range.endIndex; index += 1) {
      functionIndexes.add(index);
      if (range.hasDiff) {
        visibleIndexes.add(index);
      }
    }
  }

  const outsideFunctionDiffs = diffRowIndexes(codeRows).filter((index) => !functionIndexes.has(index));
  markBlankLineContexts(codeRows, outsideFunctionDiffs, visibleIndexes, contextRows, functionIndexes);
}

function markBlankLineContexts(
  codeRows: CodeReportRow[],
  seedIndexes: number[],
  visibleIndexes: Set<number>,
  contextRows: number,
  blockedIndexes = new Set<number>()
): void {
  if (seedIndexes.length === 0) {
    return;
  }

  const previousBlank = new Array<number | undefined>(codeRows.length);
  const nextBlank = new Array<number | undefined>(codeRows.length);
  const segmentStart = new Array<number>(codeRows.length);
  const segmentEnd = new Array<number>(codeRows.length);
  let lastBlank: number | undefined;
  let currentSegmentStart = 0;

  for (let index = 0; index < codeRows.length; index += 1) {
    if (blockedIndexes.has(index)) {
      lastBlank = undefined;
      currentSegmentStart = index + 1;
      continue;
    }
    previousBlank[index] = lastBlank;
    segmentStart[index] = currentSegmentStart;
    if (codeRows[index].isUnchangedBlank) {
      lastBlank = index;
    }
  }

  lastBlank = undefined;
  let currentSegmentEnd = codeRows.length - 1;
  for (let index = codeRows.length - 1; index >= 0; index -= 1) {
    if (blockedIndexes.has(index)) {
      lastBlank = undefined;
      currentSegmentEnd = index - 1;
      continue;
    }
    nextBlank[index] = lastBlank;
    segmentEnd[index] = currentSegmentEnd;
    if (codeRows[index].isUnchangedBlank) {
      lastBlank = index;
    }
  }

  const intervals = seedIndexes
    .filter((seedIndex) => !blockedIndexes.has(seedIndex))
    .map((seedIndex) => ({
      start: previousBlank[seedIndex] === undefined
        ? segmentStart[seedIndex]
        : Math.max(segmentStart[seedIndex], previousBlank[seedIndex] - contextRows),
      end: nextBlank[seedIndex] === undefined
        ? segmentEnd[seedIndex]
        : Math.min(segmentEnd[seedIndex], nextBlank[seedIndex] + contextRows)
    }))
    .sort((left, right) => left.start - right.start);

  let mergedStart: number | undefined;
  let mergedEnd = -1;
  for (const interval of intervals) {
    if (mergedStart === undefined) {
      mergedStart = interval.start;
      mergedEnd = interval.end;
      continue;
    }
    if (interval.start <= mergedEnd + 1) {
      mergedEnd = Math.max(mergedEnd, interval.end);
      continue;
    }
    addRange(visibleIndexes, mergedStart, mergedEnd);
    mergedStart = interval.start;
    mergedEnd = interval.end;
  }
  if (mergedStart !== undefined) {
    addRange(visibleIndexes, mergedStart, mergedEnd);
  }
}

function expandIndexes(indexes: Set<number>, length: number, contextRows: number): Set<number> {
  const expanded = new Set<number>();
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < length; index += 1) {
    distance = indexes.has(index) ? 0 : distance + 1;
    if (!indexes.has(index) && distance <= contextRows) {
      expanded.add(index);
    }
  }

  distance = Number.POSITIVE_INFINITY;
  for (let index = length - 1; index >= 0; index -= 1) {
    distance = indexes.has(index) ? 0 : distance + 1;
    if (!indexes.has(index) && distance <= contextRows) {
      expanded.add(index);
    }
  }
  return expanded;
}

function addRange(target: Set<number>, start: number, end: number): void {
  for (let index = start; index <= end; index += 1) {
    target.add(index);
  }
}

function diffRowIndexes(codeRows: CodeReportRow[]): number[] {
  return codeRows.flatMap((row, index) => row.isDiff ? [index] : []);
}

function findFunctionRanges(codeRows: CodeReportRow[]): FunctionRange[] {
  const ranges: FunctionRange[] = [];
  const commentState: CommentState = { inBlockComment: false };
  let braceDepth = 0;
  let candidateStartIndex: number | undefined;
  let activeFunctionStartIndex: number | undefined;

  for (const [index, row] of codeRows.entries()) {
    const code = stripCommentsAndStrings(row.representativeText, commentState);
    const trimmed = code.trim();
    const topLevelBeforeLine = braceDepth === 0;

    if (topLevelBeforeLine && activeFunctionStartIndex === undefined) {
      if (isTopLevelBoundary(trimmed)) {
        candidateStartIndex = undefined;
      } else if (candidateStartIndex === undefined && trimmed.length > 0) {
        candidateStartIndex = index;
      }

      if (code.includes("{") && looksLikeFunctionHeader(codeRows, candidateStartIndex ?? index, index)) {
        activeFunctionStartIndex = candidateStartIndex ?? index;
      }
    }

    braceDepth += braceDelta(code);
    if (braceDepth < 0) {
      braceDepth = 0;
    }

    if (activeFunctionStartIndex !== undefined && braceDepth === 0) {
      ranges.push({
        startIndex: activeFunctionStartIndex,
        endIndex: index,
        hasDiff: codeRows.slice(activeFunctionStartIndex, index + 1).some((functionRow) => functionRow.isDiff)
      });
      activeFunctionStartIndex = undefined;
      candidateStartIndex = undefined;
    }

    if (braceDepth === 0 && activeFunctionStartIndex === undefined && isTopLevelBoundary(trimmed)) {
      candidateStartIndex = undefined;
    }
  }

  return ranges;
}

function looksLikeFunctionHeader(codeRows: CodeReportRow[], startIndex: number, braceLineIndex: number): boolean {
  const signature = codeRows
    .slice(startIndex, braceLineIndex + 1)
    .map((row) => row.representativeText.trim())
    .join(" ");
  const beforeBrace = signature.slice(0, signature.indexOf("{")).trim();
  if (!beforeBrace.includes("(") || !beforeBrace.includes(")") || beforeBrace.includes("=") || beforeBrace.includes(";")) {
    return false;
  }

  const nameMatch = beforeBrace.match(/([A-Za-z_]\w*)\s*\([^;{}]*\)\s*$/);
  return nameMatch !== null && !FUNCTION_KEYWORDS.has(nameMatch[1]);
}

function isTopLevelBoundary(trimmedCode: string): boolean {
  return trimmedCode.length === 0
    || trimmedCode.startsWith("#")
    || trimmedCode.endsWith(";")
    || trimmedCode.startsWith("typedef ")
    || trimmedCode.startsWith("struct ")
    || trimmedCode.startsWith("enum ")
    || trimmedCode.startsWith("union ");
}

function braceDelta(code: string): number {
  let delta = 0;
  for (const char of code) {
    if (char === "{") {
      delta += 1;
    } else if (char === "}") {
      delta -= 1;
    }
  }
  return delta;
}

function stripCommentsAndStrings(line: string, state: CommentState): string {
  let output = "";
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (state.inBlockComment) {
      if (char === "*" && next === "/") {
        state.inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (char === "/" && next === "/") {
      break;
    }
    if (char === "/" && next === "*") {
      state.inBlockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      output += " ";
      index += 1;
      while (index < line.length) {
        if (line[index] === "\\") {
          index += 2;
          continue;
        }
        if (line[index] === quote) {
          break;
        }
        index += 1;
      }
      continue;
    }
    output += char;
  }
  return output;
}

function extractCodeRows(rows: HtmlReportRow[]): CodeReportRow[] {
  return rows.flatMap((row, index) => {
    const cells = expandCells(row.cells);
    const beforeLineNumber = parseLineNumber(cells[0]?.text);
    const afterLineNumber = parseLineNumber(cells[2]?.text);
    if (beforeLineNumber === undefined && afterLineNumber === undefined) {
      return [];
    }

    const beforeText = cells[1]?.text ?? "";
    const afterText = cells[3]?.text ?? "";
    const representativeText = afterText.trim().length > 0 ? afterText : beforeText;
    const isDiff = SOURCE_COLUMNS.some((columnIndex) => isDiffSourceCell(cells[columnIndex]));
    return [{
      sourceRowNumber: index + 1,
      representativeText,
      isDiff,
      isUnchangedBlank: !isDiff && beforeText.trim().length === 0 && afterText.trim().length === 0
    }];
  });
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
  return trimmed && /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : undefined;
}

function isDiffSourceCell(cell: HtmlReportCell | undefined): boolean {
  return cell !== undefined && (
    isDiffBackground(cell.backgroundColor)
    || (cell.richText ?? []).some((run) => isDiffBackground(run.backgroundColor))
  );
}

function isDiffBackground(color: string | undefined): boolean {
  return color !== undefined && !PLAIN_BACKGROUNDS.has(color);
}

function isCSource(relativePath: string): boolean {
  return relativePath.replaceAll("\\", "/").toLowerCase().endsWith(".c");
}
