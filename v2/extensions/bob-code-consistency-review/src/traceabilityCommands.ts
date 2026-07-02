import * as vscode from "vscode"
import { applyAiTraceabilityDraft, prepareAiTraceabilityDraftPrompt } from "./core/traceabilityAiDraftProvider"
import { buildReviewInputDraftFromTraceability } from "./core/traceabilityCatalog"
import {
  DEFAULT_TRACEABILITY_CATALOG_PATH,
  DEFAULT_TRACEABILITY_GATE_REPORT_PATH,
  readTraceabilityCatalog,
  validateAndWriteTraceabilityGateReport
} from "./core/traceabilityCatalogStore"
import { writeReviewInputFromDraft } from "./core/reviewInputBuilder"
import {
  absolute,
  booleanOption,
  firstString,
  notifyError,
  notifyInfo,
  optionalAbsolute,
  requireBobWorkspaceRoot,
  reviewFocusOption,
  stringOption,
  stringOrPrompt,
  vcsOrPrompt
} from "./extensionCommandOptions"
import { collectReviewMetadata } from "./reviewInputWizard"
import { openTraceabilityPrepWebview } from "./webview/traceabilityPrepWebview"
import { optionRecord } from "./workflowProviderRegistration"

export async function runPrepareAiTraceabilityDraft(options?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(options)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const catalogPath = absolute(
    workspaceRoot,
    stringOption(record, "traceabilityCatalogPath") ??
      config.get<string>("traceabilityCatalogPath", DEFAULT_TRACEABILITY_CATALOG_PATH)
  )
  const outputDir = absolute(workspaceRoot, stringOption(record, "aiTraceabilityDraftPromptPath") ?? ".bob-trace/ai-traceability-draft")
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
      bzrPath: stringOption(record, "bzrPath") ?? config.get<string>("bzrPath", "bzr"),
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

export async function runApplyAiTraceabilityDraft(textOrOptions?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(textOrOptions)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const catalogPath = absolute(
    workspaceRoot,
    stringOption(record, "traceabilityCatalogPath") ??
      config.get<string>("traceabilityCatalogPath", DEFAULT_TRACEABILITY_CATALOG_PATH)
  )
  const reportPath = absolute(
    workspaceRoot,
    stringOption(record, "traceabilityGateReportPath") ??
      config.get<string>("traceabilityGateReportPath", DEFAULT_TRACEABILITY_GATE_REPORT_PATH)
  )
  const textEncoding = stringOption(record, "textEncoding") ?? config.get<string>("textEncoding", "auto")
  const text = firstString(textOrOptions) ?? stringOption(record, "text") ?? await vscode.env.clipboard.readText()
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
  const catalogPath = absolute(
    workspaceRoot,
    stringOption(record, "traceabilityCatalogPath") ??
      config.get<string>("traceabilityCatalogPath", DEFAULT_TRACEABILITY_CATALOG_PATH)
  )
  const reportPath = absolute(
    workspaceRoot,
    stringOption(record, "traceabilityGateReportPath") ??
      config.get<string>("traceabilityGateReportPath", DEFAULT_TRACEABILITY_GATE_REPORT_PATH)
  )
  const textEncoding = stringOption(record, "textEncoding") ?? config.get<string>("textEncoding", "auto")
  const result = await validateAndWriteTraceabilityGateReport({ workspaceRoot, catalogPath, reportPath, textEncoding })
  if (result.status === "error") {
    notifyError(`traceability catalog を検証できません: ${result.errors.join("; ")}`)
    return result
  }
  const message = `traceability gate report を生成しました: ${result.reportPath}（error: ${result.report.errors.length} 件, warning: ${result.report.warnings.length} 件）`
  if (result.report.status === "error") notifyError(message)
  else notifyInfo(message)
  return { ...result, status: result.report.status }
}

export async function runCreateReviewInputFromTraceability(options?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(options)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const catalogPath = absolute(
    workspaceRoot,
    stringOption(record, "traceabilityCatalogPath") ??
      config.get<string>("traceabilityCatalogPath", DEFAULT_TRACEABILITY_CATALOG_PATH)
  )
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
    const reportPath = absolute(
      workspaceRoot,
      stringOption(record, "traceabilityGateReportPath") ??
        config.get<string>("traceabilityGateReportPath", DEFAULT_TRACEABILITY_GATE_REPORT_PATH)
    )
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
  const catalogPath = absolute(
    workspaceRoot,
    stringOption(record, "traceabilityCatalogPath") ??
      config.get<string>("traceabilityCatalogPath", DEFAULT_TRACEABILITY_CATALOG_PATH)
  )
  const reportPath = absolute(
    workspaceRoot,
    stringOption(record, "traceabilityGateReportPath") ??
      config.get<string>("traceabilityGateReportPath", DEFAULT_TRACEABILITY_GATE_REPORT_PATH)
  )
  const textEncoding = stringOption(record, "textEncoding") ?? config.get<string>("textEncoding", "auto")
  const result = await openTraceabilityPrepWebview({ context, workspaceRoot, catalogPath, reportPath, textEncoding })
  if (result.status === "error") notifyError(`traceability prep を開けません: ${result.errors.join("; ")}`)
  else notifyInfo(`traceability prep を開きました: ${result.catalogPath}`)
  return result
}
