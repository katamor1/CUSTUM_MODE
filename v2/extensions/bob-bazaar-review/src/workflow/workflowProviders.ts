import * as vscode from "vscode"
import { captureReviewResult } from "../projectRules/resultCapture"
import { openBazaarReviewGui } from "../ui/reviewGui"
import {
  startRetryRegistrationController,
  type RegistrationAttemptResult
} from "./retryRegistrationController"
import { collectReviewContext, loadReviewRules } from "./workflowActions"
import {
  captureOptionsFromCommandArgs,
  firstStringArg,
  getWorkflowRegisterApi,
  initialTargetFromWorkflowInputs,
  WORKFLOW_REGISTER_EXTENSION_ID,
  type WorkflowActionProvider,
  type WorkflowRegisterApi
} from "./workflowRegisterBridge"

const WORKFLOW_PROVIDER_RETRY_DELAYS_MS = [1000, 3000, 10000]
const BAZAAR_PROVIDER_SOURCE_ID = "local.bob-bazaar-review"

/**
 * workflow-register が利用できる場合に Bazaar レビュー用 action provider を登録する。
 *
 * provider ID は WORKFLOW.md から参照される互換性契約であり、API世代が変わった場合だけ再登録する。
 */
export function registerWorkflowProvidersWithRetry(context: vscode.ExtensionContext): void {
  startRetryRegistrationController<WorkflowRegisterApi>({
    retryDelaysMs: WORKFLOW_PROVIDER_RETRY_DELAYS_MS,
    register: () => registerWorkflowProviders(context),
    currentApi: () => {
      const extension = vscode.extensions.getExtension<WorkflowRegisterApi>(WORKFLOW_REGISTER_EXTENSION_ID)
      return extension?.isActive ? extension.exports : undefined
    },
    subscribeChanges: (listener) => vscode.extensions.onDidChange(listener),
    own: (...registrations) => context.subscriptions.push(...registrations),
    reportError: (error) => console.warn("Bob Bazaar ワークフロー provider の登録に失敗しました", error)
  })
}

/** workflow-register APIへBazaarレビュー用providerを一括登録する。 */
async function registerWorkflowProviders(
  context: vscode.ExtensionContext
): Promise<RegistrationAttemptResult<WorkflowRegisterApi>> {
  const api = await getWorkflowRegisterApi()
  if (!api) return { registered: false, registrations: [] }

  const registrations: vscode.Disposable[] = []
  try {
    registerOwnedProvider(api, registrations, {
      id: "bobBazaar.openReviewGui",
      execute: (input) => openBazaarReviewGui(context, initialTargetFromWorkflowInputs(input.inputs, input))
    })
    registerOwnedProvider(api, registrations, {
      id: "bobBazaar.collectReviewContext",
      execute: (input) => collectReviewContext(input)
    })
    registerOwnedProvider(api, registrations, {
      id: "bobBazaar.loadReviewRules",
      execute: (input) => loadReviewRules(input)
    })
    registerOwnedProvider(api, registrations, {
      id: "bobBazaar.captureReviewResult",
      execute: (input) => captureReviewResult(firstStringArg(input.args), captureOptionsFromCommandArgs([input]))
    })
    return { registered: true, registrations, api }
  } catch (error) {
    disposeRegistrations(registrations)
    throw error
  }
}

function registerOwnedProvider(
  api: WorkflowRegisterApi,
  registrations: vscode.Disposable[],
  provider: WorkflowActionProvider
): void {
  const registration = api.registerActionProvider({ ...provider, sourceId: BAZAAR_PROVIDER_SOURCE_ID })
  if (registration && typeof registration.dispose === "function") registrations.push(registration)
}

function disposeRegistrations(registrations: vscode.Disposable[]): void {
  for (const registration of [...registrations].reverse()) registration.dispose()
  registrations.length = 0
}
