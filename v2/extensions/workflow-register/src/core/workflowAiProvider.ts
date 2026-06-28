import { WorkflowDesignDraft } from "./workflowDesignDraft"
import { WorkflowRepairContext } from "./workflowRepairContext"
import { WorkflowTemplateKind } from "./workflowScaffold"

export interface WorkflowAiDesignInput {
  goal: string
  preferredTemplate?: WorkflowTemplateKind
  workspaceHints?: string[]
}

export interface WorkflowAiRepairInput {
  filePath: string
  workflowText: string
  repairContext: WorkflowRepairContext
}

export interface WorkflowAiExplainInput {
  filePath: string
  repairContext: WorkflowRepairContext
}

export interface WorkflowRepairProposal {
  summary: string
  draft?: WorkflowDesignDraft
  replacementMarkdown?: string
  notes: string[]
}

export interface WorkflowDiagnosticExplanation {
  summary: string
  items: WorkflowDiagnosticExplanationItem[]
}

export interface WorkflowDiagnosticExplanationItem {
  message: string
  explanation: string
  likelyFix?: string
  repairTarget?: string
}

export interface WorkflowAiProvider {
  readonly id: string
  designWorkflow: (input: WorkflowAiDesignInput) => Promise<WorkflowDesignDraft> | WorkflowDesignDraft
  improveWorkflow: (input: WorkflowAiRepairInput) => Promise<WorkflowRepairProposal> | WorkflowRepairProposal
  explainDiagnostics: (input: WorkflowAiExplainInput) => Promise<WorkflowDiagnosticExplanation> | WorkflowDiagnosticExplanation
}

export function formatWorkflowRepairProposal(proposal: WorkflowRepairProposal): string[] {
  const lines = ["## AI repair proposal", "", proposal.summary]
  if (proposal.notes.length > 0) lines.push("", "### Notes", "", ...proposal.notes.map((note) => `- ${note}`))
  if (proposal.draft) lines.push("", "### Draft", "", "```json", JSON.stringify(proposal.draft, null, 2), "```")
  if (proposal.replacementMarkdown) lines.push("", "### Replacement preview", "", "```md", proposal.replacementMarkdown, "```")
  return lines
}

export function formatWorkflowDiagnosticExplanation(explanation: WorkflowDiagnosticExplanation): string[] {
  const lines = ["## AI diagnostic explanation", "", explanation.summary]
  if (explanation.items.length === 0) return [...lines, "", "- No workflow diagnostics to explain."]
  lines.push("")
  for (const item of explanation.items) {
    lines.push(`- ${item.message}`, `  - explanation: ${item.explanation}`)
    if (item.repairTarget) lines.push(`  - repairTarget: ${item.repairTarget}`)
    if (item.likelyFix) lines.push(`  - likelyFix: ${item.likelyFix}`)
  }
  return lines
}
