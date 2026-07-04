export type ReviewProcessingLimits = {
  maxDocumentBytes: number
  maxWorkbookSheets: number
  maxRowsPerSheet: number
  maxExcerptBytesPerDocument: number
  maxRawDiffBytes: number
  maxBobInputBytes: number
}

export const DEFAULT_REVIEW_PROCESSING_LIMITS: ReviewProcessingLimits = {
  maxDocumentBytes: 5 * 1024 * 1024,
  maxWorkbookSheets: 20,
  maxRowsPerSheet: 500,
  maxExcerptBytesPerDocument: 64 * 1024,
  maxRawDiffBytes: 1024 * 1024,
  maxBobInputBytes: 2 * 1024 * 1024
}

export function normalizeReviewProcessingLimits(input: Partial<ReviewProcessingLimits> | undefined): ReviewProcessingLimits {
  return {
    maxDocumentBytes: positiveLimit(input?.maxDocumentBytes, DEFAULT_REVIEW_PROCESSING_LIMITS.maxDocumentBytes),
    maxWorkbookSheets: positiveLimit(input?.maxWorkbookSheets, DEFAULT_REVIEW_PROCESSING_LIMITS.maxWorkbookSheets),
    maxRowsPerSheet: positiveLimit(input?.maxRowsPerSheet, DEFAULT_REVIEW_PROCESSING_LIMITS.maxRowsPerSheet),
    maxExcerptBytesPerDocument: positiveLimit(input?.maxExcerptBytesPerDocument, DEFAULT_REVIEW_PROCESSING_LIMITS.maxExcerptBytesPerDocument),
    maxRawDiffBytes: positiveLimit(input?.maxRawDiffBytes, DEFAULT_REVIEW_PROCESSING_LIMITS.maxRawDiffBytes),
    maxBobInputBytes: positiveLimit(input?.maxBobInputBytes, DEFAULT_REVIEW_PROCESSING_LIMITS.maxBobInputBytes)
  }
}

export function truncateUtf8Text(text: string, maxBytes: number, suffix: string): { text: string; truncated: boolean; originalBytes: number } {
  const originalBytes = Buffer.byteLength(text, "utf8")
  if (originalBytes <= maxBytes) return { text, truncated: false, originalBytes }

  const suffixBytes = Buffer.byteLength(suffix, "utf8")
  const allowedBytes = Math.max(0, maxBytes - suffixBytes)
  let low = 0
  let high = text.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(text.slice(0, mid), "utf8") <= allowedBytes) low = mid
    else high = mid - 1
  }
  return { text: `${text.slice(0, low)}${suffix}`, truncated: true, originalBytes }
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}
