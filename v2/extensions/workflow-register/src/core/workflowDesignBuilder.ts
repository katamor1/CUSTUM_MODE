import { WorkflowDesignDraft, validateWorkflowDesignDraft } from "./workflowDesignDraft"
import { createWorkflowMarkdown, normalizeWorkflowName, WorkflowTemplateKind } from "./workflowScaffold"
import { formatWorkflowDiagnostics, validateWorkflowText, ValidateWorkflowResult } from "./workflowValidator"

export interface WorkflowDesignBuildOptions {
  sourceId: string
}

export interface WorkflowDesignBuildResult {
  ok: boolean
  name: string
  filePath: string
  markdown?: string
  template: WorkflowTemplateKind
  validation?: ValidateWorkflowResult
  errors: string[]
  warnings: string[]
  reportLines: string[]
}

export function buildWorkflowFromDesignDraft(draft: WorkflowDesignDraft, options: WorkflowDesignBuildOptions): WorkflowDesignBuildResult {
  const draftValidation = validateWorkflowDesignDraft(draft)
  const name = normalizeWorkflowName(draft.name)
  const title = draft.title?.trim() || titleFromName(name)
  const description = draft.description.trim()
  const template = draft.template ?? chooseTemplate(draft)
  const filePath = `.bob/workflows/${name}/WORKFLOW.md`
  if (!draftValidation.ok) {
    return {
      ok: false,
      name,
      filePath,
      template,
      errors: draftValidation.errors,
      warnings: draftValidation.warnings,
      reportLines: ["## Draft validation", "", ...draftValidation.errors.map((error) => `- error: ${error}`), ...draftValidation.warnings.map((warning) => `- warning: ${warning}`)]
    }
  }

  const markdown = applyDraftCustomizations(createWorkflowMarkdown({ name, title, description, template }), draft)
  const validation = validateWorkflowText({ sourceId: options.sourceId, filePath, text: markdown })
  return {
    ok: validation.ok,
    name,
    filePath,
    markdown,
    template,
    validation,
    errors: validation.diagnostics.filter((item) => item.severity === "error").map((item) => item.message),
    warnings: [...draftValidation.warnings, ...validation.diagnostics.filter((item) => item.severity === "warning").map((item) => item.message)],
    reportLines: ["## Draft", "", `- name: ${name}`, `- title: ${title}`, `- template: ${template}`, "", "## Workflow validation", "", ...formatWorkflowDiagnostics(validation)]
  }
}

export function chooseTemplate(draft: WorkflowDesignDraft): WorkflowTemplateKind {
  if (draft.template) return draft.template
  if ((draft.guardrails?.allowedCommands?.length ?? 0) > 0 || (draft.guardrails?.deniedCommands?.length ?? 0) > 0) return "guarded-command"
  if ((draft.artifacts?.length ?? 0) > 0) return "artifact-output"
  if ((draft.inputs?.length ?? 0) > 0) return "input-driven-agent"
  if ((draft.steps ?? []).some((step) => (step.type ?? "agent") === "command")) return "command-then-agent"
  if ((draft.steps ?? []).every((step) => step.type === "manual") && (draft.steps?.length ?? 0) > 0) return "manual-checklist"
  return "simple-agent"
}

function applyDraftCustomizations(markdown: string, draft: WorkflowDesignDraft): string {
  let next = markdown
  const notes = draft.notes?.map((note) => `- ${note}`).join("\n")
  if (notes) next = `${next.trimEnd()}\n\n## Design Notes\n\n${notes}\n`
  return next
}

function titleFromName(name: string): string {
  return name.split(/[._-]+/).filter(Boolean).map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ") || "New Workflow"
}
