import { AgentExecutionInput, AgentProvider } from "./model"

export interface CommandAgentProviderOptions {
  command?: string
  executeCommand: (command: string, input: AgentExecutionInput) => Promise<unknown> | unknown
}

export function createCommandAgentProvider(options: CommandAgentProviderOptions): AgentProvider | undefined {
  const command = options.command?.trim()
  if (!command) return undefined
  return {
    run: async (input) => agentResultText(await Promise.resolve(options.executeCommand(command, input)))
  }
}

function agentResultText(value: unknown): string {
  if (typeof value === "string") return value
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    for (const key of ["text", "result", "output", "content"]) {
      if (typeof record[key] === "string") return record[key] as string
    }
  }
  throw new Error("Agent provider command must return a string or an object with text, result, output, or content.")
}
