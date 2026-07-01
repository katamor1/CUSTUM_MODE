import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as XLSX from "xlsx"
import { readTextFile, relativePosix } from "./fileSystem"
import type { ArtifactKind, ReviewInputArtifactDraft } from "./reviewInputBuilder"

export type ReviewInputDiscoveryOptions = {
  docsRoot?: string
  maxFiles?: number
  maxIdsPerFile?: number
  textEncoding?: string
}

export type ReviewInputDocumentCandidate = ReviewInputArtifactDraft & {
  label: string
  description?: string
}

export type ReviewInputDiscoveryResult = {
  documents: ReviewInputDocumentCandidate[]
  warnings: string[]
}

const DOCUMENT_EXTENSIONS = new Set([".md", ".markdown", ".docx", ".xlsx"])
const KNOWN_ID_PATTERN = /\b(?:REQ|BD|DD|TC|QA|RV|ERR|ISSUE|TICKET|LEDGER)(?:[-_][A-Za-z0-9]+)+\b/g

export async function discoverReviewInputCandidates(workspaceRoot: string, options: ReviewInputDiscoveryOptions = {}): Promise<ReviewInputDiscoveryResult> {
  const warnings: string[] = []
  const root = path.join(workspaceRoot, options.docsRoot ?? "docs")
  const maxFiles = options.maxFiles ?? 200
  const maxIdsPerFile = options.maxIdsPerFile ?? 20

  let files: string[] = []
  try {
    files = await walkDocumentFiles(root, maxFiles)
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      warnings.push(`docs root does not exist: ${root}`)
      return { documents: [], warnings }
    }
    throw error
  }

  const documents: ReviewInputDocumentCandidate[] = []
  for (const filePath of files) {
    const relativePath = relativePosix(workspaceRoot, filePath)
    const kind = inferArtifactKind(relativePath)
    const extension = path.extname(filePath).toLowerCase()
    try {
      if (extension === ".md" || extension === ".markdown") {
        documents.push(await discoverMarkdownCandidate(filePath, relativePath, kind, options.textEncoding ?? "auto", maxIdsPerFile))
      } else if (extension === ".xlsx") {
        documents.push(discoverXlsxCandidate(filePath, relativePath, kind, maxIdsPerFile))
      } else {
        documents.push({ kind, path: relativePath, label: relativePath, description: `${kind}; ID 抽出は未実施` })
      }
    } catch (error) {
      warnings.push(`failed to discover ${relativePath}: ${error instanceof Error ? error.message : String(error)}`)
      documents.push({ kind, path: relativePath, label: relativePath, description: kind })
    }
  }

  return { documents, warnings }
}

async function walkDocumentFiles(root: string, maxFiles: number): Promise<string[]> {
  const result: string[] = []
  const pending = [root]
  while (pending.length > 0 && result.length < maxFiles) {
    const current = pending.shift() as string
    const entries = await fs.readdir(current, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && entry.name !== "node_modules") pending.push(fullPath)
        continue
      }
      if (entry.isFile() && DOCUMENT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) result.push(fullPath)
      if (result.length >= maxFiles) break
    }
  }
  return result
}

async function discoverMarkdownCandidate(filePath: string, relativePath: string, kind: ArtifactKind, textEncoding: string, maxIds: number): Promise<ReviewInputDocumentCandidate> {
  const markdown = await readTextFile(filePath, textEncoding)
  const ids = uniqueMatches(markdown, maxIds)
  const selectorKey = kind === "test_spec" ? "cases" : "sections"
  return {
    kind,
    path: relativePath,
    [selectorKey]: ids.length > 0 ? ids : undefined,
    label: relativePath,
    description: descriptionText(kind, ids)
  }
}

function discoverXlsxCandidate(filePath: string, relativePath: string, kind: ArtifactKind, maxIds: number): ReviewInputDocumentCandidate {
  const workbook = XLSX.readFile(filePath, { cellDates: false, sheetRows: 80 })
  const ids: string[] = []
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" }) as unknown[][]
    for (const row of rows) {
      ids.push(...uniqueMatches(row.map((cell) => String(cell ?? "")).join(" "), maxIds - ids.length))
      if (ids.length >= maxIds) break
    }
    if (ids.length >= maxIds) break
  }

  return {
    kind,
    path: relativePath,
    sheets: workbook.SheetNames.length > 0 ? workbook.SheetNames : undefined,
    rows: ids.length > 0 ? ids : undefined,
    label: relativePath,
    description: descriptionText(kind, ids.length > 0 ? ids : workbook.SheetNames)
  }
}

function inferArtifactKind(relativePath: string): ArtifactKind {
  const lower = relativePath.toLowerCase()
  if (/requirement|requirements|req|要求/.test(lower)) return "requirements"
  if (/basic|bd|基本/.test(lower)) return "basic_design"
  if (/detail|detailed|dd|詳細/.test(lower)) return "detailed_design"
  if (/test|tc|試験|テスト/.test(lower)) return "test_spec"
  if (/qa|q-a|質問|回答|qa表/.test(lower)) return "ledgers"
  if (/review|rv|レビュー|指摘/.test(lower)) return "tickets"
  if (/ledger|table|error|err|台帳/.test(lower)) return "ledgers"
  if (/ticket|issue|bug|redmine/.test(lower)) return "tickets"
  return "requirements"
}

function uniqueMatches(text: string, maxItems: number): string[] {
  if (maxItems <= 0) return []
  const result: string[] = []
  for (const match of text.matchAll(KNOWN_ID_PATTERN)) {
    const id = match[0]
    if (!result.includes(id)) result.push(id)
    if (result.length >= maxItems) break
  }
  return result
}

function descriptionText(kind: ArtifactKind, ids: string[]): string {
  if (ids.length === 0) return `${kind}; ID 候補なし`
  return `${kind}; ${ids.slice(0, 4).join(", ")}${ids.length > 4 ? " ..." : ""}`
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error
}
