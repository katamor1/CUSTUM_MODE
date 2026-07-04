import * as fs from "node:fs/promises"
import * as path from "node:path"
import { resolveWorkspacePathStrict, toPosixPath } from "../core/fileSystem"
import { decodeTextBuffer } from "../core/textEncoding"
import { normalizeReviewProcessingLimits, truncateUtf8Text, type ReviewProcessingLimits } from "../core/limits"
import type { DocumentExtractionResult, EvidenceRef, ReviewInput } from "../core/types"

type CheerioAPI = import("cheerio").CheerioAPI
type CheerioModule = typeof import("cheerio")
type MammothModule = typeof import("mammoth")
type XlsxModule = typeof import("xlsx")

type ArtifactRef = {
  path?: string
  version?: string
  updated_at?: string
  sections?: string[]
  sheets?: string[]
  rows?: string[]
  cases?: string[]
  note?: string
}

type ExtractedChunk = {
  evidenceType: string
  ref: string
  title?: string
  location?: string
  headingPath?: string[]
  text: string
}

type DocumentMeta = DocumentExtractionResult["documents"][number]

let cheerioModulePromise: Promise<CheerioModule> | undefined
let mammothModulePromise: Promise<MammothModule> | undefined
let xlsxModulePromise: Promise<XlsxModule> | undefined

const ARTIFACT_TYPES: Record<string, { evidenceType: string; prefix: string; documentPrefix: string }> = {
  requirements: { evidenceType: "requirement", prefix: "REQ", documentPrefix: "REQ" },
  basic_design: { evidenceType: "basic_design", prefix: "BD", documentPrefix: "BD" },
  detailed_design: { evidenceType: "detailed_design", prefix: "DD", documentPrefix: "DD" },
  test_spec: { evidenceType: "test_spec", prefix: "TC", documentPrefix: "TC" },
  ledgers: { evidenceType: "ledger", prefix: "LEDGER", documentPrefix: "LEDGER" },
  tickets: { evidenceType: "ticket", prefix: "TICKET", documentPrefix: "TICKET" }
}

export async function extractDocuments(reviewInput: ReviewInput, options: { workspaceRoot: string; textEncoding?: string; limits?: Partial<ReviewProcessingLimits> }): Promise<DocumentExtractionResult> {
  const documents: DocumentMeta[] = []
  const evidence: EvidenceRef[] = []
  const excerpts: string[] = []
  const warnings: string[] = []
  const counters = new Map<string, number>()
  const limits = normalizeReviewProcessingLimits(options.limits)

  for (const [artifactType, value] of Object.entries(reviewInput.artifacts)) {
    const typeInfo = ARTIFACT_TYPES[artifactType] ?? { evidenceType: artifactType, prefix: artifactType.toUpperCase(), documentPrefix: artifactType.toUpperCase() }
    if (!Array.isArray(value)) {
      warnings.push(`artifact ${artifactType} is not an array; skipped`)
      continue
    }

    for (const item of value as ArtifactRef[]) {
      if (!item.path) {
        warnings.push(`artifact ${artifactType} has no path; skipped`)
        continue
      }

      const documentId = `DOC-${typeInfo.documentPrefix}-${String(documents.length + 1).padStart(4, "0")}`
      const selectors = selectorList(item)
      let chunks: ExtractedChunk[] = []
      try {
        const filePath = resolveWorkspacePathStrict(options.workspaceRoot, item.path, "artifact path")
        chunks = await extractFileChunks(filePath, item, typeInfo.evidenceType, selectors, warnings, limits, options.textEncoding)
      } catch (error) {
        warnings.push(`failed to extract ${item.path}: ${error instanceof Error ? error.message : String(error)}`)
      }

      if (chunks.length === 0) warnings.push(`no matching excerpt found in ${item.path}`)

      const document: DocumentMeta = {
        document_id: documentId,
        path: toPosixPath(item.path),
        type: artifactType,
        version: item.version,
        updated_at: item.updated_at,
        sections: []
      }

      for (const chunk of chunks) {
        const limitedChunk = limitChunkText(chunk, item.path, warnings, limits)
        const evidenceId = nextEvidenceId(typeInfo.prefix, counters)
        const evidenceRef: EvidenceRef = {
          evidence_id: evidenceId,
          type: typeInfo.evidenceType,
          ref: limitedChunk.ref,
          document_id: documentId,
          source: toPosixPath(item.path),
          version: item.version,
          location: limitedChunk.location,
          text: limitedChunk.text
        }
        evidence.push(evidenceRef)
        document.sections.push({ id: limitedChunk.ref, title: limitedChunk.title, evidence_id: evidenceId, location: limitedChunk.location })
        excerpts.push(renderExcerpt(evidenceId, item.path, item.version, typeInfo.evidenceType, limitedChunk))
      }

      documents.push(document)
    }
  }

  return { documents, excerptsMarkdown: excerpts.join("\n"), evidence, warnings }
}

