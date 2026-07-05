import * as vscode from "vscode"
import { reviewRange, reviewRevision } from "./bazaar/bazaarReviewCommands"
import { captureReviewResult, saveReviewResultFromClipboard } from "./projectRules/resultCapture"
import { validateActiveReviewResultJson } from "./projectRules/reviewResultValidationCommand"
import { registerReviewRecordCommands } from "./records/reviewRecordCommands"
import { openBazaarReviewGui } from "./ui/reviewGui"
import { collectReviewContext, loadReviewRules } from "./workflow/workflowActions"
import { registerWorkflowProvidersWithRetry } from "./workflow/workflowProviders"
import { captureOptionsFromCommandArgs } from "./workflow/workflowRegisterBridge"
import { configureMcp, initProjectRules } from "./workspace/workspaceCommands"

/**
 * Bob Bazaar レビュー拡張を有効化し、VS Code command と workflow provider を登録する。
 *
 * command ID は既存 workflow やユーザー操作から参照される互換性契約なので、処理本体を分離しても変更しない。
 *
 * @param context command 登録と拡張リソース解決に使う VS Code extension context。
 * @returns なし。
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
  registerReviewRecordCommands(context)
  registerWorkflowProvidersWithRetry(context)
}

/**
 * Bob Bazaar レビュー拡張を無効化する。
 *
 * @returns なし。
 */
export function deactivate(): void {
  // extension host 側では常駐 process を持たず、Bob が必要時に MCP server を起動する。
}
