import { WorkflowGuardrailsDefinition } from "./model"

export interface WorkflowGuardrailsCarrier {
  guardrails?: WorkflowGuardrailsDefinition
}

export function validateCommandGuardrails(workflow: WorkflowGuardrailsCarrier, providerId: string): string | undefined {
  const guardrails = workflow.guardrails ?? {}
  if (guardrails.deniedCommands?.includes(providerId)) return `Command is denied by workflow guardrails: ${providerId}`
  if (guardrails.allowedCommands && guardrails.allowedCommands.length > 0 && !guardrails.allowedCommands.includes(providerId)) return `Command is not allowed by workflow guardrails: ${providerId}`
  return undefined
}
