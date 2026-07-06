import * as path from "node:path"
import * as vscode from "vscode"
import { applyAiTraceabilityDraft, parseAiTraceabilityDraft, prepareAiTraceabilityDraftPrompt } from "./core/traceabilityAiDraftProvider"
import { buildReviewInputDraftFromTraceability } from "./core/traceabilityCatalog"
import {
  DEFAULT_TRACEABILITY_CATALOG_PATH,
  DEFAULT_TRACEABILITY_GATE_REPORT_PATH,
  readTraceabilityCatalog,
  validateAndWriteTraceabilityGateReport
} from "./core/traceabilityCatalogStore"
import { pathExists, readTextFile, resolveWorkspacePathForKind, resolveWorkspacePathStrict } from "./core/fileSystem"
import { writeReviewInputFromDraft } from "./core/reviewInputBuilder"
import {
  absolute,
  booleanOption,
  firstString,
  notifyError,
  notifyInfo,
  notifyInfoWithReport,
  optionalAbsolute,
  requireBobWorkspaceRoot,
  resolveTrustedBzrPath,
  reviewFocusOption,
  stringOption,
  stringOrPrompt,
  vcsOrPrompt
} from "./extensionCommandOptions"
import { collectReviewMetadata } from "./reviewInputWizard"
import { openTraceabilityPrepWebview } from "./webview/traceabilityPrepWebview"
import { optionRecord } from "./workflowProviderRegistration"

const TRACEABILITY_DRAFT_FILE_NAMES = ["ai-draft.json", "ai-draft-output.json", "ai-draft-result.json"]

export async function runPrepareAiTraceabilityDraft(options?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(options)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const catalogPath = stringOption(record, "traceabilityCatalogPath") ??
    config.get<string>("traceabilityCatalogPath", DEFAULT_TRACEABILITY_CATALOG_PATH)
  const outputDir = stringOption(record, "aiTraceabilityDraftPromptPath") ?? ".bob-trace/ai-traceability-draft"
  const textEncoding = stringOption(record, "textEncoding") ?? config.get<string>("textEncoding", "auto")
  const base = await stringOrPrompt(record, "base", "traceability AI draft 用の base revision", "HEAD~1")
  if (!base) return { status: "cancelled" }
  const head = await stringOrPrompt(record, "head", "traceability AI draft 用の head revision", "HEAD")
  if (!head) return { status: "cancelled" }
  const vcs = await vcsOrPrompt(record)
  if (!vcs) return { status: "cancelled" }

  const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "traceability AI draft 用プロンプトを作成しています" }, () =>
    prepareAiTraceabilityDraftPrompt({
      workspaceRoot,
      outputDir,
      catalogPath,
      docsRoot: stringOption(record, "docsRoot"),
      base,
      head,
      vcs,
      vcsRoot: stringOption(record, "vcsRoot") ?? stringOption(record, "vcs_root"),
      bzrPath: resolveTrustedBzrPath(record, config.get<string>("bzrPath", "bzr")),
      diffFixturePath: optionalAbsolute(workspaceRoot, stringOption(record, "diffFixturePath")),
      textEncoding
    })
  )

  await vscode.env.clipboard.writeText(result.prompt)
  const document = await vscode.workspace.openTextDocument(result.promptPath)
  await vscode.window.showTextDocument(document, { preview: false })
  const warningSuffix = result.warnings.length > 0 ? `\nwarning: ${result.warnings.length} 件` : ""
  notifyInfo(`traceability AI draft 用プロンプトを作成して clipboard にコピーしました: ${result.promptPath}${warningSuffix}`)
  return result
}

export async function runCaptureAiTraceabilityDraft(textOrOptions?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(textOrOptions)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const textEncoding = stringOption(record, "textEncoding") ?? config.get<string>("textEncoding", "auto")
  const rawText = firstString(textOrOptions) ?? stringOption(record, "text") ?? await vscode.env.clipboard.readText()
  const text = await resolveTraceabilityDraftText({ workspaceRoot, record, rawText, textEncoding })

  try {
    const draft = parseAiTraceabilityDraft(text)
    const jsonText = JSON.stringify(draft, null, 2)
    notifyInfo("traceability AI draft JSON を取り込みました。")
    return jsonText
  } catch (error) {
    const message = `traceability AI draft JSON を取り込めません: ${error instanceof Error ? error.message : String(error)}`
    notifyError(message)
    return { status: "error", errors: [message] }
  }
}

