import { toPosixPath } from "../core/fileSystem"
import type { ReviewProcessingLimits } from "../core/limits"
import {
  cellText,
  firstKnownId,
  matchingChunks,
  rowsToMarkdown,
  type ArtifactRef,
  type ExtractedChunk
} from "./documentExtractionCommon"

type ExcelFileModule = typeof import("read-excel-file/node")
type ExcelSheet = import("read-excel-file/node").Sheet

let excelFileModulePromise: Promise<ExcelFileModule> | undefined

export async function extractXlsxChunks(
  filePath: string,
  item: ArtifactRef,
  evidenceType: string,
  selectors: string[],
  warnings: string[],
  limits: ReviewProcessingLimits
): Promise<ExtractedChunk[]> {
  const readExcelFile = await loadExcelFile()
  const workbook = await readExcelFile.default(filePath)
  const sheetsByName = new Map(workbook.map((sheet) => [sheet.sheet, sheet] as const))
  const sheetNames = workbook.map((sheet) => sheet.sheet)
  const allSelectedSheets = item.sheets && item.sheets.length > 0 ? item.sheets : sheetNames
  const selectedSheets = allSelectedSheets.slice(0, limits.maxWorkbookSheets)
  if (allSelectedSheets.length > selectedSheets.length) {
    warnings.push(`${toPosixPath(item.path ?? filePath)} exceeded maxWorkbookSheets (${allSelectedSheets.length} > ${limits.maxWorkbookSheets}); remaining sheets skipped.`)
  }
  const chunks: ExtractedChunk[] = []

  for (const sheetName of selectedSheets) {
    const sheet = sheetsByName.get(sheetName)
    if (!sheet) continue
    const rows = normalizeSheetRows(sheet)
    if (rows.length === 0) continue
    const headers = rows[0].map(cellText)
    const dataRows = rows.slice(1)
    if (dataRows.length > limits.maxRowsPerSheet) {
      warnings.push(`${toPosixPath(item.path ?? filePath)} sheet ${sheetName} exceeded maxRowsPerSheet (${dataRows.length} > ${limits.maxRowsPerSheet}); remaining rows skipped.`)
    }
    for (let index = 1; index <= Math.min(dataRows.length, limits.maxRowsPerSheet); index += 1) {
      const row = rows[index].map(cellText)
      if (row.every((cell) => !cell)) continue
      const rowText = [sheetName, ...row].join(" ")
      const rowId = firstKnownId(rowText) ?? `${sheetName}!${index + 1}`
      const table = rowsToMarkdown([headers, row])
      chunks.push({
        evidenceType,
        ref: rowId,
        title: sheetName,
        location: `${sheetName}!${index + 1}`,
        text: table
      })
    }
  }

  return matchingChunks(chunks, selectors)
}

function normalizeSheetRows(sheet: ExcelSheet): unknown[][] {
  return sheet.data.filter((row) => row.some((cell) => cellText(cell).length > 0))
}

function loadExcelFile(): Promise<ExcelFileModule> {
  excelFileModulePromise ??= import("read-excel-file/node")
  return excelFileModulePromise
}
