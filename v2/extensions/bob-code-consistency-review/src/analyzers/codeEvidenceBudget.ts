import {
  normalizeReviewProcessingLimits,
  truncateUtf8Text,
  type ReviewProcessingLimits
} from "../core/limits"

export const MAX_CODE_EVIDENCE_ITEMS = 500

const ITEM_TRUNCATION_SUFFIX = "\n\n[truncated: maxExcerptBytesPerDocument]\n"
const AGGREGATE_TRUNCATION_SUFFIX = "\n\n[truncated: aggregate maxBobInputBytes]\n"

export interface CodeEvidenceBudget {
  remainingBytes: number
  remainingItems: number
  maxItemBytes: number
  exhausted: boolean
  aggregateWarningReported: boolean
  itemCountWarningReported: boolean
}

export interface CodeEvidenceReservation {
  text: string
  markdown: string
  truncated: boolean
}

export function createCodeEvidenceBudget(
  limits: Partial<ReviewProcessingLimits> | undefined
): CodeEvidenceBudget {
  const normalized = normalizeReviewProcessingLimits(limits)
  return {
    remainingBytes: normalized.maxBobInputBytes,
    remainingItems: MAX_CODE_EVIDENCE_ITEMS,
    maxItemBytes: normalized.maxExcerptBytesPerDocument,
    exhausted: false,
    aggregateWarningReported: false,
    itemCountWarningReported: false
  }
}

/**
 * 1件のcode evidenceをper-item limitと全code-slice共通budgetへ収める。
 * `render`はtextを1回だけMarkdownへ埋め込む純粋関数として扱う。
 */
export function reserveCodeEvidence(
  input: { label: string; text: string; render: (text: string) => string },
  budget: CodeEvidenceBudget,
  warnings: string[]
): CodeEvidenceReservation | undefined {
  if (budget.exhausted) return undefined
  if (budget.remainingItems <= 0) {
    budget.exhausted = true
    if (!budget.itemCountWarningReported) {
      warnings.push(`code evidence exceeded maximum item count (${MAX_CODE_EVIDENCE_ITEMS}); remaining code evidence skipped.`)
      budget.itemCountWarningReported = true
    }
    return undefined
  }

  const perItem = truncateUtf8Text(input.text, budget.maxItemBytes, ITEM_TRUNCATION_SUFFIX)
  if (perItem.truncated) {
    warnings.push(`${input.label} exceeded maxExcerptBytesPerDocument (${perItem.originalBytes} > ${budget.maxItemBytes}); code evidence truncated.`)
  }

  const fullMarkdown = input.render(perItem.text)
  const fullMarkdownBytes = Buffer.byteLength(fullMarkdown, "utf8")
  if (fullMarkdownBytes <= budget.remainingBytes) {
    consumeBudget(budget, fullMarkdownBytes)
    return { text: perItem.text, markdown: fullMarkdown, truncated: perItem.truncated }
  }

  const emptyMarkdown = input.render("")
  const fixedBytes = Buffer.byteLength(emptyMarkdown, "utf8")
  if (fixedBytes > budget.remainingBytes) {
    exhaustAggregateBudget(input.label, budget, warnings)
    return undefined
  }

  const textBudget = Math.max(0, budget.remainingBytes - fixedBytes)
  const aggregate = truncateUtf8Text(perItem.text, textBudget, AGGREGATE_TRUNCATION_SUFFIX)
  const markdown = input.render(aggregate.text)
  const markdownBytes = Buffer.byteLength(markdown, "utf8")
  if (markdownBytes > budget.remainingBytes) {
    exhaustAggregateBudget(input.label, budget, warnings)
    return undefined
  }

  consumeBudget(budget, markdownBytes)
  exhaustAggregateBudget(input.label, budget, warnings)
  return { text: aggregate.text, markdown, truncated: true }
}

function consumeBudget(budget: CodeEvidenceBudget, markdownBytes: number): void {
  budget.remainingBytes = Math.max(0, budget.remainingBytes - markdownBytes)
  budget.remainingItems = Math.max(0, budget.remainingItems - 1)
}

function exhaustAggregateBudget(label: string, budget: CodeEvidenceBudget, warnings: string[]): void {
  budget.exhausted = true
  if (budget.aggregateWarningReported) return
  warnings.push(`${label} exhausted aggregate maxBobInputBytes for code evidence; remaining code evidence skipped.`)
  budget.aggregateWarningReported = true
}
