# Workflow AI Provider Pipeline

Phase 10-11 introduces a provider boundary between VS Code commands and workflow authoring logic.

## Provider contract

The central interface is `WorkflowAiProvider`.

```ts
export interface WorkflowAiProvider {
  readonly id: string
  designWorkflow(input: WorkflowAiDesignInput): Promise<WorkflowDesignDraft> | WorkflowDesignDraft
  improveWorkflow(input: WorkflowAiRepairInput): Promise<WorkflowRepairProposal> | WorkflowRepairProposal
  explainDiagnostics(input: WorkflowAiExplainInput): Promise<WorkflowDiagnosticExplanation> | WorkflowDiagnosticExplanation
}
```

The provider never writes files directly. It returns drafts, proposals, or explanations. The command layer then routes the output through the existing builder, validator, and preview/report flow.

## Design flow

```text
Command: workflowRegister.designWorkflowWithAi
  -> collect goal and optional preferred template
  -> WorkflowAiProvider.designWorkflow()
  -> WorkflowDesignDraft
  -> buildWorkflowFromDesignDraft()
  -> validateWorkflowText()
  -> save only when valid
```

This means even a future real AI provider cannot bypass `WorkflowDesignDraft` validation or `WORKFLOW.md` validation.

## Improve flow

```text
Command: workflowRegister.improveWorkflowWithAi
  -> validate active WORKFLOW.md
  -> buildWorkflowRepairContext()
  -> WorkflowAiProvider.improveWorkflow()
  -> WorkflowRepairProposal
  -> report proposal
  -> validate replacementMarkdown when present
  -> preview only when valid
```

The command does not overwrite the existing workflow automatically. Replacement Markdown is opened as a preview document only when validation succeeds.

## Explain flow

```text
Command: workflowRegister.explainWorkflowDiagnostics
  -> validate active WORKFLOW.md
  -> buildWorkflowRepairContext()
  -> WorkflowAiProvider.explainDiagnostics()
  -> human-readable explanation report
```

## Mock provider

`createMockWorkflowAiProvider()` provides deterministic behavior for local testing and development.

Goal-based template selection:

- `review` -> `review-workflow`
- `artifact`, `report`, `document` -> `artifact-output`
- `input`, `parameter`, `option` -> `input-driven-agent`
- `command`, `collect` -> `command-then-agent`
- `checklist`, `manual` -> `manual-checklist`
- `safe`, `guard` -> `guarded-command`
- otherwise -> `simple-agent`

The mock provider intentionally does not rewrite workflow files. Repair output is report-only by default.

## Safety gates

Provider output is considered untrusted.

Required safety gates:

1. Drafts must pass `validateWorkflowDesignDraft()`.
2. Generated Markdown must pass `validateWorkflowText()`.
3. Repair proposals with `replacementMarkdown` must pass `validateWorkflowText()` before preview.
4. Commands must not auto-overwrite existing workflow files from provider output.

## Future real provider

A later phase can add a command-backed provider or Bob/OpenAI/Copilot integration:

```text
workflowRegister.aiProviderCommand
  input: { kind: design | improve | explain, payload: ... }
  output: draft | repairProposal | explanation
```

That future provider should still implement the same `WorkflowAiProvider` contract and keep the same safety gates.
