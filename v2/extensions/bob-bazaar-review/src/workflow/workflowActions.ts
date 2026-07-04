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
 * project review rules 読み込み後に workflow step へ返す summary。
 *
 * field 名は workflow result と後続 Bob prompt から参照されるため、互換性を維持する。
 */
interface ReviewRulesBridgeResult {
  /** workflow consumer が分岐に使う読み込み状態。 */
  status: "ok"
  /** 読み込んだ checklist file の workspace 相対または絶対 path。 */
  checklistPath: string
  /** 読み込んだ review result schema file の workspace 相対または絶対 path。 */
  schemaPath: string
  /** checklist が宣言する project 名。 */
  project?: string
  /** project rules が宣言する checklist version。 */
  checklistVersion?: string
  /** 読み込んだ checklist rule item 数。 */
  checklistItems: number
  /** project checklist の順序を保った rule ID。 */
  ruleIds: string[]
  /** checklist 内で検出した rule category のソート済み一覧。 */
  categories: string[]
  /** project 用に読み込んだ review result JSON schema。 */
  reviewResultSchema: unknown
  /** review result JSON schema の top-level key 一覧。 */
  schemaTopLevelKeys: string[]
  /** command と workflow output にそのまま出せる人間向け summary。 */
  summary: string
}

/**
 * 開いている editor document から workflow 実行用の Bazaar review packet を収集する。
 *
 * packet の本文は Bob-visible な証跡であり、実 repository root は workflow state から復元して混同を避ける。
 *
 * @returns 表示中の review packet から解析した Bazaar review context。
 * @throws Bazaar review packet document が開かれていない場合。
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
 * command または workflow action から使う project-specific review checklist と result schema を読み込む。
 *
 * workflowRoot は Bob workspace 選択の補助にだけ使い、path 解決と必須 file 検証は loader 側に委ねる。
 *
 * @param input workspace root を含み得る workflow action input。
 * @returns 読み込んだ checklist と schema metadata の summary。
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
 * active、visible、open の VS Code document から Bazaar review packet を探す。
 *
 * workflow state の packet URI がある場合は、曖昧な editor 選択より優先して同じ run の packet を使う。
 *
 * @returns 一致する document が開かれていれば review packet text、なければ undefined。
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
