import * as path from "node:path"
import * as vscode from "vscode"
import { captureBobOutput } from "./core/bobOutputCapture"
import { validateBobOutput } from "./core/bobOutputValidator"
import { preprocessReview } from "./core/pipeline"
import { applyAiReviewInputDraft, prepareAiReviewInputDraftPrompt } from "./core/reviewInputAiDraftProvider"
import { discoverReviewInputCandidates, type ReviewInputDocumentCandidate } from "./core/reviewInputDiscovery"
import { ARTIFACT_KIND_VALUES, CHANGE_TYPE_VALUES, REVIEW_FOCUS_VALUES, VCS_VALUES, writeReviewInputFromDraft, type ArtifactKind, type ChangeType, type ReviewFocus, type ReviewInputArtifactDraft, type ReviewInputDraft, type VcsKind } from "./core/reviewInputBuilder"
import { explainReviewInputDiagnostics, repairLegacyReviewInput } from "./core/reviewInputDiagnostics"
import { applyAiTraceabilityDraft, prepareAiTraceabilityDraftPrompt } from "./core/traceabilityAiDraftProvider"
import { buildReviewInputDraftFromTraceability } from "./core/traceabilityCatalog"
import { DEFAULT_TRACEABILITY_CATALOG_PATH, DEFAULT_TRACEABILITY_GATE_REPORT_PATH, readTraceabilityCatalog, validateAndWriteTraceabilityGateReport } from "./core/traceabilityCatalogStore"
import { generateHumanTriage } from "./triage/humanTriageHelper"
import { openTraceabilityPrepWebview } from "./webview/traceabilityPrepWebview"
import { buildCaptureWorkflowOptions } from "./workflowOptions"
import { initializeCodeConsistencyWorkspace } from "./workspaceInitializer"
import { resolveBobWorkspaceRoot } from "./workspaceResolver"

const WORKFLOW_REGISTER_EXTENSION_ID = "local.workflow-register"

interface WorkflowActionExecutionInput {
  args: unknown
  inputs: Record<string, unknown>
  state?: Record<string, string>
  workflowId?: string
  logicalWorkflowId?: string
  workflowRoot?: string
  workflowFile?: string
  workflowFolderName?: string
  bobRoot?: string
  workspaceRoot?: string
  runId?: string
  stepId?: string
}

interface WorkflowActionProvider {
  id: string
  execute: (input: WorkflowActionExecutionInput) => Promise<unknown> | unknown
}

interface WorkflowRegisterApi {
  registerActionProvider: (provider: WorkflowActionProvider) => void
}

type CandidateQuickPickItem = vscode.QuickPickItem & { candidate: ReviewInputDocumentCandidate }

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("bobCodeConsistency.initializeWorkspace", (options?: unknown) => runInitializeWorkspace(context, options)),
    vscode.commands.registerCommand("bobCodeConsistency.createReviewInput", (options?: unknown) => runCreateReviewInput(options)),
    vscode.commands.registerCommand("bobCodeConsistency.prepareAiReviewInputDraft", (options?: unknown) => runPrepareAiReviewInputDraft(options)),
    vscode.commands.registerCommand("bobCodeConsistency.applyAiReviewInputDraft", (textOrOptions?: unknown) => runApplyAiReviewInputDraft(textOrOptions)),
    vscode.commands.registerCommand("bobCodeConsistency.prepareAiTraceabilityDraft", (options?: unknown) => runPrepareAiTraceabilityDraft(options)),
    vscode.commands.registerCommand("bobCodeConsistency.applyAiTraceabilityDraft", (textOrOptions?: unknown) => runApplyAiTraceabilityDraft(textOrOptions)),
    vscode.commands.registerCommand("bobCodeConsistency.openTraceabilityPrep", (options?: unknown) => runOpenTraceabilityPrep(context, options)),
    vscode.commands.registerCommand("bobCodeConsistency.validateTraceabilityCatalog", (options?: unknown) => runValidateTraceabilityCatalog(options)),
    vscode.commands.registerCommand("bobCodeConsistency.createReviewInputFromTraceability", (options?: unknown) => runCreateReviewInputFromTraceability(options)),
    vscode.commands.registerCommand("bobCodeConsistency.repairReviewInput", (options?: unknown) => runRepairReviewInput(options)),
    vscode.commands.registerCommand("bobCodeConsistency.explainReviewInputDiagnostics", (options?: unknown) => runExplainReviewInputDiagnostics(options)),
    vscode.commands.registerCommand("bobCodeConsistency.preprocess", (options?: unknown) => runPreprocess(options)),
    vscode.commands.registerCommand("bobCodeConsistency.captureBobOutput", (textOrOptions?: unknown) => runCaptureBobOutput(textOrOptions)),
    vscode.commands.registerCommand("bobCodeConsistency.validateOutput", (options?: unknown) => runValidateOutput(options)),
    vscode.commands.registerCommand("bobCodeConsistency.triage", (options?: unknown) => runTriage(options))
  )
  registerWorkflowProviders(context).catch((error) => console.warn("Bob コード整合ワークフロー provider の登録に失敗しました", error))
}