function selectorList(item: ArtifactRef): string[] {
  return [...(item.sections ?? []), ...(item.cases ?? []), ...(item.rows ?? [])].map((selector) => selector.trim()).filter(Boolean)
}

async function extractFileChunks(
  filePath: string,
  item: ArtifactRef,
  evidenceType: string,
  selectors: string[],
  warnings: string[],
  limits: ReviewProcessingLimits,
  textEncoding = "auto"
): Promise<ExtractedChunk[]> {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === ".md" || extension === ".markdown") {
    const read = await readLimitedTextFile(filePath, limits.maxDocumentBytes, textEncoding)
    if (read.truncated) warnings.push(`${toPosixPath(item.path ?? filePath)} exceeded maxDocumentBytes (${read.originalBytes} > ${limits.maxDocumentBytes}); truncated before extraction.`)
    return extractMarkdownChunks(read.text, evidenceType, selectors)
  }
  await assertDocumentWithinByteLimit(filePath, item.path ?? filePath, limits, warnings)
  if (extension === ".docx") return extractDocxChunks(filePath, evidenceType, selectors)
  if (extension === ".xlsx") return extractXlsxChunks(filePath, item, evidenceType, selectors, warnings, limits)
  throw new Error(`unsupported document extension: ${extension || "(none)"}`)
}

async function readLimitedTextFile(filePath: string, maxBytes: number, textEncoding: string): Promise<{ text: string; truncated: boolean; originalBytes: number }> {
  const stat = await fs.stat(filePath)
  const length = Math.min(stat.size, maxBytes)
  const handle = await fs.open(filePath, "r")
  try {
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, 0)
    return { text: decodeTextBuffer(buffer, textEncoding), truncated: stat.size > maxBytes, originalBytes: stat.size }
  } finally {
    await handle.close()
  }
}

async function assertDocumentWithinByteLimit(filePath: string, sourcePath: string, limits: ReviewProcessingLimits, warnings: string[]): Promise<void> {
  const stat = await fs.stat(filePath)
  if (stat.size <= limits.maxDocumentBytes) return
  warnings.push(`${toPosixPath(sourcePath)} exceeded maxDocumentBytes (${stat.size} > ${limits.maxDocumentBytes}); skipped.`)
  throw new Error(`document exceeds maxDocumentBytes (${stat.size} > ${limits.maxDocumentBytes})`)
}

function extractMarkdownChunks(markdown: string, evidenceType: string, selectors: string[]): ExtractedChunk[] {
  const blocks: Array<{ heading: string; headingPath: string[]; text: string }> = []
  const lines = markdown.split(/\r?\n/)
  let headingPath: string[] = []
  let currentHeading = "document"
  let current: string[] = []

  const flush = () => {
    const text = current.join("\n").trim()
    if (text) blocks.push({ heading: currentHeading, headingPath: [...headingPath], text })
    current = []
  }

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/)
    if (heading) {
      flush()
      const level = heading[1].length
      currentHeading = heading[2].trim()
      headingPath = [...headingPath.slice(0, level - 1), currentHeading]
    }
    current.push(line)
  }
  flush()

  return matchingChunks(blocks.map((block) => ({
    evidenceType,
    ref: firstKnownId(block.text) ?? block.heading,
    title: block.heading,
    location: block.headingPath.join(" > "),
    headingPath: block.headingPath,
    text: block.text
  })), selectors)
}

async function extractDocxChunks(filePath: string, evidenceType: string, selectors: string[]): Promise<ExtractedChunk[]> {
  const [mammoth, cheerio] = await Promise.all([loadMammoth(), loadCheerio()])
  const html = (await mammoth.convertToHtml({ path: filePath })).value
  const $ = cheerio.load(html)
  const chunks: ExtractedChunk[] = []
  const headingPath: string[] = []

  $("body").children().each((_, element) => {
    const tag = element.tagName?.toLowerCase()
    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag.slice(1))
      headingPath.splice(level - 1, headingPath.length, $(element).text().trim())
      return
    }

    if (tag === "table") {
      const markdown = htmlTableToMarkdown($, element)
      if (markdown.trim()) {
        chunks.push({
          evidenceType,
          ref: firstKnownId(markdown) ?? headingPath.at(-1) ?? "table",
          title: headingPath.at(-1),
          location: headingPath.join(" > "),
          headingPath: [...headingPath],
          text: markdown
        })
      }
      return
    }

    const text = $(element).text().replace(/\s+/g, " ").trim()
    if (text) {
      chunks.push({
        evidenceType,
        ref: firstKnownId(text) ?? headingPath.at(-1) ?? "paragraph",
        title: headingPath.at(-1),
        location: headingPath.join(" > "),
        headingPath: [...headingPath],
        text
      })
    }
  })

  return matchingChunks(chunks, selectors)
}

