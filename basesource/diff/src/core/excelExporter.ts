import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { analyzeCPathChanges } from "./cPathAnalysis";
import { parseHtmlReport, type HtmlReportCell, type HtmlReportTextRun } from "./htmlReport";
import { selectPathTestRows, type PathTestReportRow } from "./pathTestRows";
import { selectReportRows, type SelectedReportRow } from "./reportRowSelection";
import { readTextFile } from "./textDecoder";
import type { FilePairStatus } from "./types";
import type {
  ExportReportsWorkbookInput,
  PathReplacement
} from "./workbookTypes";
import type { RowOutputPolicy } from "../shared/settings";

const CODE_FONT_NAME = "MS Gothic";
const REVIEW_MARKER = "■OK □NG";
const EMPTY_COUNTERPART_NAME = "empty-counterpart.txt";
const BEFORE_FILE_MISSING_LABEL = "【変更前】ファイルなし";
const AFTER_FILE_MISSING_LABEL = "【変更後】ファイルなし";
const BEFORE_SOURCE_COLUMN = 2;
const AFTER_SOURCE_COLUMN = 4;

interface ParsedWorkbookReport {
  relativePath: string;
  worksheetName: string;
  status: FilePairStatus;
  html: string;
}

export async function exportReportsWorkbookFromHtmlFiles(input: ExportReportsWorkbookInput): Promise<void> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: input.outputPath,
    useStyles: true,
    useSharedStrings: false
  });

  workbook.creator = "DiffRepo Report Builder";
  workbook.created = new Date();
  workbook.modified = new Date();
  const pathTestWorkbook = input.pathTestOutputPath
    ? new ExcelJS.stream.xlsx.WorkbookWriter({
        filename: input.pathTestOutputPath,
        useStyles: true,
        useSharedStrings: false
      })
    : undefined;
  if (pathTestWorkbook) {
    pathTestWorkbook.creator = "DiffRepo Report Builder";
    pathTestWorkbook.created = new Date();
    pathTestWorkbook.modified = new Date();
  }
  let pathTestSheetCount = 0;

  for (const [reportIndex, report] of input.reports.entries()) {
    input.signal?.throwIfAborted();
    input.onProgress?.(reportIndex, input.reports.length, report.relativePath);
    const html = await readFile(report.htmlPath, "utf8");
    const parsedRows = parseHtmlReport(html, input.signal).rows;
    const reportRows = selectReportRows(
      report.relativePath,
      parsedRows,
      policyForReport(report.relativePath, input.rowOutput)
    );
    const columnWidths = computeColumnWidths(
      reportRows,
      input.pathReplacements ?? [],
      report.status
    );
    const worksheet = workbook.addWorksheet(report.worksheetName, {
      views: [{ state: "frozen", ySplit: 1 }]
    });
    addReportWorksheetRows(
      worksheet,
      reportRows,
      report.status,
      input.pathReplacements ?? [],
      true,
      policyForReport(report.relativePath, input.rowOutput),
      columnWidths,
      input.signal
    );
    worksheet.commit();

    if (pathTestWorkbook && isCSource(report.relativePath) && report.status !== "deleted") {
      const plan = await analyzeCPathChanges({
        status: report.status,
        relativePath: report.relativePath,
        beforeSource: await readOptionalSource(report.leftPath),
        afterSource: await readOptionalSource(report.rightPath)
      });
      const selected = selectPathTestRows(parsedRows, plan);
      if (selected) {
        const pathTestWorksheet = pathTestWorkbook.addWorksheet(report.worksheetName, {
          views: [{ state: "frozen", ySplit: 1 }]
        });
        addPathTestWorksheetRows(
          pathTestWorksheet,
          selected.rows,
          report.status,
          input.pathReplacements ?? [],
          columnWidths,
          input.signal
        );
        pathTestWorksheet.commit();
        pathTestSheetCount += 1;
      }
    }
  }

  input.signal?.throwIfAborted();
  await workbook.commit();
  input.signal?.throwIfAborted();
  if (pathTestWorkbook) {
    if (pathTestSheetCount === 0) {
      addNoPathTestTargetsWorksheet(pathTestWorkbook);
    }
    await pathTestWorkbook.commit();
    input.signal?.throwIfAborted();
  }
}

