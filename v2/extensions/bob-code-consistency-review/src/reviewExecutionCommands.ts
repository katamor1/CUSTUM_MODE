import * as path from "node:path"
import * as vscode from "vscode"
import { captureBobOutput } from "./core/bobOutputCapture"
import { validateBobOutput } from "./core/bobOutputValidator"
import { preprocessReview } from "./core/pipeline"
import {
  absolute,
  firstString,
  notifyError,
  notifyInfo,
  notifyInfoWithReport,
  numberOption,
  optionalAbsolute,
  requireBobWorkspaceRoot,
  resolveTrustedBzrPath,
  stringOption
} from "./extensionCommandOptions"
import { generateHumanTriage } from "./triage/humanTriageHelper"
import { optionRecord } from "./workflowProviderRegistration"

export async function runPreprocess(options?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(options)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const inputPath = absolute(workspaceRoot, stringOption(record, "reviewInputPath") ?? config.get<string>("reviewInputPath", "review-input.yaml"))
  const outDir = absolute(
    workspaceRoot,
    stringOption(record, "reviewPackagePath") ??
      stringOption(record, "outDir") ??
      config.get<string>("reviewPackagePath", ".bob-review/review-package")
  )
  const diffFixturePath = optionalAbsolute(workspaceRoot, stringOption(record, "diffFixturePath"))
  const bzrPath = resolveTrustedBzrPath(record, config.get<string>("bzrPath", "bzr"))
  const textEncoding = stringOption(record, "textEncoding") ?? config.get<string>("textEncoding", "auto")
  const limits = {
    maxDocumentBytes: numberOption(record, "maxDocumentBytes") ?? config.get<number>("maxDocumentBytes"),
    maxWorkbookSheets: numberOption(record, "maxWorkbookSheets") ?? config.get<number>("maxWorkbookSheets"),
    maxRowsPerSheet: numberOption(record, "maxRowsPerSheet") ?? config.get<number>("maxRowsPerSheet"),
    maxExcerptBytesPerDocument: numberOption(record, "maxExcerptBytesPerDocument") ?? config.get<number>("maxExcerptBytesPerDocument"),
    maxRawDiffBytes: numberOption(record, "maxRawDiffBytes") ?? config.get<number>("maxRawDiffBytes"),
    maxBobInputBytes: numberOption(record, "maxBobInputBytes") ?? config.get<number>("maxBobInputBytes")
  }

  const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "コード整合レビュー用パッケージを作成しています" }, () =>
    preprocessReview({ workspaceRoot, inputPath, outDir, diffFixturePath, bzrPath, textEncoding, limits })
  )
  notifyInfoWithReport(result.summary, path.join(result.packageDir, "deterministic-checks.md"))
  return result
}

export async function runCaptureBobOutput(textOrOptions?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(textOrOptions)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const text = firstString(textOrOptions) ?? stringOption(record, "text") ?? await vscode.env.clipboard.readText()
  const bobOutputPath = absolute(
    workspaceRoot,
    stringOption(record, "bobOutputPath") ??
      config.get<string>("bobOutputPath", ".bob-review/bob-output/bob-output.yaml")
  )
  const packageDir = absolute(
    workspaceRoot,
    stringOption(record, "reviewPackagePath") ??
      stringOption(record, "packageDir") ??
      config.get<string>("reviewPackagePath", ".bob-review/review-package")
  )
  const result = await captureBobOutput({ workspaceRoot, text, bobOutputPath, packageDir })
  if (result.status === "ok") notifyInfo(result.message)
  else notifyError(result.message)
  return result
}

export async function runValidateOutput(options?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(options)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const packageDir = absolute(
    workspaceRoot,
    stringOption(record, "reviewPackagePath") ??
      stringOption(record, "packageDir") ??
      config.get<string>("reviewPackagePath", ".bob-review/review-package")
  )
  const bobOutputPath = absolute(
    workspaceRoot,
    stringOption(record, "bobOutputPath") ??
      config.get<string>("bobOutputPath", ".bob-review/bob-output/bob-output.yaml")
  )
  const result = await validateBobOutput({ packageDir, bobOutputPath })
  if (result.errors.length === 0) notifyInfo(`Bob 出力 YAML は有効です（warning: ${result.warnings.length} 件）。`)
  else notifyError(`Bob 出力 YAML が無効です: error ${result.errors.length} 件。`)
  return { status: result.errors.length === 0 ? "ok" : "error", ...result }
}

export async function runTriage(options?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(options)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const packageDir = absolute(
    workspaceRoot,
    stringOption(record, "reviewPackagePath") ??
      stringOption(record, "packageDir") ??
      config.get<string>("reviewPackagePath", ".bob-review/review-package")
  )
  const bobOutputPath = absolute(
    workspaceRoot,
    stringOption(record, "bobOutputPath") ??
      config.get<string>("bobOutputPath", ".bob-review/bob-output/bob-output.yaml")
  )
  const outDir = absolute(
    workspaceRoot,
    stringOption(record, "triagePath") ??
      stringOption(record, "outDir") ??
      config.get<string>("triagePath", ".bob-review/human-triage")
  )
  const result = await generateHumanTriage({ packageDir, bobOutputPath, outDir })
  if (result.status === "ok") notifyInfo(`人間確認用 triage ファイルを生成しました: ${outDir}`)
  else notifyError(result.message)
  return result
}
