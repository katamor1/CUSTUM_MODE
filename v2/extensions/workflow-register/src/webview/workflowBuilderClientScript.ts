import { renderWorkflowBuilderActionEventsScript } from "./workflowBuilderActionEventsScript"
import { renderWorkflowBuilderClientStateScript } from "./workflowBuilderClientStateScript"
import { renderWorkflowBuilderCoreRendererScript } from "./workflowBuilderCoreRendererScript"
import { renderWorkflowBuilderFieldEventsScript } from "./workflowBuilderFieldEventsScript"
import { renderWorkflowBuilderPreviewScript } from "./workflowBuilderPreviewScript"
import { renderWorkflowBuilderStepOperationsScript } from "./workflowBuilderStepOperationsScript"
import { renderWorkflowBuilderStepRendererScript } from "./workflowBuilderStepRendererScript"
import { renderWorkflowBuilderTabRenderersScript } from "./workflowBuilderTabRenderersScript"

export function renderWorkflowBuilderClientScript(): string {
  return [
    renderWorkflowBuilderClientStateScript(),
    renderWorkflowBuilderCoreRendererScript(),
    renderWorkflowBuilderStepRendererScript(),
    renderWorkflowBuilderTabRenderersScript(),
    renderWorkflowBuilderPreviewScript(),
    renderWorkflowBuilderStepOperationsScript(),
    renderWorkflowBuilderFieldEventsScript(),
    renderWorkflowBuilderActionEventsScript()
  ].join("\n")
}