function applyHtmlCellStyle(excelCell: ExcelJS.Cell, htmlCell: HtmlReportCell): void {
  excelCell.border = thinBorder();
  excelCell.alignment = {
    wrapText: true,
    vertical: "top",
    horizontal: htmlCell.horizontalAlignment
  };

  if (htmlCell.backgroundColor) {
    excelCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: toArgb(htmlCell.backgroundColor) }
    };
  }

  if (!isRichTextCellValue(excelCell.value)) {
    excelCell.font = {
      name: CODE_FONT_NAME,
      color: htmlCell.fontColor ? { argb: toArgb(htmlCell.fontColor) } : undefined,
      bold: htmlCell.bold,
      italic: htmlCell.italic
    };
  }
}

type WritableWorksheet = ExcelJS.Worksheet & {
  commit?: () => void;
};

type WritableRow = ExcelJS.Row & {
  commit?: () => void;
};

function addReportWorksheetRows(
  worksheet: WritableWorksheet,
  reportRows: SelectedReportRow[],
  status: FilePairStatus,
  pathReplacements: PathReplacement[],
  commitRows: boolean,
  rowOutputPolicy: RowOutputPolicy,
  columnWidths: number[],
  signal?: AbortSignal
): void {
  columnWidths.forEach((width, index) => {
    worksheet.getColumn(index + 1).width = width;
  });

  if (reportRows.length === 0) {
    const worksheetRow = worksheet.addRow([]) as WritableRow;
    applyReviewMarkerToRow(worksheetRow);
    if (commitRows) {
      worksheetRow.commit?.();
    }
    return;
  }

  for (const [rowIndex, row] of reportRows.entries()) {
    if (rowIndex % 100 === 0) {
      signal?.throwIfAborted();
    }
    const expandedValues: ExcelJS.CellValue[] = [];
    for (const cell of row.cells) {
      expandedValues.push(cellValueForExcel(cell, pathReplacements, status));
      for (let offset = 1; offset < (cell.colspan ?? 1); offset += 1) {
        expandedValues.push("");
      }
    }

    const worksheetRow = worksheet.addRow(expandedValues) as WritableRow;
    worksheetRow.hidden = row.visibility === "retained" && rowOutputPolicy.hideRetainedRows;

    let columnIndex = 1;
    for (const cell of row.cells) {
      const colspan = cell.colspan ?? 1;
      for (let offset = 0; offset < colspan; offset += 1) {
        applyHtmlCellStyle(worksheetRow.getCell(columnIndex + offset), cell);
      }

      if (colspan > 1) {
        worksheet.mergeCells(worksheetRow.number, columnIndex, worksheetRow.number, columnIndex + colspan - 1);
      }
      columnIndex += colspan;
    }

    if (worksheetRow.number === 1) {
      applyReviewMarkerToRow(worksheetRow);
    }

    if (commitRows) {
      worksheetRow.commit?.();
    }
  }
}

function addPathTestWorksheetRows(
  worksheet: WritableWorksheet,
  rows: PathTestReportRow[],
  status: FilePairStatus,
  pathReplacements: PathReplacement[],
  columnWidths: number[],
  signal?: AbortSignal
): void {
  columnWidths.forEach((width, index) => {
    worksheet.getColumn(index + 1).width = width;
  });

  for (const [rowIndex, row] of rows.entries()) {
    if (rowIndex % 100 === 0) {
      signal?.throwIfAborted();
    }
    const expandedValues: ExcelJS.CellValue[] = [];
    for (const cell of row.cells) {
      expandedValues.push(cellValueForExcel(cell, pathReplacements, status));
      for (let offset = 1; offset < (cell.colspan ?? 1); offset += 1) {
        expandedValues.push("");
      }
    }

    const worksheetRow = worksheet.addRow(expandedValues) as WritableRow;
    let columnIndex = 1;
    for (const cell of row.cells) {
      const colspan = cell.colspan ?? 1;
      for (let offset = 0; offset < colspan; offset += 1) {
        applyHtmlCellStyle(worksheetRow.getCell(columnIndex + offset), cell);
      }
      if (colspan > 1) {
        worksheet.mergeCells(
          worksheetRow.number,
          columnIndex,
          worksheetRow.number,
          columnIndex + colspan - 1
        );
      }
      columnIndex += colspan;
    }

    if (row.reviewMarker) {
      applyReviewMarkerToRow(worksheetRow);
    }
    worksheetRow.commit?.();
  }
}

