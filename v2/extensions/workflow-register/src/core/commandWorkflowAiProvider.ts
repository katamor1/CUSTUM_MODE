import { WorkflowAiDesignInput, WorkflowAiExplainInput, WorkflowAiProvider, WorkflowAiRepairInput, WorkflowDiagnosticExplanation, WorkflowRepairProposal } from "./workflowAiProvider"
import { validateWorkflowAiDesignOutput, validateWorkflowAiExplainOutput, validateWorkflowAiRepairOutput } from "./workflowAiProviderValidator"
import { WorkflowDesignDraft } from "./workflowDesignDraft"

export interface CommandWorkflowAiProviderOptions {
  command: string
  executeCommand: (command: string, input: CommandWorkflowAiProviderRequest) => Promise<unknown> | unknown
}

export type CommandWorkflowAiProviderRequest =
  | { kind: "design"; payload: WorkflowAiDesignInput }
  | { kind: "improve"; payload: WorkflowAiRepairInput }
  | { kind: "explain"; payload: WorkflowAiExplainInput }

export class CommandWorkflowAiProvider implements WorkflowAiProvider {
  readonly id: string
  private readonly command: string
  private readonly executeCommand: CommandWorkflowAiProviderOptions["executeCommand"]

  constructor(options: CommandWorkflowAiProviderOptions) {
    if (!options.command.trim()) throw new Error("AI provider command id is required.")
    this.command = options.command.trim()
    this.id = `command:${this.command}`
    this.executeCommand = options.executeCommand
  }

  async designWorkflow(input: WorkflowAiDesignInput): Promise<WorkflowDesignDraft> {
    const raw = await Promise.resolve(this.executeCommand(this.command, { kind: "design", payload: input }))
    const validation = validateWorkflowAiDesignOutput(raw)
    if (!validation.ok || !validation.value) throw new Error(`Invalid AI design output: ${validation.errors.join("; ")}`)
    return validation.value
  }

  async improveWorkflow(input: WorkflowAiRepairInput): Promise<WorkflowRepairProposal> {
    const raw = await Promise.resolve(this.executeCommand(this.command, { kind: "improve", payload: input }))
    const validation = validateWorkflowAiRepairOutput(raw)
    if (!validation.ok || !validation.value) throw new Error(`Invalid AI repair output: ${validation.errors.join("; ")}`)
    return validation.value
  }

  async explainDiagnostics(input: WorkflowAiExplainInput): Promise<WorkflowDiagnosticExplanation> {
    const raw = await Promise.resolve(this.executeCommand(this.command, { kind: "explain", payload: input }))
    const validation = validateWorkflowAiExplainOutput(raw)
    if (!validation.ok || !validation.value) throw new Error(`Invalid AI explanation output: ${validation.errors.join("; ")}`)
    return validation.value
  }
}
