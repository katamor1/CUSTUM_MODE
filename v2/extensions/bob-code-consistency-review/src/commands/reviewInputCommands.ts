import * as vscode from "vscode"
import { applyAiReviewInputDraft, prepareAiReviewInputDraftPrompt } from "../core/reviewInputAiDraftProvider"
import { writeReviewInputFromDraft } from "../core/reviewInputBuilder"
import { explainReviewInputDiagnostics, repairLegacyReviewInput } from "../core/reviewInputDiagnostics"
import { discoverReviewInputCandidates } from "../core/reviewInputDiscovery"
import {
  absolute,
  booleanOption,
  firstString,
  notifyError,
  notifyInfo,
  optionalAbsolute,
  requireBobWorkspaceRoot,
  resolveTrustedBzrPath,
  stringOption,
  stringOrPrompt,
  vcsOrPrompt
} from "../extensionCommandOptions"
import { collectReviewInputDraft } from "../reviewInputWizard"
import { optionRecord } from "../workflowProviderRegistration"

/**
 * Builds a review-input.yaml file from an interactive review input draft wizard.
 *
 * @param options Optional command or workflow options for workspace, output path, and text encoding.
 * @returns Review-input write result, or a cancelled status when the user aborts the wizard.
 */
export async function runCreateReviewInput(options?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(options)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const reviewInputPath = absolute(workspaceRoot, stringOption(record, "reviewInputPath") ?? config.get<string>("reviewInputPath", "review-input.yaml"))
  const textEncoding = stringOption(record, "textEncoding") ?? config.get<string>("textEncoding", "auto")

  const discovery = await discoverReviewInputCandidates(workspaceRoot, { textEncoding })
  const draft = await collectReviewInputDraft(discovery.documents)
  if (!draft) return { status: "cancelled" }

  const result = await writeReviewInputFromDraft({
    draft,
    workspaceRoot,
    outputPath: reviewInputPath,
    overwrite: true,
    backupExisting: true,
    strictPaths: true
  })

  if (result.status === "error") {
    notifyError(`review-input.yaml を生成できません: ${result.errors.join("; ")}`)
    return result
  }

  const backup = result.backupPath ? `\n既存ファイルのバックアップ: ${result.backupPath}` : ""
  const warnings = [...discovery.warnings, ...result.warnings]
  notifyInfo(`review-input.yaml を生成しました: ${result.outputPath}${backup}${warnings.length > 0 ? `\nwarning: ${warnings.length} 件` : ""}`)
  return { ...result, discoveryWarnings: discovery.warnings }
}

/**
 * Creates an AI prompt package for drafting review-input.yaml from VCS revisions.
 *
 * @param options Optional command or workflow options for revisions, VCS, paths, and text encoding.
 * @returns Prompt-generation result including the written prompt path and warnings.
 */
export async function runPrepareAiReviewInputDraft(options?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(options)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const reviewInputPath = absolute(workspaceRoot, stringOption(record, "reviewInputPath") ?? config.get<string>("reviewInputPath", "review-input.yaml"))
  const outputDir = absolute(workspaceRoot, stringOption(record, "aiDraftPromptPath") ?? ".bob-review/review-input-draft")
  const textEncoding = stringOption(record, "textEncoding") ?? config.get<string>("textEncoding", "auto")
  const base = await stringOrPrompt(record, "base", "AI draft 用の base revision", "HEAD~1")
  if (!base) return { status: "cancelled" }
  const head = await stringOrPrompt(record, "head", "AI draft 用の head revision", "HEAD")
  if (!head) return { status: "cancelled" }
  const vcs = await vcsOrPrompt(record)
  if (!vcs) return { status: "cancelled" }

  const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "AI draft 用プロンプトを作成しています" }, () =>
    prepareAiReviewInputDraftPrompt({
      workspaceRoot,
      outputDir,
      reviewInputPath,
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
  notifyInfo(`AI draft 用プロンプトを作成して clipboard にコピーしました: ${result.promptPath}${result.warnings.length > 0 ? `\nwarning: ${result.warnings.length} 件` : ""}`)
  return result
}

/**
 * Applies AI-generated draft JSON to produce or update review-input.yaml.
 *
 * @param textOrOptions Draft JSON text, or command/workflow options containing text and path overrides.
 * @returns Draft-application result including errors, warnings, and output path metadata.
 */
export async function runApplyAiReviewInputDraft(textOrOptions?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(textOrOptions)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const reviewInputPath = absolute(workspaceRoot, stringOption(record, "reviewInputPath") ?? config.get<string>("reviewInputPath", "review-input.yaml"))
  const text = firstString(textOrOptions) ?? stringOption(record, "text") ?? await vscode.env.clipboard.readText()
  const result = await applyAiReviewInputDraft({
    workspaceRoot,
    reviewInputPath,
    text,
    strictPaths: booleanOption(record, "strictPaths") ?? true
  })

  if (result.status === "error") {
    notifyError(`AI draft JSON を review-input.yaml に変換できません: ${result.errors.join("; ")}`)
    return result
  }

  const backup = result.backupPath ? `\n既存ファイルのバックアップ: ${result.backupPath}` : ""
  const warningSuffix = result.warnings.length > 0 ? `\nwarning: ${result.warnings.length} 件` : ""
  notifyInfo(`AI draft JSON から review-input.yaml を生成しました: ${result.outputPath}${backup}${warningSuffix}`)
  return result
}

/**
 * Repairs legacy or invalid review-input.yaml content using the configured diagnostics repair path.
 *
 * @param options Optional command or workflow options for workspace, input path, and text encoding.
 * @returns Repair result including status, message, and optional backup path.
 */
export async function runRepairReviewInput(options?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(options)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const inputPath = absolute(workspaceRoot, stringOption(record, "reviewInputPath") ?? config.get<string>("reviewInputPath", "review-input.yaml"))
  const textEncoding = stringOption(record, "textEncoding") ?? config.get<string>("textEncoding", "auto")
  const result = await repairLegacyReviewInput({ inputPath, workspaceRoot, textEncoding })
  if (result.status === "error") notifyError(result.message)
  else notifyInfo(`${result.message}${result.backupPath ? `\nバックアップ: ${result.backupPath}` : ""}`)
  return result
}

/**
 * Explains diagnostics found in review-input.yaml for command and workflow consumers.
 *
 * @param options Optional command or workflow options for workspace, input path, and text encoding.
 * @returns Diagnostic explanation result including status, message, and diagnostic details.
 */
export async function runExplainReviewInputDiagnostics(options?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(options)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const inputPath = absolute(workspaceRoot, stringOption(record, "reviewInputPath") ?? config.get<string>("reviewInputPath", "review-input.yaml"))
  const textEncoding = stringOption(record, "textEncoding") ?? config.get<string>("textEncoding", "auto")
  const result = await explainReviewInputDiagnostics({ inputPath, workspaceRoot, textEncoding })
  if (result.status === "ok") notifyInfo(result.message)
  else notifyError(`${result.message}\n${result.diagnostics.slice(0, 5).join("\n")}`)
  return result
}
