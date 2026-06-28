import * as path from "node:path"
import * as cheerio from "cheerio"
import * as mammoth from "mammoth"
import * as XLSX from "xlsx"
import { readTextFile, resolveWorkspacePath, toPosixPath } from "../core/fileSystem"
import type { DocumentExtractionResult, EvidenceRef, ReviewInput } from "../core/types"

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

const ARTIFACT_TYPES: Record<string, { evidenceType: string; prefix: string; documentPrefix: string }> = {
  requirements: { evidenceType: "requirement", prefix: "REQ", documentPrefix: "REQ" },
  basic_design: { evidenceType: "basic_design", prefix: "BD", documentPrefix: "BD" },
  detailed_design: { evidenceType: "detailed_design", prefix: "DD", documentPrefix: "DD" },
  test_spec: { evidenceType: "test_spec", prefix: "TC", documentPrefix: "TC" },
  ledgers: { evidenceType: "ledger", prefix: "LEDGER", documentPrefix: "LEDGER" },
  tickets: { evidenceType: "ticket", prefix: "TICKET", documentPrefix: "TICKET" }
}

export async function extractDocuments(reviewInput: ReviewInput, options: { workspaceRoot: string }): Promise<DocumentExtractionResult> {
  const documents: DocumentMeta[] = []
  const evidence: EvidenceRef[] = []
  const excerpts: string[] = []
  const warnings: string[] = []
  const counters = new Map<string, number>()

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

      const filePath = resolveWorkspacePath(options.workspaceRoot, item.path)
      const documentId = `DOC-${typeInfo.documentPrefix}-${String(documents.length + 1).padStart(4, "0")}`
      const selectors = selectorList(item)
      let chunks: ExtractedChunk[] = []
      try {
        chunks = await extractFileChunks(filePath, item, typeInfo.evidenceType, selectors)
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
        const evidenceId = nextEvidenceId(typeInfo.prefix, counters)
        const evidenceRef: EvidenceRef = {
          evidence_id: evidenceId,
          type: typeInfo.evidenceType,
          ref: chunk.ref,
          document_id: documentId,
          source: toPosixPath(item.path),
          version: item.version,
          location: chunk.location,
          text: chunk.text
        }
        evidence.push(evidenceRef)
        document.sections.push({ id: chunk.ref, title: chunk.title, evidence_id: evidenceId, location: chunk.location })
        excerpts.push(renderExcerpt(evidenceId, item.path, item.version, typeInfo.evidenceType, chunk))
      }

      documents.push(document)
    }
  }

  return { documents, excerptsMarkdown: excerpts.join("\n"), evidence, warnings }
}

function selectorList(item: ArtifactRef): string[] {
  return [...(item.sections ?? []), ...(item.cases ?? []), ...(item.rows ?? [])].map((selector) => selector.trim()).filter(Boolean)
}

async function extractFileChunks(filePath: string, item: ArtifactRef, evidenceType: string, selectors: string[]): Promise<ExtractedChunk[]> {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === ".md" || extension === ".markdown") return extractMarkdownChunks(await readTextFile(filePath), evidenceType, selectors)
  if (extension === ".docx") return extractDocxChunks(filePath, evidenceType, selectors)
  if (extension === ".xlsx") return extractXlsxChunks(filePath, item, evidenceType, selectors)
  throw new Error(`unsupported document extension: ${extension || "(none)"}`)
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

function extractXlsxChunks(filePath: string, item: ArtifactRef, evidenceType: string, selectors: string[]): ExtractedChunk[] {
  const workbook = XLSX.readFile(filePath, { cellDates: false })
  const selectedSheets = item.sheets && item.sheets.length > 0 ? item.sheets : workbook.SheetNames
  const chunks: ExtractedChunk[] = []

  for (const sheetName of selectedSheets) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" }) as unknown[][]
    if (rows.length === 0) continue
    const headers = rows[0].map((cell) => String(cell || "").trim())
    for (let index = 1; index < rows.length; index += 1) {
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

function htmlTableToMarkdown($: cheerio.CheerioAPI, table: any): string {
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
  return text.match(/\b(?:REQ|BD|DD|TC|ERR|ISSUE|TICKET|LEDGER)-?[A-Za-z0-9_]+\b/)?.[0]
}
