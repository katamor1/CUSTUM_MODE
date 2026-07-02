import * as vscode from "vscode"
import { applyAiReviewInputDraft, prepareAiReviewInputDraftPrompt } from "./core/reviewInputAiDraftProvider"
import { discoverReviewInputCandidates } from "./core/reviewInputDiscovery"
import { writeReviewInputFromDraft } from "./core/reviewInputBuilder"
import { explainReviewInputDiagnostics, repairLegacyReviewInput } from "./core/reviewInputDiagnostics"
import {
  absolute,
  booleanOption,
  firstString,
  notifyError,
  notifyInfo,
  optionalAbsolute,
  requireBobWorkspaceRoot,
  stringOption,
  stringOrPrompt,
  vcsOrPrompt
} from "./extensionCommandOptions"
import { collectReviewInputDraft } from "./reviewInputWizard"
import {
  runCaptureBobOutput,
  runPreprocess,
  runTriage,
  runValidateOutput
} from "./reviewExecutionCommands"
import {
  runApplyAiTraceabilityDraft,
  runCreateReviewInputFromTraceability,
  runOpenTraceabilityPrep,
  runPrepareAiTraceabilityDraft,
  runValidateTraceabilityCatalog
} from "./traceabilityCommands"
import { optionRecord, registerWorkflowProviders } from "./workflowProviderRegistration"
import { initializeCodeConsistencyWorkspace } from "./workspaceInitializer"

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "bobCodeConsistency.initializeWorkspace",
      (options?: unknown) => runInitializeWorkspace(context, options)
    ),
    vscode.commands.registerCommand(
      "bobCodeConsistency.createReviewInput",
      (options?: unknown) => runCreateReviewInput(options)
    ),
    vscode.commands.registerCommand(
      "bobCodeConsistency.prepareAiReviewInputDraft",
      (options?: unknown) => runPrepareAiReviewInputDraft(options)
    ),
    vscode.commands.registerCommand(
      "bobCodeConsistency.applyAiReviewInputDraft",
      (textOrOptions?: unknown) => runApplyAiReviewInputDraft(textOrOptions)
    ),
    vscode.commands.registerCommand(
      "bobCodeConsistency.prepareAiTraceabilityDraft",
      (options?: unknown) => runPrepareAiTraceabilityDraft(options)
    ),
    vscode.commands.registerCommand(
      "bobCodeConsistency.applyAiTraceabilityDraft",
      (textOrOptions?: unknown) => runApplyAiTraceabilityDraft(textOrOptions)
    ),
    vscode.commands.registerCommand(
      "bobCodeConsistency.openTraceabilityPrep",
      (options?: unknown) => runOpenTraceabilityPrep(context, options)
    ),
    vscode.commands.registerCommand(
      "bobCodeConsistency.validateTraceabilityCatalog",
      (options?: unknown) => runValidateTraceabilityCatalog(options)
    ),
    vscode.commands.registerCommand(
      "bobCodeConsistency.createReviewInputFromTraceability",
      (options?: unknown) => runCreateReviewInputFromTraceability(options)
    ),
    vscode.commands.registerCommand(
      "bobCodeConsistency.repairReviewInput",
      (options?: unknown) => runRepairReviewInput(options)
    ),
    vscode.commands.registerCommand(
      "bobCodeConsistency.explainReviewInputDiagnostics",
      (options?: unknown) => runExplainReviewInputDiagnostics(options)
    ),
    vscode.commands.registerCommand("bobCodeConsistency.preprocess", (options?: unknown) => runPreprocess(options)),
    vscode.commands.registerCommand(
      "bobCodeConsistency.captureBobOutput",
      (textOrOptions?: unknown) => runCaptureBobOutput(textOrOptions)
    ),
    vscode.commands.registerCommand("bobCodeConsistency.validateOutput", (options?: unknown) => runValidateOutput(options)),
    vscode.commands.registerCommand("bobCodeConsistency.triage", (options?: unknown) => runTriage(options))
  )

  registerWorkflowProviders({
    initializeWorkspace: (options) => runInitializeWorkspace(context, options),
    createReviewInput: runCreateReviewInput,
    prepareAiReviewInputDraft: runPrepareAiReviewInputDraft,
    applyAiReviewInputDraft: runApplyAiReviewInputDraft,
    prepareAiTraceabilityDraft: runPrepareAiTraceabilityDraft,
    applyAiTraceabilityDraft: runApplyAiTraceabilityDraft,
    openTraceabilityPrep: (options) => runOpenTraceabilityPrep(context, options),
    validateTraceabilityCatalog: runValidateTraceabilityCatalog,
    createReviewInputFromTraceability: runCreateReviewInputFromTraceability,
    repairReviewInput: runRepairReviewInput,
    explainReviewInputDiagnostics: runExplainReviewInputDiagnostics,
    preprocess: runPreprocess,
    captureBobOutput: runCaptureBobOutput,
    validateOutput: runValidateOutput,
    triage: runTriage
  }).catch((error) => console.warn("Bob コード整合ワークフロー provider の登録に失敗しました", error))
}

export function deactivate(): void {
  // No background resources are held by this extension.
}

async function runInitializeWorkspace(context: vscode.ExtensionContext, options?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(options)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const reviewInputPath = stringOption(record, "reviewInputPath") ?? config.get<string>("reviewInputPath", "review-input.yaml")
  const result = await initializeCodeConsistencyWorkspace({ context, workspaceRoot, reviewInputPath })
  const suffix = result.backupPath ? `\n既存 workflow ファイルのバックアップ: ${result.backupPath}` : ""
  notifyInfo(`${result.message}${suffix}`)
  return result
}

async function runCreateReviewInput(options?: unknown): Promise<unknown> {
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

async function runPrepareAiReviewInputDraft(options?: unknown): Promise<unknown> {
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
      bzrPath: stringOption(record, "bzrPath") ?? config.get<string>("bzrPath", "bzr"),
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

async function runApplyAiReviewInputDraft(textOrOptions?: unknown): Promise<unknown> {
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

async function runRepairReviewInput(options?: unknown): Promise<unknown> {
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

async function runExplainReviewInputDiagnostics(options?: unknown): Promise<unknown> {
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
