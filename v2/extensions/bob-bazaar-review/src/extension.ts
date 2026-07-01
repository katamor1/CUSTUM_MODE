import * as vscode from "vscode"
import { BazaarClient } from "./bazaar"
import { isBobCodeExtensionAvailable } from "./bobCodeExtension"
import { addMarkdownPacketToBobContext } from "./bobContext"
import { configureWorkspaceMcpServer } from "./mcpConfig"
import { buildReviewPacket } from "./reviewPacket"
import { initializeProjectRules, loadProjectChecklist, loadProjectChecklistRequired, loadReviewResultSchema, loadReviewResultSchemaRequired } from "./projectRules/io"
import { buildProjectRulesSection } from "./projectRules/packet"
import { validateReviewResultJson } from "./projectRules/validator"
import { renderReviewResultMarkdown } from "./projectRules/markdown"
import { captureReviewResult, saveReviewResultFromClipboard } from "./projectRules/resultCapture"
import { CaptureReviewResultOptions } from "./projectRules/resultCaptureCore"
import { ReviewResult } from "./projectRules/types"
import { BazaarReviewInitialTarget, openBazaarReviewGui } from "./reviewGui"
import { buildAddedFilesContentSection, loadBazaarRevisionPacketInput } from "./revisionInfo"
import { BazaarReviewContextResult, buildReviewContextResult } from "./workflowBridge"
import { resolveBazaarWorkspaceFolder, resolveBobWorkspaceFolder } from "./workspaceResolver"

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
  bazaarRoot?: string
  repositoryRoot?: string
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

interface ReviewRulesBridgeResult {
  status: "ok"
  checklistPath: string
  schemaPath: string
  project?: string
  checklistVersion?: string
  checklistItems: number
  categories: string[]
  schemaTopLevelKeys: string[]
  summary: string
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("bobBazaar.openReviewGui", () => openBazaarReviewGui(context)),
    vscode.commands.registerCommand("bobBazaar.collectReviewContext", () => collectReviewContext()),
    vscode.commands.registerCommand("bobBazaar.loadReviewRules", () => loadReviewRules()),
    vscode.commands.registerCommand("bobBazaar.captureReviewResult", (inputText?: string, ...args: unknown[]) => captureReviewResult(inputText, captureOptionsFromCommandArgs(args))),
    vscode.commands.registerCommand("bobBazaar.saveReviewResultFromClipboard", () => saveReviewResultFromClipboard()),
    vscode.commands.registerCommand("bobBazaar.configureMcp", () => configureMcp(context)),
    vscode.commands.registerCommand("bobBazaar.initProjectRules", () => initProjectRules()),
    vscode.commands.registerCommand("bobBazaar.reviewRevision", () => reviewRevision(context, false)),
    vscode.commands.registerCommand("bobBazaar.reviewRange", () => reviewRange(context, false)),
    vscode.commands.registerCommand("bobBazaar.reviewRevisionWithProjectRules", () => reviewRevision(context, true)),
    vscode.commands.registerCommand("bobBazaar.reviewRangeWithProjectRules", () => reviewRange(context, true)),
    vscode.commands.registerCommand("bobBazaar.validateReviewResultJson", () => validateActiveReviewResultJson())
  )
  registerWorkflowProviders(context).catch((error) => console.warn("Bob Bazaar ワークフロー provider の登録に失敗しました", error))
}

export function deactivate(): void {
  // No background process is kept by the extension host. Bob starts the MCP server on demand.
}

