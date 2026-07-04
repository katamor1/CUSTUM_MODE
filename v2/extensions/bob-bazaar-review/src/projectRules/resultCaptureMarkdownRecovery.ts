import { loadProjectChecklist } from "./io"
import type { CandidateText, CaptureReviewResultOptions } from "./resultCaptureTypes"
import type { ProjectChecklist, ProjectRule, ReviewResult, ReviewStatus } from "./types"

interface MarkdownChecklistDecision {
  status: ReviewStatus
  reason: string
}

export async function recoverReviewResultFromMarkdown(
  workspaceRoot: string,
  candidates: CandidateText[],
  options: CaptureReviewResultOptions
): Promise<{ source: string; jsonText: string } | undefined> {
  const state = options.workflowState
  if (!state) return undefined

  const reviewContext = parseStateObject(state.reviewContext)
  const reviewRules = parseStateObject(state.reviewRules)
  const checklistPath = stringValue(reviewRules?.checklistPath)
  const checklist = await loadProjectChecklist(workspaceRoot, checklistPath)
  if (checklist.rules.length === 0) return undefined

  for (const candidate of candidates) {
    const decisions = parseMarkdownChecklistDecisions(candidate.text, checklist)
    if (decisions.size === 0) continue
    const result = buildRecoveredReviewResult(checklist.rules, decisions, reviewContext)
    return {
      source: `${candidate.source} markdown recovery`,
      jsonText: JSON.stringify(result, null, 2)
    }
  }

  return undefined
}

function parseMarkdownChecklistDecisions(
  text: string,
  checklist: ProjectChecklist
): Map<string, MarkdownChecklistDecision> {
  const decisions = new Map<string, MarkdownChecklistDecision>()
  const rulesById = new Map(checklist.rules.map((rule) => [rule.id, rule]))
  parseMarkdownTableDecisions(text, rulesById, decisions)
  parseMarkdownHeadingDecisions(text, rulesById, decisions)
  return decisions
}

function parseMarkdownTableDecisions(
  text: string,
  rulesById: Map<string, ProjectRule>,
  decisions: Map<string, MarkdownChecklistDecision>
): void {
  for (const line of text.split(/\r?\n/)) {
    const cells = splitMarkdownTableRow(line)
    if (cells.length < 2 || cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))) continue

    const rule = ruleFromText(cells.join(" "), rulesById)
    if (!rule) continue

    const status = parseReviewStatus(cells[cells.length - 1])
    if (!status) continue

    const reason = stripMarkdown(cells.length >= 4 ? cells[cells.length - 2] : cells.join(" / "))
    decisions.set(rule.id, {
      status,
      reason: reason || `${rule.id} was parsed from Markdown output as ${status}.`
    })
  }
}

function parseMarkdownHeadingDecisions(
  text: string,
  rulesById: Map<string, ProjectRule>,
  decisions: Map<string, MarkdownChecklistDecision>
): void {
  let currentRule: ProjectRule | undefined
  let reasonLines: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const headingRule = /^#{2,6}\s+/.test(line) ? ruleFromText(line, rulesById) : undefined
    if (headingRule) {
      currentRule = headingRule
      reasonLines = []
      continue
    }
    if (!currentRule) continue
    if (/^#{2,6}\s+/.test(line)) {
      currentRule = undefined
      reasonLines = []
      continue
    }

    const status = parseStatusLine(line)
    if (status) {
      const reason = [...reasonLines, stripMarkdown(line)].filter(Boolean).join(" ")
      decisions.set(currentRule.id, {
        status,
        reason: reason || `${currentRule.id} was parsed from Markdown output as ${status}.`
      })
      continue
    }

    const reason = stripMarkdown(line.replace(/^\s*[-*]\s*/, ""))
    if (reason) reasonLines.push(reason)
  }
}

function ruleFromText(text: string, rulesById: Map<string, ProjectRule>): ProjectRule | undefined {
  const plain = stripMarkdown(text)
  return Array.from(rulesById.values()).find((candidate) => plain.includes(candidate.id))
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return []
  return trimmed.slice(1, -1).split("|").map((cell) => cell.trim())
}

