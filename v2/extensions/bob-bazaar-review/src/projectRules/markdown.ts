import { ReviewResult, ReviewStatus } from "./types"

const STATUS_MARK: Record<ReviewStatus, string> = {
  pass: "[x]",
  fail: "[ ]",
  unknown: "[?]",
  not_applicable: "[-]",
  blocked: "[!]"
}

export function renderReviewResultMarkdown(result: ReviewResult): string {
  const lines: string[] = []
  lines.push("# Project Rule Review Summary")
  lines.push("")
  lines.push(`Review ID: ${result.review_id}`)
  lines.push(`VCS: ${result.vcs.type}`)
  if (result.vcs.repository) lines.push(`Repository: ${result.vcs.repository}`)
  if (result.vcs.revision) lines.push(`Revision: ${result.vcs.revision}`)
  if (result.vcs.base_revision || result.vcs.target_revision) {
    lines.push(`Revision range: ${result.vcs.base_revision ?? "?"}..${result.vcs.target_revision ?? "?"}`)
  }
  lines.push("")
  lines.push("## Counts")
  lines.push("")
  lines.push("| status | count |")
  lines.push("| --- | ---: |")
  for (const status of ["pass", "fail", "unknown", "not_applicable", "blocked"] as ReviewStatus[]) {
    lines.push(`| ${status} | ${result.summary[status] ?? 0} |`)
  }
  lines.push("")
  lines.push("## Checklist")
  lines.push("")

  for (const item of result.checklist_results) {
    lines.push(`- ${STATUS_MARK[item.status]} ${item.rule_id}: ${item.title}`)
    lines.push(`  - status: ${item.status}`)
    lines.push(`  - severity: ${item.severity}`)
    lines.push(`  - confidence: ${item.confidence}`)
    lines.push(`  - reason: ${item.reason}`)
    if (item.suggested_action) lines.push(`  - suggested_action: ${item.suggested_action}`)
    if (item.evidence.length > 0) {
      lines.push("  - evidence:")
      for (const evidence of item.evidence) {
        const loc = evidence.file ? `${evidence.file}${evidence.start_line ? `:${evidence.start_line}${evidence.end_line ? `-${evidence.end_line}` : ""}` : ""}` : ""
        lines.push(`    - ${loc ? `\`${loc}\` ` : ""}${evidence.summary}`)
      }
    }
  }

  if (result.findings.length > 0) {
    lines.push("")
    lines.push("## Findings")
    lines.push("")
    for (const finding of result.findings) {
      const loc = finding.file ? `${finding.file}${finding.start_line ? `:${finding.start_line}${finding.end_line ? `-${finding.end_line}` : ""}` : ""}` : ""
      lines.push(`### ${finding.id}: ${finding.title}`)
      lines.push("")
      lines.push(`- rule_id: ${finding.rule_id}`)
      lines.push(`- severity: ${finding.severity}`)
      if (loc) lines.push(`- location: \`${loc}\``)
      lines.push(`- description: ${finding.description}`)
      if (finding.suggested_fix) lines.push(`- suggested_fix: ${finding.suggested_fix}`)
      lines.push("")
    }
  }

  return lines.join("\n")
}
