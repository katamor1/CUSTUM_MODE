import { renderWorkflowBuilderHelpBaseScript } from "./workflowBuilderHelpBaseScript"
import { renderWorkflowBuilderHelpEventsScript } from "./workflowBuilderHelpEventsScript"
import { renderWorkflowBuilderHelpCatalogSupplementScript, renderWorkflowBuilderHelpTabSupplementScript } from "./workflowBuilderHelpSupplementScript"
import { renderWorkflowBuilderHelpTargetsScript } from "./workflowBuilderHelpTargetsScript"

export function renderWorkflowBuilderHelpScript(): string {
  return [
    renderWorkflowBuilderHelpCatalogSupplementScript(),
    renderWorkflowBuilderHelpBaseScript(),
    renderWorkflowBuilderHelpTargetsScript(),
    renderWorkflowBuilderHelpEventsScript(),
    renderWorkflowBuilderHelpTabSupplementScript()
  ].join("\n")
}
