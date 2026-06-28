import { CommandWorkflowAiProvider } from "./commandWorkflowAiProvider"
import { createMockWorkflowAiProvider } from "./mockWorkflowAiProvider"
import { WorkflowAiProvider } from "./workflowAiProvider"

export interface WorkflowAiProviderFactoryOptions {
  command?: string
  executeCommand: (command: string, input: unknown) => Promise<unknown> | unknown
}

export function createConfiguredWorkflowAiProvider(options: WorkflowAiProviderFactoryOptions): WorkflowAiProvider {
  const command = options.command?.trim()
  if (command) {
    return new CommandWorkflowAiProvider({
      command,
      executeCommand: (commandId, input) => options.executeCommand(commandId, input)
    })
  }
  return createMockWorkflowAiProvider()
}
