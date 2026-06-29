import * as path from "node:path"
import YAML from "yaml"
import { readBobOutputText } from "../core/bobOutputSource"
import { writeTextFile } from "../core/fileSystem"

export type HumanTriageResult =
  | { status: "ok"; outDir: string; itemCount: number; bobOutputPath: string }
  | { status: "error"; outDir: string; itemCount: 0; message: string; errors: string[] }

export async function generateHumanTriage(input: { packageDir: string; bobOutputPath: string; outDir: string }): Promise<HumanTriageResult> {
  const loaded = await readBobOutputText(input)
  if (!loaded.ok) return triageError(input.outDir, loaded.error)

  let bobOutput: {
    review_summary?: { review_id?: string }
    findings?: Array<Record<string, any>>
    questions?: Array<Record<string, any>>
  }
  try {
    bobOutput = YAML.parse(loaded.text) as typeof bobOutput
  } catch (error) {
    return triageError(input.outDir, `Invalid YAML (${loaded.sourcePath}): ${error instanceof Error ? error.message : String(error)}`)
  }

  const reviewId = bobOutput.review_summary?.review_id ?? "unknown"
  const findings = bobOutput.findings ?? []
  const questions = bobOutput.questions ?? []
  const items = [
    ...findings.map((finding) => ({
      source_id: finding.id,
      source_type: "finding",
      decision: "",
      final_severity: finding.severity ?? "",
      owner: "",
      reason: "",
      review_comment: finding.summary ?? "",
      question: "",
      follow_up: { required: false, action: "", due: "" }
    })),
    ...questions.map((question) => ({
      source_id: question.id,
      source_type: "question",
      decision: "",
      final_severity: "",
      owner: question.suggested_owner ?? "",
      reason: "",
      review_comment: "",
      question: question.summary ?? "",
      follow_up: { required: Boolean(question.suggested_action), action: question.suggested_action ?? "", due: "" }
    }))
  ]

  await writeTextFile(path.join(input.outDir, "triage-result.yaml"), YAML.stringify({
    schema_version: 1,
    review_id: reviewId,
    triaged_by: "",
    triaged_at: "",
    items
  }))
  await writeTextFile(path.join(input.outDir, "accepted-findings.md"), renderFindings("採用候補のプレレビュー指摘", findings))
  await writeTextFile(path.join(input.outDir, "questions-to-author.md"), renderQuestions("作成者への確認事項", questions))
  await writeTextFile(path.join(input.outDir, "rejected-findings.md"), "# 棄却したプレレビュー指摘\n\ntriage-result.yaml の decision に基づいて人間が追記する。\n")
  await writeTextFile(path.join(input.outDir, "follow-up-actions.md"), renderFollowUps(findings, questions))

  return { status: "ok", outDir: input.outDir, itemCount: items.length, bobOutputPath: loaded.sourcePath }
}

function triageError(outDir: string, message: string): HumanTriageResult {
  return { status: "error", outDir, itemCount: 0, message, errors: [message] }
}

function renderFindings(title: string, items: Array<Record<string, any>>): string {
  const lines = [`# ${title}`, ""]
  for (const item of items) {
    lines.push(`## ${String(item.id ?? "unknown")}`, "", String(item.summary ?? ""), "")
    if (Array.isArray(item.evidence)) {
      lines.push("### Evidence", "", ...item.evidence.map((evidence: any) => `- ${evidence.evidence_id ?? "(no id)"} ${evidence.type ?? ""} ${evidence.ref ?? ""}`), "")
    }
    if (item.recommended_action) lines.push(`- recommended_action: ${item.recommended_action}`, "")
    if (item.human_check) lines.push(`- human_check: ${item.human_check}`, "")
  }
  return lines.join("\n")
}

function renderQuestions(title: string, items: Array<Record<string, any>>): string {
  const lines = [`# ${title}`, ""]
  for (const item of items) {
    lines.push(`## ${String(item.id ?? "unknown")}`, "", String(item.summary ?? ""), "")
    if (item.reason) lines.push(`- reason: ${item.reason}`)
    if (item.suggested_owner) lines.push(`- suggested_owner: ${item.suggested_owner}`)
    if (item.suggested_action) lines.push(`- suggested_action: ${item.suggested_action}`)
    lines.push("")
  }
  return lines.join("\n")
}

function renderFollowUps(findings: Array<Record<string, any>>, questions: Array<Record<string, any>>): string {
  return [
    "# 後続対応",
    "",
    ...findings.map((finding) => `- ${finding.id}: ${finding.recommended_action ?? "triage decision required"}`),
    ...questions.map((question) => `- ${question.id}: ${question.suggested_action ?? "author confirmation required"}`),
    ""
  ].join("\n")
}