export async function runApplyAiTraceabilityDraft(textOrOptions?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(textOrOptions)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const catalogPath = stringOption(record, "traceabilityCatalogPath") ??
    config.get<string>("traceabilityCatalogPath", DEFAULT_TRACEABILITY_CATALOG_PATH)
  const reportPath = stringOption(record, "traceabilityGateReportPath") ??
    config.get<string>("traceabilityGateReportPath", DEFAULT_TRACEABILITY_GATE_REPORT_PATH)
  const textEncoding = stringOption(record, "textEncoding") ?? config.get<string>("textEncoding", "auto")
  const rawText = firstString(textOrOptions) ?? stringOption(record, "text") ?? await vscode.env.clipboard.readText()
  const text = await resolveTraceabilityDraftText({ workspaceRoot, record, rawText, textEncoding })
  const result = await applyAiTraceabilityDraft({ workspaceRoot, catalogPath, text, textEncoding })

  if (result.status === "error") {
    notifyError(`traceability AI draft JSON を catalog に反映できません: ${result.errors.join("; ")}`)
    return result
  }

  const gate = await validateAndWriteTraceabilityGateReport({ workspaceRoot, catalogPath, reportPath, textEncoding })
  const backup = result.backupPath ? `\n既存catalogのバックアップ: ${result.backupPath}` : ""
  notifyInfo(`traceability AI draft を catalog に反映しました: ${result.catalogPath}${backup}${gate.status === "ok" ? `\ngate report: ${gate.reportPath}` : ""}`)
  return { ...result, gateReport: gate }
}

export async function runValidateTraceabilityCatalog(options?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(options)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const catalogPath = stringOption(record, "traceabilityCatalogPath") ??
    config.get<string>("traceabilityCatalogPath", DEFAULT_TRACEABILITY_CATALOG_PATH)
  const reportPath = stringOption(record, "traceabilityGateReportPath") ??
    config.get<string>("traceabilityGateReportPath", DEFAULT_TRACEABILITY_GATE_REPORT_PATH)
  const textEncoding = stringOption(record, "textEncoding") ?? config.get<string>("textEncoding", "auto")
  const result = await validateAndWriteTraceabilityGateReport({ workspaceRoot, catalogPath, reportPath, textEncoding })
  if (result.status === "error") {
    notifyError(`traceability catalog を検証できません: ${result.errors.join("; ")}`)
    return result
  }
  const message = `traceability gate report を生成しました: ${result.reportPath}（error: ${result.report.errors.length} 件, warning: ${result.report.warnings.length} 件）`
  if (result.report.status === "error") notifyError(message)
  else notifyInfoWithReport(message, result.reportPath)
  return { ...result, status: result.report.status }
}

export async function runCreateReviewInputFromTraceability(options?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(options)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const catalogPath = stringOption(record, "traceabilityCatalogPath") ??
    config.get<string>("traceabilityCatalogPath", DEFAULT_TRACEABILITY_CATALOG_PATH)
  const reviewInputPath = absolute(workspaceRoot, stringOption(record, "reviewInputPath") ?? config.get<string>("reviewInputPath", "review-input.yaml"))
  const textEncoding = stringOption(record, "textEncoding") ?? config.get<string>("textEncoding", "auto")
  const read = await readTraceabilityCatalog({ workspaceRoot, catalogPath, textEncoding })
  if (read.status === "error") {
    notifyError(`traceability catalog を読めません: ${read.errors.join("; ")}`)
    return read
  }

  const review = await collectReviewMetadata(record)
  if (!review) return { status: "cancelled" }
  const build = buildReviewInputDraftFromTraceability(read.catalog, {
    review,
    review_focus: reviewFocusOption(record) ?? ["requirement-code-consistency", "design-code-consistency", "test-gap"]
  })
  if (build.status === "error") {
    const reportPath = stringOption(record, "traceabilityGateReportPath") ??
      config.get<string>("traceabilityGateReportPath", DEFAULT_TRACEABILITY_GATE_REPORT_PATH)
    await validateAndWriteTraceabilityGateReport({ workspaceRoot, catalogPath, reportPath, textEncoding })
    notifyError(`traceability gate error のため review-input.yaml を生成できません: ${build.errors.map((item) => item.code).join(", ")}`)
    return build
  }

  const result = await writeReviewInputFromDraft({
    draft: build.draft,
    workspaceRoot,
    outputPath: reviewInputPath,
    overwrite: true,
    backupExisting: true,
    strictPaths: booleanOption(record, "strictPaths") ?? true
  })
  if (result.status === "error") {
    notifyError(`traceability catalog から review-input.yaml を生成できません: ${result.errors.join("; ")}`)
    return { ...result, traceabilityWarnings: build.warnings }
  }

  const backup = result.backupPath ? `\n既存ファイルのバックアップ: ${result.backupPath}` : ""
  const warningSuffix = build.warnings.length > 0 ? `\ntraceability warning: ${build.warnings.length} 件` : ""
  notifyInfo(`traceability catalog から review-input.yaml を生成しました: ${result.outputPath}${backup}${warningSuffix}`)
  return { ...result, traceabilityWarnings: build.warnings }
}

