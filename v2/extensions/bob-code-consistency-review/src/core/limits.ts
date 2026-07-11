export type ReviewProcessingLimits = {
  maxDocumentBytes: number
  maxWorkbookSheets: number
  maxRowsPerSheet: number
  maxExcerptBytesPerDocument: number
  maxRawDiffBytes: number
  maxBobInputBytes: number
}

export const MIN_REVIEW_PROCESSING_LIMITS: ReviewProcessingLimits = {
  maxDocumentBytes: 1,
  maxWorkbookSheets: 1,
  maxRowsPerSheet: 1,
  maxExcerptBytesPerDocument: 1,
  maxRawDiffBytes: 1,
  maxBobInputBytes: 1
}

export const DEFAULT_REVIEW_PROCESSING_LIMITS: ReviewProcessingLimits = {
  maxDocumentBytes: 5 * 1024 * 1024,
  maxWorkbookSheets: 20,
  maxRowsPerSheet: 500,
  maxExcerptBytesPerDocument: 64 * 1024,
  maxRawDiffBytes: 1024 * 1024,
  maxBobInputBytes: 2 * 1024 * 1024
}

export const MAX_REVIEW_PROCESSING_LIMITS: ReviewProcessingLimits = {
  maxDocumentBytes: 50 * 1024 * 1024,
  maxWorkbookSheets: 100,
  maxRowsPerSheet: 5_000,
  maxExcerptBytesPerDocument: 1024 * 1024,
  maxRawDiffBytes: 10 * 1024 * 1024,
  maxBobInputBytes: 8 * 1024 * 1024
}

export const MIN_VCS_PROCESS_BUFFER_BYTES = 1024 * 1024
export const MAX_VCS_PROCESS_BUFFER_BYTES = 20 * 1024 * 1024
const VCS_PROCESS_BUFFER_FIXED_HEADROOM_BYTES = 64 * 1024

export function normalizeReviewProcessingLimits(input: Partial<ReviewProcessingLimits> | undefined): ReviewProcessingLimits {
  return {
    maxDocumentBytes: boundedLimit(
      input?.maxDocumentBytes,
      DEFAULT_REVIEW_PROCESSING_LIMITS.maxDocumentBytes,
      MIN_REVIEW_PROCESSING_LIMITS.maxDocumentBytes,
      MAX_REVIEW_PROCESSING_LIMITS.maxDocumentBytes
    ),
    maxWorkbookSheets: boundedLimit(
      input?.maxWorkbookSheets,
      DEFAULT_REVIEW_PROCESSING_LIMITS.maxWorkbookSheets,
      MIN_REVIEW_PROCESSING_LIMITS.maxWorkbookSheets,
      MAX_REVIEW_PROCESSING_LIMITS.maxWorkbookSheets
    ),
    maxRowsPerSheet: boundedLimit(
      input?.maxRowsPerSheet,
      DEFAULT_REVIEW_PROCESSING_LIMITS.maxRowsPerSheet,
      MIN_REVIEW_PROCESSING_LIMITS.maxRowsPerSheet,
      MAX_REVIEW_PROCESSING_LIMITS.maxRowsPerSheet
    ),
    maxExcerptBytesPerDocument: boundedLimit(
      input?.maxExcerptBytesPerDocument,
      DEFAULT_REVIEW_PROCESSING_LIMITS.maxExcerptBytesPerDocument,
      MIN_REVIEW_PROCESSING_LIMITS.maxExcerptBytesPerDocument,
      MAX_REVIEW_PROCESSING_LIMITS.maxExcerptBytesPerDocument
    ),
    maxRawDiffBytes: boundedLimit(
      input?.maxRawDiffBytes,
      DEFAULT_REVIEW_PROCESSING_LIMITS.maxRawDiffBytes,
      MIN_REVIEW_PROCESSING_LIMITS.maxRawDiffBytes,
      MAX_REVIEW_PROCESSING_LIMITS.maxRawDiffBytes
    ),
    maxBobInputBytes: boundedLimit(
      input?.maxBobInputBytes,
      DEFAULT_REVIEW_PROCESSING_LIMITS.maxBobInputBytes,
      MIN_REVIEW_PROCESSING_LIMITS.maxBobInputBytes,
      MAX_REVIEW_PROCESSING_LIMITS.maxBobInputBytes
    )
  }
}

/**
 * Git/Bazaar CLI outputのhard bufferをartifact上限から導出する。
 * 2倍のtruncation headroomとstderr用固定headroomを持たせつつ、20MiBを超えない。
 */
export function maxVcsProcessBufferBytes(maxRawDiffBytes: number | undefined): number {
  const normalizedDiffBytes = boundedLimit(
    maxRawDiffBytes,
    DEFAULT_REVIEW_PROCESSING_LIMITS.maxRawDiffBytes,
    MIN_REVIEW_PROCESSING_LIMITS.maxRawDiffBytes,
    MAX_REVIEW_PROCESSING_LIMITS.maxRawDiffBytes
  )
  const derived = normalizedDiffBytes * 2 + VCS_PROCESS_BUFFER_FIXED_HEADROOM_BYTES
  return Math.max(MIN_VCS_PROCESS_BUFFER_BYTES, Math.min(MAX_VCS_PROCESS_BUFFER_BYTES, derived))
}

export function truncateUtf8Text(text: string, maxBytes: number, suffix: string): { text: string; truncated: boolean; originalBytes: number } {
  const originalBytes = Buffer.byteLength(text, "utf8")
  const safeLimit = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : 0
  if (originalBytes <= safeLimit) return { text, truncated: false, originalBytes }
  if (safeLimit === 0) return { text: "", truncated: true, originalBytes }

  const boundedSuffix = truncateUtf8Prefix(suffix, safeLimit)
  const suffixBytes = Buffer.byteLength(boundedSuffix, "utf8")
  const allowedBytes = Math.max(0, safeLimit - suffixBytes)
  const prefix = truncateUtf8Prefix(text, allowedBytes)
  return { text: `${prefix}${boundedSuffix}`, truncated: true, originalBytes }
}

function boundedLimit(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function truncateUtf8Prefix(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return ""
  const result: string[] = []
  let usedBytes = 0
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8")
    if (usedBytes + characterBytes > maxBytes) break
    result.push(character)
    usedBytes += characterBytes
  }
  return result.join("")
}