function parseReviewStatus(value: string): ReviewStatus | undefined {
  const plain = stripMarkdown(value).toLowerCase()
  const compact = plain.replace(/[^a-z0-9_\u3040-\u30ff\u3400-\u9fff]+/g, "")
  if (isNotApplicableStatus(plain, compact)) return "not_applicable"
  if (compact.includes("blocked") || compact.includes("ブロック")) return "blocked"
  if (compact.includes("unknown") || compact.includes("不明") || compact.includes("未確認")) return "unknown"
  if (compact.includes("fail") || compact.includes("ng") || compact.includes("問題あり") || compact.includes("不合格")) return "fail"
  if (compact.includes("pass") || compact.includes("ok") || compact.includes("問題なし") || compact.includes("合格")) return "pass"
  return undefined
}

function isNotApplicableStatus(plain: string, compact: string): boolean {
  return compact.includes("not_applicable") ||
    compact.includes("notapplicable") ||
    /\bn\/?a\b/.test(plain) ||
    compact.includes("対象外") ||
    compact.includes("該当なし") ||
    compact.includes("非適用")
}

function parseStatusLine(line: string): ReviewStatus | undefined {
  const plain = stripMarkdown(line)
  if (!/(^|\s)(status|ステータス|判定)\s*[:：]/i.test(plain)) return undefined
  return parseReviewStatus(plain)
}

function buildRecoveredReviewResult(
  rules: ProjectRule[],
  decisions: Map<string, MarkdownChecklistDecision>,
  reviewContext: Record<string, unknown> | undefined
): ReviewResult {
  const summary = emptySummary()
  const findings: ReviewResult["findings"] = []
  const checklistResults = rules.map((rule) => {
    const decision = decisions.get(rule.id)
    const status = decision?.status ?? "unknown"
    summary[status] += 1
    const severity = status === "fail" ? rule.severity_on_fail : "info"
    const reason = decision?.reason ?? "Markdown output did not include a parseable checklist decision for this rule."
    const evidence = status === "pass" || status === "fail" ? [{ summary: reason }] : []
    if (status === "fail") {
      findings.push({
        id: `${rule.id}-001`,
        rule_id: rule.id,
        severity,
        title: rule.title,
        description: reason,
        suggested_fix: "該当ルールの指摘内容を確認し、必要な修正または追加調査を行ってください。"
      })
    }
    return {
      rule_id: rule.id,
      title: rule.title,
      status,
      severity,
      confidence: "medium" as const,
      evidence,
      reason
    }
  })
  return {
    review_id: buildRecoveredReviewId(reviewContext),
    vcs: buildRecoveredVcs(reviewContext),
    checklist_results: checklistResults,
    findings,
    summary
  }
}

function buildRecoveredVcs(reviewContext: Record<string, unknown> | undefined): ReviewResult["vcs"] {
  const baseRevision = stringValue(reviewContext?.baseRevision) ?? stringValue(reviewContext?.base_revision)
  const targetRevision = stringValue(reviewContext?.targetRevision) ?? stringValue(reviewContext?.target_revision)
  const revision = stringValue(reviewContext?.revision) ?? (baseRevision ? undefined : targetRevision)
  const vcs: ReviewResult["vcs"] = {
    type: "bazaar",
    repository: stringValue(reviewContext?.workspacePath) ??
      stringValue(reviewContext?.repository) ??
      stringValue(reviewContext?.repositoryRoot),
    revision_mode: stringValue(reviewContext?.mode) ?? stringValue(reviewContext?.revisionMode)
  }
  if (revision) vcs.revision = revision
  if (baseRevision) vcs.base_revision = baseRevision
  if (targetRevision) vcs.target_revision = targetRevision
  return vcs
}

function buildRecoveredReviewId(reviewContext: Record<string, unknown> | undefined): string {
  const vcs = buildRecoveredVcs(reviewContext)
  const revision = [vcs.base_revision, vcs.target_revision].filter(Boolean).join("-") || vcs.revision || "unknown"
  return `bazaar-r${sanitizeReviewIdSegment(revision)}-project-rule-review`
}

function sanitizeReviewIdSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "") || "unknown"
}

function emptySummary(): Record<ReviewStatus, number> {
  return {
    pass: 0,
    fail: 0,
    unknown: 0,
    not_applicable: 0,
    blocked: 0
  }
}

function parseStateObject(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function stripMarkdown(value: string): string {
  return value
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
