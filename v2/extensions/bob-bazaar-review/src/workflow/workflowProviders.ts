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
 * Registers Bazaar review actions with workflow-register when that dependency is available.
 *
 * @param context VS Code extension context passed to GUI and review command handlers.
 * @returns Nothing.
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