async function registerWorkflowProviders(context: vscode.ExtensionContext): Promise<void> {
  const api = await getWorkflowRegisterApi()
  if (!api) return
  api.registerActionProvider({
    id: "bobBazaar.openReviewGui",
    execute: (input) => openBazaarReviewGui(context, initialTargetFromWorkflowInputs(input.inputs, input))
  })
  api.registerActionProvider({
    id: "bobBazaar.collectReviewContext",
    execute: () => collectReviewContext()
  })
  api.registerActionProvider({
    id: "bobBazaar.loadReviewRules",
    execute: (input) => loadReviewRules(input)
  })
  api.registerActionProvider({
    id: "bobBazaar.captureReviewResult",
    execute: (input) => captureReviewResult(firstStringArg(input.args), {
      expectedChecklistItems: expectedChecklistItemsFromState(input.state),
      workspaceRoot: stringInput(input.workflowRoot),
      workflowState: input.state
    })
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

function isWorkflowRegisterExtensionAvailable(): boolean {
  return Boolean(vscode.extensions.getExtension(WORKFLOW_REGISTER_EXTENSION_ID))
}

function firstStringArg(args: unknown): string | undefined {
  const values = Array.isArray(args) ? args : args === undefined ? [] : [args]
  const first = values[0]
  return typeof first === "string" ? first : undefined
}

function initialTargetFromWorkflowInputs(inputs: Record<string, unknown>, input?: WorkflowActionExecutionInput): BazaarReviewInitialTarget | undefined {
  const explicitBazaarRoot = stringInput(input?.bazaarRoot) ?? stringInput(input?.repositoryRoot) ?? stringInput(inputs.bazaarRoot) ?? stringInput(inputs.repositoryRoot)
  const target: BazaarReviewInitialTarget = {
    revisionMode: targetMode(inputs.revisionMode),
    revision: stringInput(inputs.revision),
    baseRevision: stringInput(inputs.baseRevision),
    targetRevision: stringInput(inputs.targetRevision),
    bazaarRoot: explicitBazaarRoot,
    repositoryRoot: stringInput(inputs.repositoryRoot),
    workflowRoot: stringInput(input?.workflowRoot)
  }
  return target.revisionMode || target.revision || target.baseRevision || target.targetRevision || target.bazaarRoot || target.repositoryRoot || target.workflowRoot ? target : undefined
}

function targetMode(value: unknown): BazaarReviewInitialTarget["revisionMode"] | undefined {
  if (value === "singleRevision" || value === "revisionRange" || value === "workingTreeSinceRevision") return value
  return undefined
}

function stringInput(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function captureOptionsFromCommandArgs(args: unknown[]): CaptureReviewResultOptions {
  const context = recordInput(args[args.length - 1])
  if (!context) return {}
  const workflowState = recordStringMap(context.state)
  return {
    expectedChecklistItems: expectedChecklistItemsFromState(workflowState),
    workspaceRoot: stringInput(context.workflowRoot),
    workflowState
  }
}

function recordStringMap(value: unknown): Record<string, string> | undefined {
  const record = recordInput(value)
  if (!record) return undefined
  const entries = Object.entries(record)
  return entries.every(([, item]) => typeof item === "string")
    ? Object.fromEntries(entries) as Record<string, string>
    : undefined
}

function recordInput(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function expectedChecklistItemsFromState(state: Record<string, string> | undefined): number | undefined {
  const reviewRules = parseStateObject(state?.reviewRules)
  const checklistItems = reviewRules?.checklistItems
  return Number.isInteger(checklistItems) && (checklistItems as number) >= 0 ? checklistItems as number : undefined
}

function parseStateObject(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

async function collectReviewContext(): Promise<BazaarReviewContextResult> {
  const packet = findReviewPacketText()
  if (!packet) {
    throw new Error("Bazaar レビュー packet ドキュメントが開かれていません。先に Bob Bazaar Review でレビュー packet を作成して Bob コンテキストに追加してください。")
  }
  return buildReviewContextResult(packet)
}

async function loadReviewRules(input?: WorkflowActionExecutionInput): Promise<ReviewRulesBridgeResult> {
  const folder = await pickBobWorkspaceFolder(input?.workflowRoot, input ? false : true)
  if (!folder) throw new Error("先に Bob ワークスペースフォルダーを開いてください。")

  const config = vscode.workspace.getConfiguration("bobBazaar")
  const checklistPath = config.get<string>("projectRules.checklistPath", ".bob/review/checklist.json")
  const schemaPath = config.get<string>("projectRules.schemaPath", ".bob/review/review-result.schema.json")
  const [checklist, schema] = await Promise.all([
    loadProjectChecklistRequired(folder.uri.fsPath, checklistPath),
    loadReviewResultSchemaRequired(folder.uri.fsPath, schemaPath)
  ])
  const categories = Array.from(new Set(checklist.rules.map((rule) => rule.category))).sort()
  const schemaTopLevelKeys = schema && typeof schema === "object" ? Object.keys(schema).sort() : []
  return {
    status: "ok",
    checklistPath,
    schemaPath,
    project: checklist.project,
    checklistVersion: checklist.version,
    checklistItems: checklist.rules.length,
    categories,
    schemaTopLevelKeys,
    summary: `プロジェクトレビュー規約 ${checklist.rules.length} 件を ${categories.length} カテゴリから読み込みました。レビュー結果 schema も利用できます。`
  }
}

async function configureMcp(context: vscode.ExtensionContext): Promise<void> {
  const folder = await pickBobWorkspaceFolder(undefined, true)
  if (!folder) return

  const config = vscode.workspace.getConfiguration("bobBazaar")
  const bzrPath = config.get<string>("bzrPath", "bzr")
  const serverName = config.get<string>("mcpServerName", "bazaar")

  const result = await configureWorkspaceMcpServer({
    workspaceFolder: folder,
    extensionContext: context,
    serverName,
    bzrPath
  })

  await vscode.window.showInformationMessage(
    `Bob MCP サーバー '${result.serverName}' を ${result.configPath} に設定しました。すでに起動中の場合は Bob MCP サーバーを Refresh / Restart してください。`
  )
}

async function initProjectRules(): Promise<void> {
  const folder = await pickBobWorkspaceFolder(undefined, true)
  if (!folder) return

  const paths = await initializeProjectRules(folder.uri.fsPath)
  await vscode.window.showInformationMessage(`プロジェクトレビュー規約を初期化しました: ${paths.reviewDir}`)

  const checklistDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(paths.checklistPath))
  await vscode.window.showTextDocument(checklistDoc, { preview: false })
}

async function reviewRevision(context: vscode.ExtensionContext, withProjectRules: boolean): Promise<void> {
  const bazaarFolder = await pickBazaarWorkspaceFolder()
  if (!bazaarFolder) return
  const bobFolder = withProjectRules ? await pickBobWorkspaceFolder(undefined, true) : undefined
  if (withProjectRules && !bobFolder) return

  const revision = await vscode.window.showInputBox({
    title: withProjectRules ? "プロジェクト規約付きで Bazaar 1リビジョンをレビュー" : "Bob で Bazaar 1リビジョンをレビュー",
    prompt: "レビュー対象の Bazaar リビジョンを入力してください。例: 1234 または revid:...",
    validateInput: (value) => value.trim() ? undefined : "リビジョンは必須です。"
  })
  if (!revision) return

  await withProgress("Bazaar 1リビジョンレビュー packet を作成しています", async () => {
    const client = makeBazaarClient()
    const input = await loadBazaarRevisionPacketInput(client, bazaarFolder.uri.fsPath, revision)
    const [addedFilesSection, projectRulesSection] = await Promise.all([
      buildAddedFilesContentSection(client, input.root, revision, input.info, getMaxAddedFileContentBytes()),
      withProjectRules && bobFolder ? buildProjectRulesSectionForWorkspace(bobFolder.uri.fsPath) : Promise.resolve(undefined)
    ])

    const extraSections = [addedFilesSection, projectRulesSection].filter((section): section is string => Boolean(section))
    const packet = buildReviewPacket({
      repositoryRoot: input.root,
      mode: "singleRevision",
      revision,
      log: input.log,
      diff: input.diff,
      maxDiffBytes: getMaxDiffBytes(),
      extraSections: extraSections.length > 0 ? extraSections : undefined
    })

    await showAndOfferBobContext(context, packet, withProjectRules ? `bazaar-project-review-${revision}.md` : `bazaar-review-${revision}.md`)
  })
}

async function reviewRange(context: vscode.ExtensionContext, withProjectRules: boolean): Promise<void> {
  const bazaarFolder = await pickBazaarWorkspaceFolder()
  if (!bazaarFolder) return
  const bobFolder = withProjectRules ? await pickBobWorkspaceFolder(undefined, true) : undefined
  if (withProjectRules && !bobFolder) return

  const baseRevision = await vscode.window.showInputBox({
    title: withProjectRules ? "プロジェクト規約付きで Bazaar リビジョン範囲をレビュー" : "Bob で Bazaar リビジョン範囲をレビュー",
    prompt: "基準となる Bazaar リビジョンを入力してください。例: 1200",
    validateInput: (value) => value.trim() ? undefined : "基準リビジョンは必須です。"
  })
  if (!baseRevision) return

  const targetRevision = await vscode.window.showInputBox({
    title: withProjectRules ? "プロジェクト規約付きで Bazaar リビジョン範囲をレビュー" : "Bob で Bazaar リビジョン範囲をレビュー",
    prompt: "比較先の Bazaar リビジョンを入力してください。例: 1234",
    validateInput: (value) => value.trim() ? undefined : "比較先リビジョンは必須です。"
  })
  if (!targetRevision) return

  await withProgress("Bazaar リビジョン範囲レビュー packet を作成しています", async () => {
    const client = makeBazaarClient()
    const root = await client.root(bazaarFolder.uri.fsPath)
    const [diff, projectRulesSection] = await Promise.all([
      client.diffRange(root, baseRevision, targetRevision),
      withProjectRules && bobFolder ? buildProjectRulesSectionForWorkspace(bobFolder.uri.fsPath) : Promise.resolve(undefined)
    ])

    const packet = buildReviewPacket({
      repositoryRoot: root,
      mode: "revisionRange",
      baseRevision,
      targetRevision,
      diff,
      maxDiffBytes: getMaxDiffBytes(),
      extraSections: projectRulesSection ? [projectRulesSection] : undefined
    })

    await showAndOfferBobContext(context, packet, withProjectRules ? `bazaar-project-review-${baseRevision}-${targetRevision}.md` : `bazaar-review-${baseRevision}-${targetRevision}.md`)
  })
}

async function buildProjectRulesSectionForWorkspace(workspaceRoot: string): Promise<string> {
  const config = vscode.workspace.getConfiguration("bobBazaar")
  const checklistPath = config.get<string>("projectRules.checklistPath", ".bob/review/checklist.json")
  const schemaPath = config.get<string>("projectRules.schemaPath", ".bob/review/review-result.schema.json")
  const [checklist, schema] = await Promise.all([
    loadProjectChecklist(workspaceRoot, checklistPath),
    loadReviewResultSchema(workspaceRoot, schemaPath)
  ])
  return buildProjectRulesSection({ checklist, schema })
}

async function validateActiveReviewResultJson(): Promise<void> {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    await vscode.window.showWarningMessage("先にレビュー結果 JSON ドキュメントを開いてください。")
    return
  }

  const raw = editor.document.getText(editor.selection.isEmpty ? undefined : editor.selection)
  const validation = validateReviewResultJson(raw)
  if (!validation.valid) {
    const report = [
      "# レビュー結果 JSON 検証エラー",
      "",
      ...validation.issues.map((issue) => `- ${issue.path}: ${issue.message}`)
    ].join("\n")
    const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: report })
    await vscode.window.showTextDocument(doc, { preview: false })
    return
  }

  const action = await vscode.window.showInformationMessage("レビュー結果 JSON は有効です。", "Markdown サマリを表示")
  if (action === "Markdown サマリを表示") {
    const result = JSON.parse(raw) as ReviewResult
    const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: renderReviewResultMarkdown(result) })
    await vscode.window.showTextDocument(doc, { preview: false })
  }
}