export function deactivate(): void {
  // No background resources are held by this extension.
}

async function registerWorkflowProviders(context: vscode.ExtensionContext): Promise<void> {
  const api = await getWorkflowRegisterApi()
  if (!api) return
  api.registerActionProvider({
    id: "bobCodeConsistency.initializeWorkspace",
    execute: (input) => runInitializeWorkspace(context, mergeWorkflowOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.createReviewInput",
    execute: (input) => runCreateReviewInput(mergeWorkflowOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.prepareAiReviewInputDraft",
    execute: (input) => runPrepareAiReviewInputDraft(mergeWorkflowOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.applyAiReviewInputDraft",
    execute: (input) => runApplyAiReviewInputDraft(mergeWorkflowOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.prepareAiTraceabilityDraft",
    execute: (input) => runPrepareAiTraceabilityDraft(mergeWorkflowOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.applyAiTraceabilityDraft",
    execute: (input) => runApplyAiTraceabilityDraft(mergeWorkflowOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.openTraceabilityPrep",
    execute: (input) => runOpenTraceabilityPrep(context, mergeWorkflowOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.validateTraceabilityCatalog",
    execute: (input) => runValidateTraceabilityCatalog(mergeWorkflowOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.createReviewInputFromTraceability",
    execute: (input) => runCreateReviewInputFromTraceability(mergeWorkflowOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.repairReviewInput",
    execute: (input) => runRepairReviewInput(mergeWorkflowOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.explainReviewInputDiagnostics",
    execute: (input) => runExplainReviewInputDiagnostics(mergeWorkflowOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.preprocess",
    execute: (input) => runPreprocess(mergeWorkflowOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.captureBobOutput",
    execute: (input) => {
      const { args, inputs, state } = input
      return runCaptureBobOutput({ ...optionRecord(buildCaptureWorkflowOptions({ args, inputs, state })), ...workflowContextOptions(input) })
    }
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.validateOutput",
    execute: (input) => runValidateOutput(mergeWorkflowOptions(input))
  })
  api.registerActionProvider({
    id: "bobCodeConsistency.triage",
    execute: (input) => runTriage(mergeWorkflowOptions(input))
  })
}

async function getWorkflowRegisterApi(): Promise<WorkflowRegisterApi | undefined> {
  const extension = vscode.extensions.getExtension<WorkflowRegisterApi>(WORKFLOW_REGISTER_EXTENSION_ID)
  if (!extension) {
    console.warn(`workflow-register 拡張機能が見つかりません: ${WORKFLOW_REGISTER_EXTENSION_ID}`)
    return undefined
  }
  const api = extension.isActive ? extension.exports : await extension.activate()
  if (!api?.registerActionProvider) {
    console.warn(`workflow-register 拡張機能が registerActionProvider を公開していません: ${WORKFLOW_REGISTER_EXTENSION_ID}`)
    return undefined
  }
  return api
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
  notifyInfo(`AI draft JSON から review-input.yaml を生成しました: ${result.outputPath}${backup}${result.warnings.length > 0 ? `\nwarning: ${result.warnings.length} 件` : ""}`)
  return result
}

async function runPrepareAiTraceabilityDraft(options?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(options)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const catalogPath = absolute(workspaceRoot, stringOption(record, "traceabilityCatalogPath") ?? config.get<string>("traceabilityCatalogPath", DEFAULT_TRACEABILITY_CATALOG_PATH))
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
  notifyInfo(`traceability AI draft 用プロンプトを作成して clipboard にコピーしました: ${result.promptPath}${result.warnings.length > 0 ? `\nwarning: ${result.warnings.length} 件` : ""}`)
  return result
}

async function runApplyAiTraceabilityDraft(textOrOptions?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(textOrOptions)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const catalogPath = absolute(workspaceRoot, stringOption(record, "traceabilityCatalogPath") ?? config.get<string>("traceabilityCatalogPath", DEFAULT_TRACEABILITY_CATALOG_PATH))
  const reportPath = absolute(workspaceRoot, stringOption(record, "traceabilityGateReportPath") ?? config.get<string>("traceabilityGateReportPath", DEFAULT_TRACEABILITY_GATE_REPORT_PATH))
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

async function runValidateTraceabilityCatalog(options?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(options)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const catalogPath = absolute(workspaceRoot, stringOption(record, "traceabilityCatalogPath") ?? config.get<string>("traceabilityCatalogPath", DEFAULT_TRACEABILITY_CATALOG_PATH))
  const reportPath = absolute(workspaceRoot, stringOption(record, "traceabilityGateReportPath") ?? config.get<string>("traceabilityGateReportPath", DEFAULT_TRACEABILITY_GATE_REPORT_PATH))
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

async function runCreateReviewInputFromTraceability(options?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(options)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const catalogPath = absolute(workspaceRoot, stringOption(record, "traceabilityCatalogPath") ?? config.get<string>("traceabilityCatalogPath", DEFAULT_TRACEABILITY_CATALOG_PATH))
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
    const reportPath = absolute(workspaceRoot, stringOption(record, "traceabilityGateReportPath") ?? config.get<string>("traceabilityGateReportPath", DEFAULT_TRACEABILITY_GATE_REPORT_PATH))
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
  notifyInfo(`traceability catalog から review-input.yaml を生成しました: ${result.outputPath}${backup}${build.warnings.length > 0 ? `\ntraceability warning: ${build.warnings.length} 件` : ""}`)
  return { ...result, traceabilityWarnings: build.warnings }
}

async function runOpenTraceabilityPrep(context: vscode.ExtensionContext, options?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(options)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const catalogPath = absolute(workspaceRoot, stringOption(record, "traceabilityCatalogPath") ?? config.get<string>("traceabilityCatalogPath", DEFAULT_TRACEABILITY_CATALOG_PATH))
  const reportPath = absolute(workspaceRoot, stringOption(record, "traceabilityGateReportPath") ?? config.get<string>("traceabilityGateReportPath", DEFAULT_TRACEABILITY_GATE_REPORT_PATH))
  const textEncoding = stringOption(record, "textEncoding") ?? config.get<string>("textEncoding", "auto")
  const result = await openTraceabilityPrepWebview({ context, workspaceRoot, catalogPath, reportPath, textEncoding })
  if (result.status === "error") notifyError(`traceability prep を開けません: ${result.errors.join("; ")}`)
  else notifyInfo(`traceability prep を開きました: ${result.catalogPath}`)
  return result
}

async function collectReviewMetadata(record: Record<string, unknown>): Promise<ReviewInputDraft["review"] | undefined> {
  const id = stringOption(record, "reviewId") ?? await stringOrPrompt(record, "id", "review.id", "code-consistency-review")
  if (!id) return undefined
  const title = stringOption(record, "title") ?? await stringOrPrompt(record, "reviewTitle", "review.title", "コード整合プレレビュー")
  if (!title) return undefined
  const purpose = stringOption(record, "purpose") ?? await stringOrPrompt(record, "reviewPurpose", "review.purpose", "要求・設計・テスト仕様とコード変更の整合性を確認する")
  if (!purpose) return undefined

  const changeType = changeTypeOption(record) ?? await pickValue(CHANGE_TYPE_VALUES, "変更種別を選択")
  if (!changeType) return undefined
  const vcs = await vcsOrPrompt(record)
  if (!vcs) return undefined
  const base = await stringOrPrompt(record, "base", "review.base", "HEAD~1")
  if (!base) return undefined
  const head = await stringOrPrompt(record, "head", "review.head", "HEAD")
  if (!head) return undefined

  return {
    id,
    title,
    purpose,
    change_type: changeType,
    vcs,
    base,
    head,
    vcs_root: stringOption(record, "vcsRoot") ?? stringOption(record, "vcs_root"),
    ticket_ids: stringArrayOption(record, "ticketIds") ?? stringArrayOption(record, "ticket_ids"),
    out_of_scope: stringArrayOption(record, "outOfScope") ?? stringArrayOption(record, "out_of_scope")
  }
}

async function collectReviewInputDraft(candidates: ReviewInputDocumentCandidate[]): Promise<ReviewInputDraft | undefined> {
  const id = await vscode.window.showInputBox({ prompt: "review.id", placeHolder: "timeout-bugfix-r1", value: "code-consistency-review" })
  if (id === undefined) return undefined
  const title = await vscode.window.showInputBox({ prompt: "review.title", placeHolder: "タイムアウト処理修正の整合プレレビュー", value: "コード整合プレレビュー" })
  if (title === undefined) return undefined
  const purpose = await vscode.window.showInputBox({ prompt: "review.purpose", placeHolder: "変更目的を短く入力", value: "要求・設計・テスト仕様とコード変更の整合性を確認する" })
  if (purpose === undefined) return undefined

  const changeType = await pickValue(CHANGE_TYPE_VALUES, "変更種別を選択")
  if (!changeType) return undefined
  const vcs = await pickValue(VCS_VALUES, "VCS を選択")
  if (!vcs) return undefined
  const base = await vscode.window.showInputBox({ prompt: "review.base", value: "HEAD~1" })
  if (base === undefined) return undefined
  const head = await vscode.window.showInputBox({ prompt: "review.head", value: "HEAD" })
  if (head === undefined) return undefined

  const focusItems = REVIEW_FOCUS_VALUES.map((focus) => ({ label: focus }))
  const pickedFocus = await vscode.window.showQuickPick(focusItems, { canPickMany: true, placeHolder: "レビュー観点を選択" })
  if (!pickedFocus || pickedFocus.length === 0) return undefined

  const artifacts = await pickArtifacts(candidates)
  if (!artifacts || artifacts.length === 0) return undefined

  const ticketRaw = await vscode.window.showInputBox({ prompt: "ticket_ids（任意、カンマ区切り）", placeHolder: "BUG-1234,TICKET-5678" })
  if (ticketRaw === undefined) return undefined
  const outOfScopeRaw = await vscode.window.showInputBox({ prompt: "out_of_scope（任意、カンマ区切り）", placeHolder: "性能測定, UI 文言レビュー" })
  if (outOfScopeRaw === undefined) return undefined

  return {
    review: {
      id,
      title,
      purpose,
      change_type: changeType as ChangeType,
      vcs: vcs as VcsKind,
      base,
      head,
      ticket_ids: splitCsv(ticketRaw),
      out_of_scope: splitCsv(outOfScopeRaw)
    },
    artifact_candidates: artifacts,
    review_focus: pickedFocus.map((item) => item.label as ReviewFocus)
  }
}

async function pickArtifacts(candidates: ReviewInputDocumentCandidate[]): Promise<ReviewInputArtifactDraft[] | undefined> {
  if (candidates.length > 0) {
    const items: CandidateQuickPickItem[] = candidates.map((candidate) => ({
      label: candidate.label,
      description: candidate.description,
      detail: `${candidate.kind}: ${candidate.path}`,
      candidate
    }))
    const picked = await vscode.window.showQuickPick(items, { canPickMany: true, placeHolder: "関連文書候補を選択" })
    if (!picked || picked.length === 0) return undefined
    return picked.map((item) => stripCandidateUiFields(item.candidate))
  }

  const artifactPath = await vscode.window.showInputBox({ prompt: "関連文書パスを入力", placeHolder: "docs/requirements.md" })
  if (artifactPath === undefined) return undefined
  const kind = await pickValue(ARTIFACT_KIND_VALUES, "文書種別を選択")
  if (!kind) return undefined
  return [{ kind: kind as ArtifactKind, path: artifactPath }]
}

function stripCandidateUiFields(candidate: ReviewInputDocumentCandidate): ReviewInputArtifactDraft {
  const { label: _label, description: _description, ...artifact } = candidate
  return artifact
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

async function runPreprocess(options?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(options)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const inputPath = absolute(workspaceRoot, stringOption(record, "reviewInputPath") ?? config.get<string>("reviewInputPath", "review-input.yaml"))
  const outDir = absolute(workspaceRoot, stringOption(record, "reviewPackagePath") ?? stringOption(record, "outDir") ?? config.get<string>("reviewPackagePath", ".bob-review/review-package"))
  const diffFixturePath = optionalAbsolute(workspaceRoot, stringOption(record, "diffFixturePath"))
  const bzrPath = stringOption(record, "bzrPath") ?? config.get<string>("bzrPath", "bzr")
  const textEncoding = stringOption(record, "textEncoding") ?? config.get<string>("textEncoding", "auto")

  const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "コード整合レビュー用パッケージを作成しています" }, () =>
    preprocessReview({ workspaceRoot, inputPath, outDir, diffFixturePath, bzrPath, textEncoding })
  )
  notifyInfo(result.summary)
  return result
}

async function runCaptureBobOutput(textOrOptions?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(textOrOptions)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const text = firstString(textOrOptions) ?? stringOption(record, "text") ?? await vscode.env.clipboard.readText()
  const bobOutputPath = absolute(workspaceRoot, stringOption(record, "bobOutputPath") ?? config.get<string>("bobOutputPath", ".bob-review/bob-output/bob-output.yaml"))
  const packageDir = absolute(workspaceRoot, stringOption(record, "reviewPackagePath") ?? stringOption(record, "packageDir") ?? config.get<string>("reviewPackagePath", ".bob-review/review-package"))
  const result = await captureBobOutput({ workspaceRoot, text, bobOutputPath, packageDir })
  if (result.status === "ok") notifyInfo(result.message)
  else notifyError(result.message)
  return result
}

async function runValidateOutput(options?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(options)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const packageDir = absolute(workspaceRoot, stringOption(record, "reviewPackagePath") ?? stringOption(record, "packageDir") ?? config.get<string>("reviewPackagePath", ".bob-review/review-package"))
  const bobOutputPath = absolute(workspaceRoot, stringOption(record, "bobOutputPath") ?? config.get<string>("bobOutputPath", ".bob-review/bob-output/bob-output.yaml"))
  const result = await validateBobOutput({ packageDir, bobOutputPath })
  if (result.errors.length === 0) notifyInfo(`Bob 出力 YAML は有効です（warning: ${result.warnings.length} 件）。`)
  else notifyError(`Bob 出力 YAML が無効です: error ${result.errors.length} 件。`)
  return { status: result.errors.length === 0 ? "ok" : "error", ...result }
}

async function runTriage(options?: unknown): Promise<unknown> {
  const config = vscode.workspace.getConfiguration("bobCodeConsistency")
  const record = optionRecord(options)
  const workspaceRoot = await requireBobWorkspaceRoot(record)
  const packageDir = absolute(workspaceRoot, stringOption(record, "reviewPackagePath") ?? stringOption(record, "packageDir") ?? config.get<string>("reviewPackagePath", ".bob-review/review-package"))
  const bobOutputPath = absolute(workspaceRoot, stringOption(record, "bobOutputPath") ?? config.get<string>("bobOutputPath", ".bob-review/bob-output/bob-output.yaml"))
  const outDir = absolute(workspaceRoot, stringOption(record, "triagePath") ?? stringOption(record, "outDir") ?? config.get<string>("triagePath", ".bob-review/human-triage"))
  const result = await generateHumanTriage({ packageDir, bobOutputPath, outDir })
  if (result.status === "ok") notifyInfo(`人間確認用 triage ファイルを生成しました: ${outDir}`)
  else notifyError(result.message)
  return result
}

function notifyInfo(message: string): void {
  console.info(message)
  vscode.window.setStatusBarMessage(message, 5000)
}

function notifyError(message: string): void {
  void vscode.window.showErrorMessage(message)
}

async function requireBobWorkspaceRoot(record: Record<string, unknown>): Promise<string> {
  const root = await resolveBobWorkspaceRoot({
    explicitRoot: stringOption(record, "bobRoot") ?? stringOption(record, "workspaceRoot"),
    workflowRoot: stringOption(record, "workflowRoot"),
    allowPick: true,
    title: "Bob ワークスペースを選択"
  })
  if (!root) throw new Error("先にワークスペースフォルダーを開いてください。")
  return root
}

async function pickValue<const T extends string>(values: readonly T[], placeHolder: string): Promise<T | undefined> {
  const picked = await vscode.window.showQuickPick(values.map((value) => ({ label: value })), { placeHolder })
  return picked?.label as T | undefined
}

async function stringOrPrompt(record: Record<string, unknown>, key: string, prompt: string, value: string): Promise<string | undefined> {
  const existing = stringOption(record, key)
  if (existing) return existing
  return vscode.window.showInputBox({ prompt, value })
}

async function vcsOrPrompt(record: Record<string, unknown>): Promise<VcsKind | undefined> {
  const existing = stringOption(record, "vcs")
  if (existing && (VCS_VALUES as readonly string[]).includes(existing)) return existing as VcsKind
  return pickValue(VCS_VALUES, "AI draft 用の VCS を選択")
}

function changeTypeOption(record: Record<string, unknown>): ChangeType | undefined {
  const existing = stringOption(record, "changeType") ?? stringOption(record, "change_type")
  if (existing && (CHANGE_TYPE_VALUES as readonly string[]).includes(existing)) return existing as ChangeType
  return undefined
}

function reviewFocusOption(record: Record<string, unknown>): ReviewFocus[] | undefined {
  const values = stringArrayOption(record, "reviewFocus") ?? stringArrayOption(record, "review_focus")
  if (!values) return undefined
  const result = values.filter((value): value is ReviewFocus => (REVIEW_FOCUS_VALUES as readonly string[]).includes(value))
  return result.length > 0 ? result : undefined
}

function stringArrayOption(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key]
  if (Array.isArray(value)) {
    const result = value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean)
    return result.length > 0 ? result : undefined
  }
  if (typeof value === "string" && value.trim()) return splitCsv(value)
  return undefined
}

function splitCsv(value: string): string[] | undefined {
  const result = value.split(",").map((item) => item.trim()).filter(Boolean)
  return result.length > 0 ? result : undefined
}

function absolute(root: string, value: string): string {
  return path.isAbsolute(value) ? value : path.join(root, value)
}

function optionalAbsolute(root: string, value: string | undefined): string | undefined {
  return value ? absolute(root, value) : undefined
}

function mergeOptions(inputs: Record<string, unknown>, args: unknown): Record<string, unknown> {
  return { ...inputs, ...optionRecord(args) }
}

function mergeWorkflowOptions(input: WorkflowActionExecutionInput): Record<string, unknown> {
  return { ...mergeOptions(input.inputs, input.args), ...workflowContextOptions(input) }
}

function workflowContextOptions(input: WorkflowActionExecutionInput): Record<string, unknown> {
  return {
    workflowRoot: input.workflowRoot,
    workflowFile: input.workflowFile,
    workflowFolderName: input.workflowFolderName,
    bobRoot: input.bobRoot,
    workspaceRoot: input.workspaceRoot
  }
}

function optionRecord(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return optionRecord(value[0])
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
}

function stringOption(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function booleanOption(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key]
  return typeof value === "boolean" ? value : undefined
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item)
      if (found) return found
    }
  }
  return undefined
}
