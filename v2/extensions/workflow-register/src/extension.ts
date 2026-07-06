import * as vscode from "vscode"
import type { ActionProvider } from "./core/actionRegistry"
import type { AgentProvider, CoreWorkflowDefinition } from "./core/model"
import type { ResultSinkRegistry } from "./core/resultSinkRegistry"
import { OperationHubProvider } from "./gui/operationHubProvider"
import { WorkflowRegisterService } from "./workflowRegisterService"
import type { StepCompletionOptions } from "./workflowRegisterService"

/**
 * 他の Bob companion extension へ公開する workflow-register API。
 *
 * provider ID、workflow ID、command ID は WORKFLOW.md と companion extension から参照される互換性契約である。
 */
export interface WorkflowRegisterApi {
  /**
   * custom action step を実行する workflow action provider を登録する。
   *
   * @param provider workflow runtime へ公開する action provider 実装。
   * @returns なし。
   */
  registerActionProvider: (provider: ActionProvider) => void
  /**
   * agent-backed workflow step を実行する agent provider を登録する。
   *
   * @param provider workflow runtime へ公開する agent provider 実装。
   * @returns なし。
   */
  registerAgentProvider: (provider: AgentProvider) => void
  /**
   * workflow output の保存または転送に使う result sink handler を登録する。
   *
   * @param type workflow definition から参照される result sink type identifier。
   * @param handler workflow step が一致する result sink payload を出したときに呼ぶ handler。
   * @returns なし。
   */
  registerResultSink: (type: string, handler: Parameters<ResultSinkRegistry["register"]>[1]) => void
  /**
   * registration service が現在把握している workflow definition を返す。
   *
   * @returns 登録済み core workflow definition。
   */
  listWorkflows: () => CoreWorkflowDefinition[]
  /**
   * 登録済み workflow を実行し、必要に応じて workflow input を渡す。
   *
   * @param workflowId workflow identifier。省略時はユーザー選択になる場合がある。
   * @param inputs input id を key にした workflow input values。
   * @returns runtime が返す workflow execution result。
   */
  runWorkflow: (workflowId?: string, inputs?: Record<string, unknown>) => Promise<unknown>
  /**
   * 登録済み workflow の単一 step を実行する。
   *
   * @param workflowId workflow identifier。省略時はユーザー選択になる場合がある。
   * @param stepId step identifier。省略時はユーザー選択になる場合がある。
   * @param inputs input id を key にした workflow input values。
   * @returns runtime が返す step execution result。
   */
  runWorkflowStep: (workflowId?: string, stepId?: string, inputs?: Record<string, unknown>) => Promise<unknown>
  /**
   * workflow run の次に実行可能な step を実行して run を進める。
   *
   * @param runId run identifier。省略時は active または選択可能な run を使う。
   * @returns runtime が返す next-step execution result。
   */
  runNextStep: (runId?: string) => Promise<unknown>
  /**
   * pending branch checkpoint を承認し、loop allowance を延長する。
   *
   * @param runId run identifier。省略時は active または選択可能な run を使う。
   * @returns 更新後の workflow run。
   */
  approveBranchCheckpoint: (runId?: string) => Promise<unknown>
  /**
   * branch checkpoint で待機中の workflow run を中止する。
   *
   * @param runId run identifier。省略時は active または選択可能な run を使う。
   * @returns 更新後の workflow run。
   */
  abortBranchCheckpoint: (runId?: string) => Promise<unknown>
  /**
   * workflow run の branching loop / checkpoint / history diagnostics を表示する。
   *
   * @param runId run identifier。省略時は active または選択可能な run を使う。
   * @returns inspection 対象の workflow run、または説明 message。
   */
  inspectBranching: (runId?: string) => Promise<unknown>
}

/**
 * workflow-register 拡張を有効化し、VS Code command を registration service へ接続する。
 *
 * 公開 API と command ID は companion extension / WORKFLOW.md から参照されるため、この composition root で安定させる。
 *
 * @param context command 登録と disposable を所有する VS Code extension context。
 * @returns workflow-aware companion extension が利用する public API object。
 */
