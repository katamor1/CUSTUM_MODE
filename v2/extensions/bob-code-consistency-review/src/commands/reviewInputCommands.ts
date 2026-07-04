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
 * 対話式 wizard の draft から review-input.yaml を生成する。
 *
 * 生成前に artifact path を workspace 内へ閉じ込め、既存 file は builder 側で backup する。
 *
 * @param options workspace、出力 path、text encoding を上書きし得る command / workflow options。
 * @returns review-input の write result。ユーザーが wizard を中止した場合は cancelled status。
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
 * VCS revision から review-input.yaml draft 用の AI prompt package を作成する。
 *
 * revision と diff path は後段 collector で検証し、workflow args から bzrPath は上書きさせない。
 *
 * @param options revision、VCS、path、text encoding を上書きし得る command / workflow options。
 * @returns 書き込んだ prompt path と warning を含む prompt-generation result。
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
 * AI 生成 draft JSON から review-input.yaml を作成または更新する。
 *
 * AI は候補 draft を出すだけで、schema validation と workspace path 境界は host 側で再検証する。
 *
 * @param textOrOptions draft JSON text、または text / path override を含む command / workflow options。
 * @returns error、warning、output path metadata を含む draft-application result。
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
 * legacy または invalid な review-input.yaml を diagnostics repair path で修復する。
 *
 * repair は互換性維持の救済処理であり、過補正を避けるため結果と backup path を呼び出し元へ返す。
 *
 * @param options workspace、input path、text encoding を上書きし得る command / workflow options。
 * @returns status、message、任意の backup path を含む repair result。
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
 * review-input.yaml の diagnostics を command / workflow consumer 向けに説明する。
 *
 * この command は説明専用で、入力 file の修正や生成物の書き込みは行わない。
 *
 * @param options workspace、input path、text encoding を上書きし得る command / workflow options。
 * @returns status、message、diagnostic details を含む explanation result。
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