function addNoPathTestTargetsWorksheet(
  workbook: ExcelJS.stream.xlsx.WorkbookWriter
): void {
  const worksheet = workbook.addWorksheet("対象なし");
  const row = worksheet.addRow(["パステスト対象となる変更はありません。"]);
  const cell = row.getCell(1);
  cell.font = { name: CODE_FONT_NAME };
  cell.alignment = { vertical: "top", horizontal: "left" };
  worksheet.getColumn(1).width = 40;
  row.commit();
  worksheet.commit();
}

function computeColumnWidths(
  reportRows: SelectedReportRow[],
  pathReplacements: PathReplacement[],
  status: FilePairStatus
): number[] {
  const columnWidths: number[] = [];
  for (const row of reportRows) {
    let columnIndex = 1;
    for (const cell of row.cells) {
      const colspan = cell.colspan ?? 1;
      if (colspan === 1) {
        updateColumnWidth(columnWidths, columnIndex, rewriteReportText(cell.text, pathReplacements, status));
      }
      columnIndex += colspan;
    }
  }

  updateColumnWidth(columnWidths, 5, REVIEW_MARKER);
  syncMissingCounterpartContentColumnWidth(columnWidths, status);
  return columnWidths;
}

function policyForReport(
  relativePath: string,
  rowOutput: ExportReportsWorkbookInput["rowOutput"]
): RowOutputPolicy {
  const normalizedPath = relativePath.replaceAll("\\", "/").toLowerCase();
  return normalizedPath.endsWith(".c") || normalizedPath.endsWith(".h")
    ? rowOutput.cFiles
    : rowOutput.otherTextFiles;
}

function applyReviewMarkerToRow(worksheetRow: ExcelJS.Row): void {
  const reviewCell = worksheetRow.getCell(5);
  reviewCell.value = REVIEW_MARKER;
  applyReviewMarkerStyle(reviewCell);
}

function cellValueForExcel(cell: HtmlReportCell, pathReplacements: PathReplacement[], status: FilePairStatus): ExcelJS.CellValue {
  const rewrittenText = rewriteReportText(cell.text, pathReplacements, status);
  if (rewrittenText !== cell.text) {
    return rewrittenText;
  }

  if (cell.richText && cell.richText.length > 0) {
    return {
      richText: cell.richText.map(toExcelRichTextRun)
    };
  }

  return cell.text;
}

function toExcelRichTextRun(run: HtmlReportTextRun): ExcelJS.RichText {
  const font: Partial<ExcelJS.Font> = {
    name: CODE_FONT_NAME,
    color: run.fontColor ? { argb: toArgb(run.fontColor) } : undefined,
    bold: run.bold,
    italic: run.italic,
    underline: run.underline
  };

  return { text: run.text, font };
}

function isRichTextCellValue(value: ExcelJS.CellValue): value is ExcelJS.CellRichTextValue {
  return typeof value === "object" && value !== null && "richText" in value;
}

function applyReviewMarkerStyle(excelCell: ExcelJS.Cell): void {
  excelCell.font = { name: CODE_FONT_NAME, bold: true, color: { argb: "FF1F2937" } };
  excelCell.alignment = { vertical: "top", horizontal: "left" };
  excelCell.border = thinBorder();
  excelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
}

