import * as vscode from "vscode"
import { reviewRange, reviewRevision } from "./bazaarReviewCommands"
import { resolveBzrPath } from "./bzrPathTrust"
import { configureWorkspaceMcpServer } from "./mcpConfig"
import {
  initializeProjectRules,
  loadProjectChecklistRequired,
  loadReviewResultSchemaRequired
} from "./projectRules/io"
import { captureReviewResult, saveReviewResultFromClipboard } from "./projectRules/resultCapture"
import { validateActiveReviewResultJson } from "./reviewResultValidationCommand"
import { openBazaarReviewGui } from "./reviewGui"
import { selectReviewPacketText } from "./reviewPacketSelection"
import { BazaarReviewContextResult, buildReviewContextResult } from "./workflowBridge"
import {
  captureOptionsFromCommandArgs,
  firstStringArg,
  getWorkflowRegisterApi,
  initialTargetFromWorkflowInputs,
  stringInput,
  type WorkflowActionExecutionInput
} from "./workflowRegisterBridge"
import { resolveBobWorkspaceFolder } from "./workspaceResolver"

/**
 * Summary returned to workflow steps after project review rules are loaded.
 */
interface ReviewRulesBridgeResult {
  /** Rule-loading status for workflow consumers. */
  status: "ok"
  /** Workspace-relative or absolute path to the loaded checklist file. */
  checklistPath: string
  /** Workspace-relative or absolute path to the loaded review result schema file. */
  schemaPath: string
  /** Optional project name declared by the checklist. */
  project?: string
  /** Optional checklist version declared by the project rules. */
  checklistVersion?: string
  /** Number of checklist rule items that were loaded. */
  checklistItems: number
  /** Checklist rule IDs in project checklist order. */
  ruleIds: string[]
  /** Sorted list of rule categories found in the checklist. */
  categories: string[]
  /** Review result JSON schema loaded for the project. */
  reviewResultSchema: unknown
  /** Sorted top-level keys found in the review result JSON schema. */
  schemaTopLevelKeys: string[]
  /** Human-readable summary suitable for command and workflow output. */
  summary: string
}

const WORKFLOW_PROVIDER_RETRY_DELAYS_MS = [1000, 3000, 10000]
let workflowProvidersRegistered = false

/**
 * Activates the Bob Bazaar review extension and registers VS Code commands plus workflow providers.
 *
 * @param context VS Code extension context that owns command registrations and extension resources.
 * @returns Nothing.
 */
export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("bobBazaar.openReviewGui", () => openBazaarReviewGui(context)),
    vscode.commands.registerCommand("bobBazaar.collectReviewContext", () => collectReviewContext()),
    vscode.commands.registerCommand("bobBazaar.loadReviewRules", () => loadReviewRules()),
    vscode.commands.registerCommand(
      "bobBazaar.captureReviewResult",
      (inputText?: string, ...args: unknown[]) => captureReviewResult(inputText, captureOptionsFromCommandArgs(args))
    ),
    vscode.commands.registerCommand("bobBazaar.saveReviewResultFromClipboard", () => saveReviewResultFromClipboard()),
    vscode.commands.registerCommand("bobBazaar.configureMcp", () => configureMcp(context)),
    vscode.commands.registerCommand("bobBazaar.initProjectRules", () => initProjectRules()),
    vscode.commands.registerCommand("bobBazaar.reviewRevision", () => reviewRevision(context, false)),
    vscode.commands.registerCommand("bobBazaar.reviewRange", () => reviewRange(context, false)),
    vscode.commands.registerCommand("bobBazaar.reviewRevisionWithProjectRules", () => reviewRevision(context, true)),
    vscode.commands.registerCommand("bobBazaar.reviewRangeWithProjectRules", () => reviewRange(context, true)),
    vscode.commands.registerCommand("bobBazaar.validateReviewResultJson", () => validateActiveReviewResultJson())
  )
  registerWorkflowProvidersWithRetry(context)
}