function makeBazaarClient(): BazaarClient {
  const config = vscode.workspace.getConfiguration("bobBazaar")
  return new BazaarClient({
    bzrPath: config.get<string>("bzrPath", "bzr"),
    maxBuffer: Math.max(getMaxDiffBytes() * 2, 2 * 1024 * 1024),
    textEncoding: config.get<string>("textEncoding", "auto")
  })
}

function getMaxDiffBytes(): number {
  const config = vscode.workspace.getConfiguration("bobBazaar")
  return config.get<number>("maxDiffBytes", 1024 * 1024)
}

function getMaxAddedFileContentBytes(): number {
  const config = vscode.workspace.getConfiguration("bobBazaar")
  return config.get<number>("maxAddedFileContentBytes", 256 * 1024)
}

async function pickBazaarWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  return resolveBazaarWorkspaceFolder({ allowPick: true, title: "Bazaar ワークスペースを選択" })
}

async function pickBobWorkspaceFolder(workflowRoot?: string, allowPick = true): Promise<vscode.WorkspaceFolder | undefined> {
  return resolveBobWorkspaceFolder({ workflowRoot, allowPick, title: "Bob ワークスペースを選択" })
}

function findReviewPacketText(): string | undefined {
  const active = vscode.window.activeTextEditor?.document
  const visible = vscode.window.visibleTextEditors.map((editor) => editor.document)
  const documents = [active, ...visible, ...vscode.workspace.textDocuments].filter((doc): doc is vscode.TextDocument => Boolean(doc))
  for (const document of documents) {
    const text = document.getText()
    if (text.includes("# Bazaar Revision Review Request") && text.includes("## Bazaar diff")) return text
  }
  return undefined
}

