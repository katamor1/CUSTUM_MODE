import * as vscode from "vscode"
import { captureReviewResult } from "../projectRules/resultCapture"
import { openBazaarReviewGui } from "../ui/reviewGui"
import { collectReviewContext, loadReviewRules } from "./workflowActions"
import {
  captureOptionsFromCommandArgs,
  firstStringArg,
  getWorkflowRegisterApi,
  initialTargetFromWorkflowInputs
} from "./workflowRegisterBridge"

const WORKFLOW_PROVIDER_RETRY_DELAYS_MS = [1000, 3000, 10000]
let workflowProvidersRegistered = false

/**
 * workflow-register が利用できる場合に Bazaar レビュー用 action provider を登録する。
 *
 * provider ID は WORKFLOW.md から参照される互換性契約であり、再試行しても同じ ID だけを登録する。
 *
 * @param context GUI と review command handler に渡す VS Code extension context。
 * @returns なし。
 */
export function registerWorkflowProvidersWithRetry(context: vscode.ExtensionContext): void {
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
 * workflow-register API へ Bazaar レビュー用 action provider を実際に登録する。
 *
 * workflow-register が未起動または未導入の場合は false を返し、呼び出し元の retry に任せる。
 *
 * @param context GUI と review command handler に渡す VS Code extension context。
 * @returns provider が既存または新規に登録済みなら true、workflow-register が使えない場合は false。
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
