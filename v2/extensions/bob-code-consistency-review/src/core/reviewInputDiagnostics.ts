import * as fs from "node:fs/promises"
import YAML from "yaml"
import { readTextFile, writeTextFile } from "./fileSystem"
import { validateReviewInput } from "./reviewInputValidator"

export type ReviewInputDiagnosticsResult = {
  status: "ok" | "error"
  message: string
  diagnostics: string[]
}

export type ReviewInputRepairResult = {
  status: "ok" | "unchanged" | "error"
  message: string
  backupPath?: string
  changes: string[]
  diagnostics: string[]
}

const LEGACY_REVIEW_FOCUS_MAP: Record<string, string> = {
  requirements_to_code: "requirement-code-consistency",
  requirement_to_code: "requirement-code-consistency",
  design_to_code: "design-code-consistency",
  code_to_test: "test-gap",
  test_to_code: "test-gap",
  document_update: "document-update-gap",
  unintended_changes: "unintended-change",
  interface_impact: "interface-impact",
  rt_ts_rule: "rt-ts-rule",
  shared_memory_impact: "shared-memory-impact"
}

export async function explainReviewInputDiagnostics(input: { inputPath: string; workspaceRoot: string; textEncoding?: string }): Promise<ReviewInputDiagnosticsResult> {
  try {
    await validateReviewInput(input.inputPath, input.workspaceRoot, input.textEncoding ?? "auto")
    return { status: "ok", message: "review-input.yaml は有効です。", diagnostics: [] }
  } catch (error) {
    const diagnostics = error instanceof Error ? error.message.split(/\r?\n/).filter(Boolean) : [String(error)]
    return { status: "error", message: "review-input.yaml に修正が必要です。", diagnostics }
  }
}

export async function repairLegacyReviewInput(input: { inputPath: string; workspaceRoot: string; textEncoding?: string }): Promise<ReviewInputRepairResult> {
  let raw: string
  try {
    raw = await readTextFile(input.inputPath, input.textEncoding ?? "auto")
  } catch (error) {
    return { status: "error", message: `review-input.yaml を読み込めません: ${formatError(error)}`, changes: [], diagnostics: [formatError(error)] }
  }

  let parsed: unknown
  try {
    parsed = YAML.parse(raw) as unknown
  } catch (error) {
    return { status: "error", message: `review-input.yaml を YAML として解析できません: ${formatError(error)}`, changes: [], diagnostics: [formatError(error)] }
  }

  const changes: string[] = []
  if (isRecord(parsed)) repairReviewFocus(parsed, changes)

  if (changes.length === 0) {
    const diagnostics = await explainReviewInputDiagnostics(input)
    return {
      status: diagnostics.status === "ok" ? "unchanged" : "error",
      message: diagnostics.status === "ok" ? "自動修復できる項目はありません。" : "自動修復できる項目はありません。診断を確認してください。",
      changes,
      diagnostics: diagnostics.diagnostics
    }
  }

  const repaired = YAML.stringify(parsed, { lineWidth: 120 })
  const backupPath = `${input.inputPath}.bak-${timestampForFileName(new Date())}`
  await writeTextFile(backupPath, raw)
  await writeTextFile(input.inputPath, repaired)

  const diagnostics = await explainReviewInputDiagnostics(input)
  return {
    status: diagnostics.status,
    message: diagnostics.status === "ok" ? "review-input.yaml を自動修復しました。" : "review-input.yaml を自動修復しましたが、まだ診断が残っています。",
    backupPath,
    changes,
    diagnostics: diagnostics.diagnostics
  }
}

function repairReviewFocus(parsed: Record<string, unknown>, changes: string[]): void {
  const reviewFocus = parsed.review_focus
  if (!Array.isArray(reviewFocus)) return

  const next = reviewFocus.map((value) => {
    if (typeof value !== "string") return value
    const replacement = LEGACY_REVIEW_FOCUS_MAP[value]
    if (!replacement) return value
    changes.push(`review_focus: ${value} -> ${replacement}`)
    return replacement
  })
  parsed.review_focus = [...new Set(next)]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function timestampForFileName(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}