/**
 * Deactivates the Bob Bazaar review extension.
 *
 * @returns Nothing.
 */
export function deactivate(): void {
  // No background process is kept by the extension host. Bob starts the MCP server on demand.
}

/**
 * Registers Bazaar review actions with workflow-register when that dependency is available.
 *
 * @param context VS Code extension context passed to GUI and review command handlers.
 * @returns Nothing.
 */
function registerWorkflowProvidersWithRetry(context: vscode.ExtensionContext): void {
  let retryIndex = 0
  const attempt = (): void => {
    registerWorkflowProviders(context)
      .then((registered) => {
        if (registered || retryIndex >= WORKFLOW_PROVIDER_RETRY_DELAYS_MS.length) return
        const timer = setTimeout(() => attempt(), WORKFLOW_PROVIDER_RETRY_DELAYS_MS[retryIndex])
        retryIndex += 1
        context.subscriptions.push({ dispose: () => clearTimeout(timer) })
      })
      .catch((error) => console.warn("Bob Bazaar ワークフロー provider の登録に失敗しました", error))
  }
  context.subscriptions.push(vscode.extensions.onDidChange(() => attempt()))
  attempt()
}

/**
 * Registers Bazaar review actions with workflow-register when that dependency is available.
 *
 * @param context VS Code extension context passed to GUI and review command handlers.
 * @returns True when providers are already or newly registered; false when workflow-register is unavailable.
 */
async function registerWorkflowProviders(context: vscode.ExtensionContext): Promise<boolean> {
  if (workflowProvidersRegistered) return true
  const api = await getWorkflowRegisterApi()
  if (!api) return false
  api.registerActionProvider({
    id: "bobBazaar.openReviewGui",
    execute: (input) => openBazaarReviewGui(context, initialTargetFromWorkflowInputs(input.inputs, input))
  })
  api.registerActionProvider({
    id: "bobBazaar.collectReviewContext",
    execute: (input) => collectReviewContext(input)
  })
  api.registerActionProvider({
    id: "bobBazaar.loadReviewRules",
    execute: (input) => loadReviewRules(input)
  })
  api.registerActionProvider({
    id: "bobBazaar.captureReviewResult",
    execute: (input) => captureReviewResult(firstStringArg(input.args), captureOptionsFromCommandArgs([input]))
  })
  workflowProvidersRegistered = true
  return true
}

/**
 * Collects the active Bazaar review packet from open editor documents for workflow execution.
 *
 * @returns Bazaar review context parsed from the visible review packet.
 * @throws Error when no Bazaar review packet document is open.
 */
async function collectReviewContext(input?: WorkflowActionExecutionInput): Promise<BazaarReviewContextResult> {
  const packet = await findReviewPacketText(input)
  if (!packet) {
    throw new Error("Bazaar レビュー packet ドキュメントが開かれていません。先に Bob Bazaar Review でレビュー packet を作成して Bob コンテキストに追加してください。")
  }
  return buildReviewContextResult(packet)
}

/**
 * Loads project-specific review checklist and result schema files for commands or workflow actions.
 *
 * @param input Optional workflow action input that may provide the workspace root.
 * @returns Summary of the loaded checklist and schema metadata.
 */
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
  const ruleIds = checklist.rules.map((rule) => rule.id)
  const schemaTopLevelKeys = schema && typeof schema === "object" ? Object.keys(schema).sort() : []
  return {
    status: "ok",
    checklistPath,
    schemaPath,
    project: checklist.project,
    checklistVersion: checklist.version,
    checklistItems: checklist.rules.length,
    ruleIds,
    categories,
    reviewResultSchema: schema,
    schemaTopLevelKeys,
    summary: `プロジェクトレビュー規約 ${checklist.rules.length} 件を ${categories.length} カテゴリから読み込みました。レビュー結果 schema も利用できます。`
  }
}

