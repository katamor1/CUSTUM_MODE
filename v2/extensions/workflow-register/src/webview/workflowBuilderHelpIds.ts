export const WorkflowBuilderHelpIds = {
  TabStep: "tab.step",
  TabInputs: "tab.inputs",
  TabRequires: "tab.requires",
  TabPreflight: "tab.preflight",
  TabArtifacts: "tab.artifacts",
  TabGuardrails: "tab.guardrails",
  TabCompletion: "tab.completion",
  TabBody: "tab.body",
  TabPreview: "tab.preview",

  TemplateSelect: "template.select",

  AddAgentStep: "steps.addAgent",
  AddCommandStep: "steps.addCommand",
  AddManualStep: "steps.addManual",
  AddResultStep: "steps.addResult",

  MetaName: "meta.name",
  MetaTitle: "meta.title",
  MetaDescription: "meta.description",
  MetaWorkspaceRequired: "meta.workspaceRequired",

  StepId: "step.id",
  StepType: "step.type",
  StepTitle: "step.title",
  StepRequired: "step.required",
  StepStateRequired: "step.stateRequired",
  StepResultKey: "step.resultKey",
  StepIncludeState: "step.includeState",
  StepMaxResultBytes: "step.maxResultBytes",
  StepPrompt: "step.prompt",
  StepUserActionMessage: "step.userAction.message",
  StepUserActionCompleteLabel: "step.userAction.completeLabel",
  StepUserActionConfirmOnComplete: "step.userAction.confirmOnComplete",
  StepUserActionConfirmMessage: "step.userAction.confirmMessage",

  SectionIncludeState: "section.includeState",
  SectionCommand: "section.command",
  SectionResult: "section.result",
  SectionUserAction: "section.userAction",

  CommandProvider: "command.provider",
  CommandCommandId: "command.commandId",
  CommandExtraArgs: "command.extraArgs",
  CommandSendResult: "step.sendResult",
  CommandCompleteOnSuccess: "step.completeOnSuccess",

  ResultSource: "result.source",
  ResultStateKey: "result.stateKey",
  ResultText: "result.text",
  ResultPath: "result.path",

  InputId: "input.id",
  InputType: "input.type",
  InputTitle: "input.title",
  InputRequired: "input.required",
  InputOptions: "input.options",

  RequiresWorkspace: "requires.workspace",
  RequiresBobMinVersion: "requires.bobMinVersion",
  RequiresFiles: "requires.files",

  PreflightId: "preflight.id",
  PreflightFailurePolicy: "preflight.failurePolicy",
  PreflightTitle: "preflight.title",
  PreflightRequired: "preflight.required",
  PreflightChecks: "preflight.checks",
  PreflightFiles: "preflight.files",

  ArtifactId: "artifact.id",
  ArtifactProducedBy: "artifact.producedBy",
  ArtifactPath: "artifact.path",

  GuardrailsAllowedCommands: "guardrails.allowedCommands",
  GuardrailsDeniedCommands: "guardrails.deniedCommands",
  GuardrailsAllowedCommandIds: "guardrails.allowedCommandIds",
  GuardrailsDeniedCommandIds: "guardrails.deniedCommandIds",
  ApprovalId: "approval.id",
  ApprovalWhen: "approval.when",
  ApprovalMessage: "approval.message",

  CompletionSummary: "completion.summary",
  CompletionIncludeArtifacts: "completion.includeArtifacts",
  CompletionValidateResult: "completion.validateResult",
  CompletionVisualizationType: "completion.visualizationType",
  CompletionVisualizationEnabled: "completion.visualizationEnabled",

  BodyBody: "body.body"
} as const

export type WorkflowBuilderHelpId = typeof WorkflowBuilderHelpIds[keyof typeof WorkflowBuilderHelpIds]

export const workflowBuilderHelpIdValues: WorkflowBuilderHelpId[] = Object.values(WorkflowBuilderHelpIds)

export function isWorkflowBuilderHelpId(value: string): value is WorkflowBuilderHelpId {
  return workflowBuilderHelpIdValues.includes(value as WorkflowBuilderHelpId)
}