async function showAndOfferBobContext(context: vscode.ExtensionContext, packet: string, filename: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: packet
  })
  const editor = await vscode.window.showTextDocument(document, { preview: false })

  if (!isBobCodeExtensionAvailable()) {
    await vscode.window.showInformationMessage("IBM Bob 拡張機能が見つからないため、Bazaar Revision Review Request の Markdown を作成しました。Bob チャットへの挿入は行いません。")
    return
  }

  if (!isWorkflowRegisterExtensionAvailable()) {
    const result = await addPacketToBobContext(editor.document.uri, packet)
    if (result === "added") {
      await vscode.window.showInformationMessage("workflow-register 未導入のため、Bazaar Revision Review Request を Bob チャットへ挿入しました。")
    }
    return
  }

  const action = await vscode.window.showInformationMessage(
    "Bazaar レビュー packet を作成しました。Bob コンテキストへ追加しますか？",
    "Bob コンテキストへ追加",
    "クリップボードへコピー",
    "ファイルに保存"
  )

  if (action === "Bob コンテキストへ追加") {
    await addPacketToBobContext(editor.document.uri, packet)
  } else if (action === "クリップボードへコピー") {
    await vscode.env.clipboard.writeText(packet)
  } else if (action === "ファイルに保存") {
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(context.globalStorageUri, filename),
      filters: { Markdown: ["md"] }
    })
    if (target) {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, ".."))
      await vscode.workspace.fs.writeFile(target, Buffer.from(packet, "utf8"))
    }
  }
}

async function addPacketToBobContext(uri: vscode.Uri, packet: string) {
  return addMarkdownPacketToBobContext({
    executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args),
    writeClipboard: (text) => vscode.env.clipboard.writeText(text),
    showWarningMessage: (message) => vscode.window.showWarningMessage(message)
  }, uri, packet)
}

async function withProgress<T>(title: string, task: () => Promise<T>): Promise<T> {
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, task)
}
