import { WorkflowGuardrailsDefinition } from "./model"

export interface WorkflowGuardrailsCarrier {
  guardrails?: WorkflowGuardrailsDefinition
}

export function validateCommandGuardrails(workflow: WorkflowGuardrailsCarrier, providerId: string, args?: unknown): string | undefined {
  const guardrails = workflow.guardrails ?? {}
  if (guardrails.deniedCommands?.includes(providerId)) return `Command is denied by workflow guardrails: ${providerId}`
  if (guardrails.allowedCommands && guardrails.allowedCommands.length > 0 && !guardrails.allowedCommands.includes(providerId)) return `Command is not allowed by workflow guardrails: ${providerId}`
  if (providerId !== "vscode.executeCommand") return undefined

  const commandId = firstArgument(args)
  if (typeof commandId !== "string" || !commandId.trim()) return "VS Code command id is required for vscode.executeCommand guardrails."
  if (guardrails.deniedCommandIds?.includes(commandId)) return `VS Code command id is denied by workflow guardrails: ${commandId}`
  if (!guardrails.allowedCommandIds || guardrails.allowedCommandIds.length === 0) return `VS Code command id allowlist is required by workflow guardrails: ${commandId}`
  if (!guardrails.allowedCommandIds.includes(commandId)) return `VS Code command id is not allowed by workflow guardrails: ${commandId}`
  return undefined
}

function firstArgument(value: unknown): unknown {
  if (Array.isArray(value)) return value[0]
  return value
}