async function extractXlsxChunks(filePath: string, item: ArtifactRef, evidenceType: string, selectors: string[], warnings: string[], limits: ReviewProcessingLimits): Promise<ExtractedChunk[]> {
  const XLSX = await loadXlsx()
  const workbook = XLSX.readFile(filePath, { cellDates: false })
  const allSelectedSheets = item.sheets && item.sheets.length > 0 ? item.sheets : workbook.SheetNames
  const selectedSheets = allSelectedSheets.slice(0, limits.maxWorkbookSheets)
  if (allSelectedSheets.length > selectedSheets.length) {
    warnings.push(`${toPosixPath(item.path ?? filePath)} exceeded maxWorkbookSheets (${allSelectedSheets.length} > ${limits.maxWorkbookSheets}); remaining sheets skipped.`)
  }
  const chunks: ExtractedChunk[] = []

  for (const sheetName of selectedSheets) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" }) as unknown[][]
    if (rows.length === 0) continue
    const headers = rows[0].map((cell) => String(cell || "").trim())
    const dataRows = rows.slice(1)
    if (dataRows.length > limits.maxRowsPerSheet) {
      warnings.push(`${toPosixPath(item.path ?? filePath)} sheet ${sheetName} exceeded maxRowsPerSheet (${dataRows.length} > ${limits.maxRowsPerSheet}); remaining rows skipped.`)
    }
    for (let index = 1; index <= Math.min(dataRows.length, limits.maxRowsPerSheet); index += 1) {
      const row = rows[index].map((cell) => String(cell || "").trim())
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

function limitChunkText(chunk: ExtractedChunk, sourcePath: string, warnings: string[], limits: ReviewProcessingLimits): ExtractedChunk {
  const suffix = "\n\n[truncated: maxExcerptBytesPerDocument]\n"
  const limited = truncateUtf8Text(chunk.text, limits.maxExcerptBytesPerDocument, suffix)
  if (!limited.truncated) return chunk
  warnings.push(`${toPosixPath(sourcePath)} ${chunk.ref} exceeded maxExcerptBytesPerDocument (${limited.originalBytes} > ${limits.maxExcerptBytesPerDocument}); excerpt truncated.`)
  return { ...chunk, text: limited.text }
}

function matchingChunks(chunks: ExtractedChunk[], selectors: string[]): ExtractedChunk[] {
  if (selectors.length === 0) return chunks
  const selected = chunks.filter((chunk) => selectors.some((selector) => containsSelector(chunk, selector)))
  return selected.length > 0 ? selected : chunks.filter((chunk) => selectors.some((selector) => chunk.ref.includes(selector)))
}

function containsSelector(chunk: ExtractedChunk, selector: string): boolean {
  const haystack = `${chunk.ref}\n${chunk.title ?? ""}\n${chunk.location ?? ""}\n${chunk.text}`.toLowerCase()
  return haystack.includes(selector.toLowerCase())
}

function nextEvidenceId(prefix: string, counters: Map<string, number>): string {
  const next = (counters.get(prefix) ?? 0) + 1
  counters.set(prefix, next)
  return `${prefix}-${String(next).padStart(4, "0")}`
}

function renderExcerpt(evidenceId: string, sourcePath: string, version: string | undefined, evidenceType: string, chunk: ExtractedChunk): string {
  return [
    `## ${evidenceId}`,
    "",
    `- document: ${toPosixPath(sourcePath)}`,
    `- version: ${version ?? "unknown"}`,
    `- ref: ${chunk.ref}`,
    `- type: ${evidenceType}`,
    chunk.location ? `- location: ${chunk.location}` : undefined,
    "",
    chunk.text,
    ""
  ].filter((line): line is string => line !== undefined).join("\n")
}

function htmlTableToMarkdown($: CheerioAPI, table: any): string {
  const rows: string[][] = []
  $(table).find("tr").each((_, tr) => {
    const cells: string[] = []
    $(tr).find("th,td").each((__, cell) => {
      cells.push($(cell).text().replace(/\s+/g, " ").trim())
    })
    if (cells.some(Boolean)) rows.push(cells)
  })
  return rowsToMarkdown(rows)
}

function rowsToMarkdown(rows: string[][]): string {
  if (rows.length === 0) return ""
  const width = Math.max(...rows.map((row) => row.length))
  const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => escapeCell(row[index] ?? "")))
  const header = normalized[0]
  const separator = header.map(() => "---")
  return [
    `| ${header.join(" | ")} |`,
    `| ${separator.join(" | ")} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(" | ")} |`)
  ].join("\n")
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").trim()
}

function firstKnownId(text: string): string | undefined {
  return text.match(/\b(?:REQ|BD|DD|TC|ERR|ISSUE|TICKET|LEDGER)(?:[-_][A-Za-z0-9]+)+\b/)?.[0]
}

function loadCheerio(): Promise<CheerioModule> {
  cheerioModulePromise ??= import("cheerio")
  return cheerioModulePromise
}

function loadMammoth(): Promise<MammothModule> {
  mammothModulePromise ??= import("mammoth")
  return mammothModulePromise
}

function loadXlsx(): Promise<XlsxModule> {
  xlsxModulePromise ??= import("xlsx")
  return xlsxModulePromise
}