export async function runOpenTraceabilityPrep(context: vscode.ExtensionContext, options?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(options)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const catalogPath = stringOption(record, "traceabilityCatalogPath") ??
    config.get<string>("traceabilityCatalogPath", DEFAULT_TRACEABILITY_CATALOG_PATH)
  const reportPath = stringOption(record, "traceabilityGateReportPath") ??
    config.get<string>("traceabilityGateReportPath", DEFAULT_TRACEABILITY_GATE_REPORT_PATH)
  const textEncoding = stringOption(record, "textEncoding") ?? config.get<string>("textEncoding", "auto")
  const result = await openTraceabilityPrepWebview({ context, workspaceRoot, catalogPath, reportPath, textEncoding })
  if (result.status === "error") notifyError(`traceability prep を開けません: ${result.errors.join("; ")}`)
  else notifyInfo(`traceability prep を開きました: ${result.catalogPath}`)
  return result
}

async function resolveTraceabilityDraftText(input: {
  workspaceRoot: string
  record: Record<string, unknown>
  rawText: string
  textEncoding?: string
}): Promise<string> {
  if (looksLikeInlineJson(input.rawText)) return input.rawText

  const outputDir = resolveWorkspacePathForKind(
    input.workspaceRoot,
    stringOption(input.record, "aiTraceabilityDraftPromptPath") ?? ".bob-trace/ai-traceability-draft",
    "traceability-ai-draft-output"
  )
  const candidates = uniqueStrings([
    ...extractTraceabilityDraftJsonPaths(input.rawText),
    stringOption(input.record, "traceabilityDraftJsonPath"),
    ...TRACEABILITY_DRAFT_FILE_NAMES.map((fileName) => path.join(outputDir, fileName))
  ])

  for (const candidate of candidates) {
    const filePath = resolveTraceabilityDraftPath(input.workspaceRoot, candidate)
    if (!filePath) continue
    if (await pathExists(filePath)) return readTextFile(filePath, input.textEncoding)
  }

  return input.rawText
}

function looksLikeInlineJson(text: string): boolean {
  const trimmed = text.trimStart()
  return trimmed.startsWith("{") || /^```json\s*{/i.test(trimmed)
}

function extractTraceabilityDraftJsonPaths(text: string): string[] {
  const candidates: string[] = []
  for (const match of text.matchAll(/\]\(([^)]+?\.json)\)/gi)) candidates.push(match[1])
  for (const match of text.matchAll(/[`'"]([^`'"]+?\.json)[`'"]/gi)) candidates.push(match[1])
  for (const match of text.matchAll(/(?:^|\s)([^\s\])]+?\.json)(?=\s|$|\))/gi)) candidates.push(match[1])
  return candidates
    .map(cleanPathCandidate)
    .filter((candidate): candidate is string => !!candidate && path.basename(candidate).toLowerCase().includes("draft"))
}

function cleanPathCandidate(value: string): string | undefined {
  const trimmed = value.trim().replace(/[?#].*$/, "")
  if (!trimmed) return undefined
  if (/^file:/i.test(trimmed)) return vscode.Uri.parse(trimmed).fsPath
  return trimmed
}

function resolveTraceabilityDraftPath(workspaceRoot: string, value: string): string | undefined {
  try {
    return resolveWorkspacePathStrict(workspaceRoot, value, "traceabilityDraftJsonPath")
  } catch {
    return undefined
  }
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (!value || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}