function updateColumnWidth(widths: number[], oneBasedColumnIndex: number, value: string): void {
  const current = widths[oneBasedColumnIndex - 1] ?? 4;
  widths[oneBasedColumnIndex - 1] = Math.max(current, estimateColumnWidth(value));
}

function syncMissingCounterpartContentColumnWidth(widths: number[], status: FilePairStatus): void {
  if (status === "added") {
    mirrorColumnWidth(widths, BEFORE_SOURCE_COLUMN, AFTER_SOURCE_COLUMN);
  }

  if (status === "deleted") {
    mirrorColumnWidth(widths, AFTER_SOURCE_COLUMN, BEFORE_SOURCE_COLUMN);
  }
}

function mirrorColumnWidth(widths: number[], targetColumn: number, sourceColumn: number): void {
  const sourceWidth = widths[sourceColumn - 1];
  if (sourceWidth !== undefined) {
    widths[targetColumn - 1] = sourceWidth;
  }
}

function estimateColumnWidth(value: string): number {
  const longestLineLength = value.split(/\r?\n/).reduce((maxLength, line) => Math.max(maxLength, [...line].length), 0);
  return Math.max(4, Math.min(80, longestLineLength + 2));
}

function rewritePathText(value: string, replacements: PathReplacement[]): string {
  for (const replacement of replacements) {
    const normalizedValue = value.replaceAll("\\", "/");
    const normalizedRoot = replacement.rootPath.replaceAll("\\", "/").replace(/\/+$/, "");
    const lowerValue = normalizedValue.toLowerCase();
    const lowerRoot = normalizedRoot.toLowerCase();
    let startIndex = 0;
    while (startIndex < lowerValue.length) {
      const index = lowerValue.indexOf(lowerRoot, startIndex);
      if (index === -1) {
        break;
      }
      if (hasPathBoundaries(normalizedValue, index, normalizedRoot.length)) {
        return `${normalizedValue.slice(0, index)}${replacement.label}${normalizedValue.slice(index + normalizedRoot.length)}`;
      }
      startIndex = index + 1;
    }
  }

  return value;
}

function hasPathBoundaries(value: string, startIndex: number, length: number): boolean {
  const before = startIndex === 0 ? undefined : value[startIndex - 1];
  const after = value[startIndex + length];
  return isPathPrefixBoundary(before) && (after === undefined || after === "/");
}

function isPathPrefixBoundary(char: string | undefined): boolean {
  return char === undefined || !/[A-Za-z0-9_.~-]/.test(char);
}

function rewriteReportText(value: string, replacements: PathReplacement[], status: FilePairStatus): string {
  const missingCounterpartLabel = labelForMissingCounterpart(value, status);
  if (missingCounterpartLabel) {
    return missingCounterpartLabel;
  }

  return rewritePathText(value, replacements);
}

function labelForMissingCounterpart(value: string, status: FilePairStatus): string | undefined {
  if (!isEmptyCounterpartPath(value)) {
    return undefined;
  }

  if (status === "added") {
    return BEFORE_FILE_MISSING_LABEL;
  }

  if (status === "deleted") {
    return AFTER_FILE_MISSING_LABEL;
  }

  return undefined;
}

function isEmptyCounterpartPath(value: string): boolean {
  const normalized = value.replaceAll("\\", "/").toLowerCase();
  return normalized.split("/").at(-1) === EMPTY_COUNTERPART_NAME;
}

async function readOptionalSource(sourcePath: string | undefined): Promise<string> {
  return sourcePath ? readTextFile(sourcePath) : "";
}

function isCSource(relativePath: string): boolean {
  return relativePath.replaceAll("\\", "/").toLowerCase().endsWith(".c");
}

function toArgb(rgb: string): string {
  return `FF${rgb}`;
}

function thinBorder(): Partial<ExcelJS.Borders> {
  return {
    top: { style: "thin", color: { argb: "FFD9E2EA" } },
    right: { style: "thin", color: { argb: "FFD9E2EA" } },
    bottom: { style: "thin", color: { argb: "FFD9E2EA" } },
    left: { style: "thin", color: { argb: "FFD9E2EA" } }
  };
}
