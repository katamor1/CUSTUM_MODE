export type ArtifactRef = {
  path?: string
  version?: string
  updated_at?: string
  sections?: string[]
  sheets?: string[]
  rows?: string[]
  cases?: string[]
  note?: string
}

export type ExtractedChunk = {
  evidenceType: string
  ref: string
  title?: string
  location?: string
  headingPath?: string[]
  text: string
}

export function matchingChunks(chunks: ExtractedChunk[], selectors: string[]): ExtractedChunk[] {
  if (selectors.length === 0) return chunks
  const selected = chunks.filter((chunk) => selectors.some((selector) => containsSelector(chunk, selector)))
  return selected.length > 0 ? selected : chunks.filter((chunk) => selectors.some((selector) => chunk.ref.includes(selector)))
}

export function firstKnownId(text: string): string | undefined {
  return text.match(/\b(?:REQ|BD|DD|TC|ERR|ISSUE|TICKET|LEDGER)(?:[-_][A-Za-z0-9]+)+\b/)?.[0]
}

export function rowsToMarkdown(rows: string[][]): string {
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

export function cellText(cell: unknown): string {
  if (cell === null || cell === undefined) return ""
  if (cell instanceof Date) return cell.toISOString()
  return String(cell).trim()
}

function containsSelector(chunk: ExtractedChunk, selector: string): boolean {
  const haystack = `${chunk.ref}\n${chunk.title ?? ""}\n${chunk.location ?? ""}\n${chunk.text}`.toLowerCase()
  return haystack.includes(selector.toLowerCase())
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").trim()
}
