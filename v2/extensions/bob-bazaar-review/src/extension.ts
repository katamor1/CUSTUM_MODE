import * as vscode from "vscode"
import { reviewRange, reviewRevision } from "./bazaar/bazaarReviewCommands"
import { captureReviewResult, saveReviewResultFromClipboard } from "./projectRules/resultCapture"
import { validateActiveReviewResultJson } from "./projectRules/reviewResultValidationCommand"
import { openBazaarReviewGui } from "./ui/reviewGui"
import { collectReviewContext, loadReviewRules } from "./workflow/workflowActions"
import { registerWorkflowProvidersWithRetry } from "./workflow/workflowProviders"
import { captureOptionsFromCommandArgs } from "./workflow/workflowRegisterBridge"
import { configureMcp, initProjectRules } from "./workspace/workspaceCommands"

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