export function activate(context: vscode.ExtensionContext): WorkflowRegisterApi {
  const service = new WorkflowRegisterService(String(context.extension.packageJSON.version ?? "unknown"))
  const api: WorkflowRegisterApi = {
    registerActionProvider: (provider) => service.registerActionProvider(provider),
    registerAgentProvider: (provider) => service.registerAgentProvider(provider),
    registerResultSink: (type, handler) => service.registerResultSink(type, handler),
    listWorkflows: () => service.listCoreWorkflows(),
    runWorkflow: (workflowId, inputs) => service.runWorkflow(workflowId, inputs),
    runWorkflowStep: (workflowId, stepId, inputs) => service.runWorkflowStep(workflowId, stepId, inputs),
    runNextStep: (runId) => service.runNextStep(runId),
    approveBranchCheckpoint: (runId) => service.approveBranchCheckpoint(runId),
    abortBranchCheckpoint: (runId) => service.abortBranchCheckpoint(runId),
    inspectBranching: (runId) => service.inspectBranching(runId)
  }
  const operationHub = new OperationHubProvider({ api, extensionUri: context.extensionUri })
  context.subscriptions.push(
    service,
    operationHub,
    vscode.window.registerWebviewViewProvider("workflowRegister.operationHub", operationHub),
    vscode.commands.registerCommand("workflowRegister.openOperationHub", (input?: unknown) => operationHub.open(input)),
    vscode.commands.registerCommand("workflowRegister.reload", () => service.reload({ showReport: true })),
    vscode.commands.registerCommand("workflowRegister.inspect", () => service.inspect()),
    vscode.commands.registerCommand("workflowRegister.completeCurrentStep", (options?: StepCompletionOptions) => service.completeCurrentStep(options)),
    vscode.commands.registerCommand("workflowRegister.completeStep", (options?: StepCompletionOptions) => service.completeCurrentStep(options)),
    vscode.commands.registerCommand("workflowRegister.inspectActiveSteps", () => service.inspectActiveSteps()),
    vscode.commands.registerCommand(
      "workflowRegister.runWorkflow",
      (workflowId?: string, inputs?: Record<string, unknown>) => service.runWorkflow(workflowId, inputs)
    ),
    vscode.commands.registerCommand(
      "workflowRegister.runWorkflowStep",
      (workflowId?: string, stepId?: string, inputs?: Record<string, unknown>) => {
        return service.runWorkflowStep(workflowId, stepId, inputs)
      }
    ),
    vscode.commands.registerCommand("workflowRegister.runNextStep", (runId?: string) => service.runNextStep(runId)),
    vscode.commands.registerCommand("workflowRegister.openManualStepPanel", (runArg?: unknown) => service.openManualStepPanel(runArg as Parameters<WorkflowRegisterService["openManualStepPanel"]>[0])),
    vscode.commands.registerCommand("workflowRegister.inspectRuns", () => service.inspectRuns()),
    vscode.commands.registerCommand("workflowRegister.resumeRun", (runId?: string) => service.resumeRun(runId)),
    vscode.commands.registerCommand("workflowRegister.retryCurrentStep", (runId?: string) => service.retryCurrentStep(runId)),
    vscode.commands.registerCommand("workflowRegister.approveBranchCheckpoint", (runId?: string) => service.approveBranchCheckpoint(runId)),
    vscode.commands.registerCommand("workflowRegister.abortBranchCheckpoint", (runId?: string) => service.abortBranchCheckpoint(runId)),
    vscode.commands.registerCommand("workflowRegister.inspectBranching", (runId?: string) => service.inspectBranching(runId))
  )
  service.reload({ showReport: false }).catch((error) => console.warn("Bob workflow registration failed", error))
  const retryDelaysMs = [3000, 10000, 30000, 60000, 120000]
  for (const delayMs of retryDelaysMs) {
    const timer = setTimeout(
      () => service.reload({ showReport: false }).catch((error) => {
        console.warn("Bob workflow registration retry failed", error)
      }),
      delayMs
    )
    context.subscriptions.push({ dispose: () => clearTimeout(timer) })
  }
  return api
}

/**
 * workflow-register 拡張を無効化する。
 *
 * @returns なし。
 */
export function deactivate(): void {
  // context subscriptions 以外に明示破棄する resource はない。
}