/**
 * Writes the Bazaar MCP server configuration for the selected Bob workspace.
 *
 * @param context VS Code extension context used to locate extension resources for MCP configuration.
 * @returns A promise that resolves after configuration is saved or the user cancels folder selection.
 */
async function configureMcp(context: vscode.ExtensionContext): Promise<void> {
  const folder = await pickBobWorkspaceFolder(undefined, true)
  if (!folder) return

  const config = vscode.workspace.getConfiguration("bobBazaar")
  const bzrPath = resolveBzrPath(config, vscode.workspace.isTrusted)
  const textEncoding = config.get<string>("textEncoding", "auto")
  const serverName = config.get<string>("mcpServerName", "bazaar")

  const result = await configureWorkspaceMcpServer({
    workspaceFolder: folder,
    extensionContext: context,
    serverName,
    bzrPath,
    textEncoding
  })

  await vscode.window.showInformationMessage(
    `Bob MCP サーバー '${result.serverName}' を ${result.configPath} に設定しました。すでに起動中の場合は Bob MCP サーバーを Refresh / Restart してください。`
  )
}

/**
 * Initializes project review rule files in the selected Bob workspace.
 *
 * @returns A promise that resolves after the rule scaffold is created or the user cancels folder selection.
 */
async function initProjectRules(): Promise<void> {
  const folder = await pickBobWorkspaceFolder(undefined, true)
  if (!folder) return

  const paths = await initializeProjectRules(folder.uri.fsPath)
  await vscode.window.showInformationMessage(`プロジェクトレビュー規約を初期化しました: ${paths.reviewDir}`)

  const checklistDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(paths.checklistPath))
  await vscode.window.showTextDocument(checklistDoc, { preview: false })
}

/**
 * Resolves the Bob workspace folder from workflow input or an interactive picker.
 *
 * @param workflowRoot Optional workspace root path supplied by workflow-register.
 * @param allowPick Whether to show an interactive picker when the root is not supplied.
 * @returns The selected workspace folder, or undefined when no folder is available.
 */
async function pickBobWorkspaceFolder(workflowRoot?: string, allowPick = true): Promise<vscode.WorkspaceFolder | undefined> {
  return resolveBobWorkspaceFolder({ workflowRoot, allowPick, title: "Bob ワークスペースを選択" })
}

/**
 * Finds a Bazaar review packet in the active, visible, or open VS Code documents.
 *
 * @returns Review packet text when a matching document is open; otherwise undefined.
 */
async function findReviewPacketText(input?: WorkflowActionExecutionInput): Promise<string | undefined> {
  const active = vscode.window.activeTextEditor?.document
  const visible = vscode.window.visibleTextEditors.map((editor) => editor.document)
  const documents = [active, ...visible, ...vscode.workspace.textDocuments].filter((doc): doc is vscode.TextDocument => Boolean(doc))
  return selectReviewPacketText({
    documents: documents.map((document) => ({
      uri: document.uri.toString(),
      fileName: document.fileName,
      text: document.getText()
    })),
    activeUri: active?.uri.toString(),
    visibleUris: visible.map((document) => document.uri.toString()),
    expectedUri: packetUriFromWorkflowInput(input),
    state: input?.state,
    runId: input?.runId,
    pickPacket: async (items) => {
      const picked = await vscode.window.showQuickPick(
        items.map((item) => ({ label: item.label, description: item.uri, detail: item.detail, item })),
        { title: "Bazaar review packet を選択", placeHolder: "workflow に渡す Bazaar review packet を選択してください" }
      )
      return picked?.item
    }
  })
}

function packetUriFromWorkflowInput(input: WorkflowActionExecutionInput | undefined): string | undefined {
  return firstStringArg(input?.args) ??
    stringInput(input?.inputs.reviewPacketUri) ??
    stringInput(input?.inputs.packetUri)
}
