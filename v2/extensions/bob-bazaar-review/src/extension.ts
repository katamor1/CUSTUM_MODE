import * as vscode from "vscode"
import { reviewRange, reviewRevision } from "./bazaarReviewCommands"
import { configureWorkspaceMcpServer } from "./mcpConfig"
import {
  initializeProjectRules,
  loadProjectChecklistRequired,
  loadReviewResultSchemaRequired
} from "./projectRules/io"
import { captureReviewResult, saveReviewResultFromClipboard } from "./projectRules/resultCapture"
import { validateActiveReviewResultJson } from "./reviewResultValidationCommand"
import { openBazaarReviewGui } from "./reviewGui"
import { BazaarReviewContextResult, buildReviewContextResult } from "./workflowBridge"
import {
  captureOptionsFromCommandArgs,
  firstStringArg,
  getWorkflowRegisterApi,
  initialTargetFromWorkflowInputs,
  type WorkflowActionExecutionInput
} from "./workflowRegisterBridge"
import { resolveBobWorkspaceFolder } from "./workspaceResolver"

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
    execute: (input) => captureReviewResult(firstStringArg(input.args), captureOptionsFromCommandArgs([input]))
  })
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
