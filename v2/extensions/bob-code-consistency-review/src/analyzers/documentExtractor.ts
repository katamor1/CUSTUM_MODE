import * as fs from "node:fs/promises"
import * as path from "node:path"
import { resolveWorkspacePathStrict, toPosixPath } from "../core/fileSystem"
import { decodeTextBuffer } from "../core/textEncoding"
import { normalizeReviewProcessingLimits, truncateUtf8Text, type ReviewProcessingLimits } from "../core/limits"
import type { DocumentExtractionResult, EvidenceRef } from "../core/documentTypes"
import type { ReviewInput } from "../core/reviewTypes"
import { extractDocxChunks } from "./documentDocxExtractor"
import type { ArtifactRef, ExtractedChunk } from "./documentExtractionCommon"
import { extractMarkdownChunks } from "./documentMarkdownExtractor"
import { extractXlsxChunks } from "./documentXlsxExtractor"

type DocumentMeta = DocumentExtractionResult["documents"][number]

const ARTIFACT_TYPES: Record<string, { evidenceType: string; prefix: string; documentPrefix: string }> = {
  requirements: { evidenceType: "requirement", prefix: "REQ", documentPrefix: "REQ" },
  basic_design: { evidenceType: "basic_design", prefix: "BD", documentPrefix: "BD" },
  detailed_design: { evidenceType: "detailed_design", prefix: "DD", documentPrefix: "DD" },
  test_spec: { evidenceType: "test_spec", prefix: "TC", documentPrefix: "TC" },
  ledgers: { evidenceType: "ledger", prefix: "LEDGER", documentPrefix: "LEDGER" },
  tickets: { evidenceType: "ticket", prefix: "TICKET", documentPrefix: "TICKET" }
}
const AGGREGATE_EXCERPT_SUFFIX = "\n\n[truncated: aggregate maxBobInputBytes]\n"

export async function extractDocuments(reviewInput: ReviewInput, options: { workspaceRoot: string; textEncoding?: string; limits?: Partial<ReviewProcessingLimits> }): Promise<DocumentExtractionResult> {
  const documents: DocumentMeta[] = []
  const evidence: EvidenceRef[] = []
  const excerpts: string[] = []
  const warnings: string[] = []
  const counters = new Map<string, number>()
  const limits = normalizeReviewProcessingLimits(options.limits)
  let excerptMarkdownBytes = 0
  let aggregateBudgetExhausted = false

  for (const [artifactType, value] of Object.entries(reviewInput.artifacts)) {
    const typeInfo = ARTIFACT_TYPES[artifactType] ?? { evidenceType: artifactType, prefix: artifactType.toUpperCase(), documentPrefix: artifactType.toUpperCase() }
    if (!Array.isArray(value)) {
      warnings.push(`artifact ${artifactType} is not an array; skipped`)
      continue
    }

    for (const item of value as ArtifactRef[]) {
      if (aggregateBudgetExhausted) break
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
        const separatorBytes = excerpts.length > 0 ? Buffer.byteLength("\n", "utf8") : 0
        const remainingBytes = Math.max(0, limits.maxBobInputBytes - excerptMarkdownBytes - separatorBytes)
        const aggregateFit = fitExcerptWithinAggregateBudget(
          evidenceId,
          item.path,
          item.version,
          typeInfo.evidenceType,
          limitedChunk,
          remainingBytes
        )
        if (!aggregateFit) {
          warnings.push(`document excerpts exhausted aggregate maxBobInputBytes (${limits.maxBobInputBytes}); remaining excerpts skipped.`)
          aggregateBudgetExhausted = true
          break
        }
        if (aggregateFit.truncated) {
          warnings.push(`${toPosixPath(item.path)} ${chunk.ref} exceeded aggregate maxBobInputBytes (${limits.maxBobInputBytes}); excerpt truncated and remaining excerpts skipped.`)
          aggregateBudgetExhausted = true
        }

        const evidenceRef: EvidenceRef = {
          evidence_id: evidenceId,
          type: typeInfo.evidenceType,
          ref: aggregateFit.chunk.ref,
          document_id: documentId,
          source: toPosixPath(item.path),
          version: item.version,
          location: aggregateFit.chunk.location,
          text: aggregateFit.chunk.text
        }
        evidence.push(evidenceRef)
        document.sections.push({ id: aggregateFit.chunk.ref, title: aggregateFit.chunk.title, evidence_id: evidenceId, location: aggregateFit.chunk.location })
        excerpts.push(aggregateFit.markdown)
        excerptMarkdownBytes += separatorBytes + Buffer.byteLength(aggregateFit.markdown, "utf8")
        if (aggregateBudgetExhausted) break
      }

      documents.push(document)
    }

    if (aggregateBudgetExhausted) break
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

function limitChunkText(chunk: ExtractedChunk, sourcePath: string, warnings: string[], limits: ReviewProcessingLimits): ExtractedChunk {
  const suffix = "\n\n[truncated: maxExcerptBytesPerDocument]\n"
  const limited = truncateUtf8Text(chunk.text, limits.maxExcerptBytesPerDocument, suffix)
  if (!limited.truncated) return chunk
  warnings.push(`${toPosixPath(sourcePath)} ${chunk.ref} exceeded maxExcerptBytesPerDocument (${limited.originalBytes} > ${limits.maxExcerptBytesPerDocument}); excerpt truncated.`)
  return { ...chunk, text: limited.text }
}

function fitExcerptWithinAggregateBudget(
  evidenceId: string,
  sourcePath: string,
  version: string | undefined,
  evidenceType: string,
  chunk: ExtractedChunk,
  remainingBytes: number
): { chunk: ExtractedChunk; markdown: string; truncated: boolean } | undefined {
  const fullMarkdown = renderExcerpt(evidenceId, sourcePath, version, evidenceType, chunk)
  if (Buffer.byteLength(fullMarkdown, "utf8") <= remainingBytes) {
    return { chunk, markdown: fullMarkdown, truncated: false }
  }

  const emptyChunk = { ...chunk, text: "" }
  const emptyMarkdown = renderExcerpt(evidenceId, sourcePath, version, evidenceType, emptyChunk)
  const fixedBytes = Buffer.byteLength(emptyMarkdown, "utf8")
  if (fixedBytes > remainingBytes) return undefined

  const textBudget = Math.max(0, remainingBytes - fixedBytes)
  const limitedText = truncateUtf8Text(chunk.text, textBudget, AGGREGATE_EXCERPT_SUFFIX).text
  const limitedChunk = { ...chunk, text: limitedText }
  const markdown = renderExcerpt(evidenceId, sourcePath, version, evidenceType, limitedChunk)
  return { chunk: limitedChunk, markdown, truncated: true }
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
