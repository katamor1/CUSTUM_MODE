# Workflow AI Authoring Pipeline

Phase 8-9 introduces a safer AI authoring pipeline for Bob workflows.

## Principle

Do not let an AI assistant write final `WORKFLOW.md` YAML directly as the source of truth.

Use this pipeline instead:

```text
User or AI intent
  -> WorkflowDesignDraft
  -> WorkflowDesignBuilder
  -> generated WORKFLOW.md
  -> validateWorkflowText()
  -> save only when valid
```

## WorkflowDesignDraft

`WorkflowDesignDraft` is a small intermediate design object. It captures the workflow goal and high-level shape without requiring the author to hand-write YAML.

Minimal draft:

```json
{
  "name": "review-docs",
  "title": "Review Docs",
  "description": "Review the selected documentation target.",
  "template": "input-driven-agent"
}
```

Supported draft sections include:

- `inputs`
- `steps`
- `artifacts`
- `guardrails`
- `notes`

Draft validation catches design-level problems before YAML generation, such as duplicate ids, select inputs without options, command steps without providers, and artifacts referencing unknown steps.

## WorkflowDesignBuilder

The builder converts a draft into `WORKFLOW.md` by choosing a template and routing through the existing scaffold and validator.

Template selection rules:

- Guardrails -> `guarded-command`
- Artifacts -> `artifact-output`
- Inputs -> `input-driven-agent`
- Command steps -> `command-then-agent`
- Manual-only steps -> `manual-checklist`
- Otherwise -> `simple-agent`

The builder returns:

- normalized workflow name
- target file path
- selected template
- generated Markdown
- validator result
- report lines for display

## Commands

### Design Workflow with AI

Command id:

```text
workflowRegister.designWorkflowWithAi
```

Current implementation is a safe skeleton. It collects workflow name, title, description, and template through VS Code input prompts, builds a `WorkflowDesignDraft`, generates `WORKFLOW.md`, validates it, and saves only if validation passes.

This can later be swapped from manual prompts to an AI-generated draft without changing the builder contract.

### Improve Workflow with AI

Command id:

```text
workflowRegister.improveWorkflowWithAi
```

Current implementation validates the active `WORKFLOW.md` and emits a repair context JSON. The JSON is meant to be passed to a future AI repair step.

### Explain Workflow Diagnostics

Command id:

```text
workflowRegister.explainWorkflowDiagnostics
```

Current implementation validates the active workflow and renders diagnostics, hints, repair targets, and repair context JSON in a Markdown report.

## Repair context

Repair context shape:

```json
{
  "filePath": ".bob/workflows/sample/WORKFLOW.md",
  "status": "invalid",
  "problems": [
    {
      "severity": "error",
      "message": "Step 'analyze' includeState references unknown resultKey 'context'.",
      "likelyFix": "Add a matching resultKey to an earlier command or agent step, or remove the includeState entry.",
      "repairTarget": "steps[].includeState"
    }
  ]
}
```

This keeps future AI repair focused on a specific target instead of asking the model to rewrite the entire workflow blindly.

## Next step

A future phase can replace the manual draft collector with a real AI draft provider:

```text
prompt -> AI draft JSON -> validateWorkflowDesignDraft() -> buildWorkflowFromDesignDraft()
```

The AI provider should still never bypass the builder and validator.
