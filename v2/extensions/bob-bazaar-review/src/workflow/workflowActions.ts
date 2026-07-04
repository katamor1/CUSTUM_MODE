import * as vscode from "vscode"
import {
  loadProjectChecklistRequired,
  loadReviewResultSchemaRequired
} from "../projectRules/io"
import { reviewPacketRepositoryRootFromState, selectReviewPacketText } from "../bazaar/reviewPacketSelection"
import { BazaarReviewContextResult, buildReviewContextResult } from "./workflowBridge"
import {
  firstStringArg,
  stringInput,
  type WorkflowActionExecutionInput
} from "./workflowRegisterBridge"
import { resolveBobWorkspaceFolder } from "../workspace/workspaceResolver"

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

/**
 * Collects the active Bazaar review packet from open editor documents for workflow execution.
 *
 * @returns Bazaar review context parsed from the visible review packet.
 * @throws Error when no Bazaar review packet document is open.
 */
export async function collectReviewContext(input?: WorkflowActionExecutionInput): Promise<BazaarReviewContextResult> {
  const packet = await findReviewPacketText(input)
  if (!packet) {
    throw new Error("Bazaar レビュー packet ドキュメントが開かれていません。先に Bob Bazaar Review でレビュー packet を作成して Bob コンテキストに追加してください。")
  }
  return buildReviewContextResult(packet, {
    workspacePath: reviewPacketRepositoryRootFromState(input?.state, input?.runId)
  })
}

/**
 * Loads project-specific review checklist and result schema files for commands or workflow actions.
 *
 * @param input Optional workflow action input that may provide the workspace root.
 * @returns Summary of the loaded checklist and schema metadata.
 */
export async function loadReviewRules(input?: WorkflowActionExecutionInput): Promise<ReviewRulesBridgeResult> {
  const folder = await resolveBobWorkspaceFolder({
    workflowRoot: input?.workflowRoot,
    allowPick: input ? false : true,
    title: "Bob ワークスペースを選択"
  })
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
