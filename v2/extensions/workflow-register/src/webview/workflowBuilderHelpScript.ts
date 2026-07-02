import { renderWorkflowBuilderHelpBaseScript } from "./workflowBuilderHelpBaseScript"
import { renderWorkflowBuilderHelpEventsScript } from "./workflowBuilderHelpEventsScript"
import { renderWorkflowBuilderHelpTargetsScript } from "./workflowBuilderHelpTargetsScript"

export function renderWorkflowBuilderHelpScript(): string {
  return [
    renderWorkflowBuilderHelpBaseScript(),
    renderWorkflowBuilderHelpTargetsScript(),
    renderWorkflowBuilderHelpEventsScript()
  ].join("\n")
}
