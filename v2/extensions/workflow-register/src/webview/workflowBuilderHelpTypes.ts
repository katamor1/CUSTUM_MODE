export interface WorkflowBuilderHelpOption {
  label: string
  summary: string
  effect: string
  caution?: string
}

export interface WorkflowBuilderHelpEntry {
  id: string
  labelJa: string
  fieldKey: string
  summary: string
  effect: string
  whenToUse?: string
  caution?: string
  example?: string
  related?: string[]
  options?: Record<string, WorkflowBuilderHelpOption>
}
