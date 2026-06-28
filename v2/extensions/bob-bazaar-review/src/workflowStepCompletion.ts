export const COMPLETE_WORKFLOW_STEP_COMMAND = "workflowRegister.completeStep"

export interface WorkflowStepCompletionDeps {
  executeCommand: (command: string, ...args: unknown[]) => Promise<unknown> | unknown
  showWarningMessage?: (message: string) => Promise<unknown> | unknown
}

export async function completeCurrentWorkflowStepAfterGuiAction(deps: WorkflowStepCompletionDeps): Promise<boolean> {
  try {
    const result = await Promise.resolve(deps.executeCommand(COMPLETE_WORKFLOW_STEP_COMMAND, { silent: true }))
    if (typeof result === "string" && /^No active Bob workflow step\./.test(result)) {
      await warn(deps, `Could not complete the current Bob workflow step automatically. ${result}`)
      return false
    }
    if (typeof result === "string" && /^Could not capture Bob workflow step result:/.test(result)) {
      await warn(deps, `Could not complete the current Bob workflow step automatically. ${result}`)
      return false
    }
    return true
  } catch (error) {
    await warn(deps, `Could not complete the current Bob workflow step automatically. ${formatError(error)}`)
    return false
  }
}

async function warn(deps: WorkflowStepCompletionDeps, message: string): Promise<void> {
  if (deps.showWarningMessage) await Promise.resolve(deps.showWarningMessage(message))
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
