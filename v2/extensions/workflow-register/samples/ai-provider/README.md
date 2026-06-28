# Sample Workflow AI Provider

This sample shows how another VS Code extension can provide workflow AI output to `workflow-register` without importing workflow-register internals.

## Configure workflow-register

Set:

```json
{
  "workflowRegister.aiProviderCommand": "sampleWorkflowAiProvider.provide"
}
```

## Command contract

The sample registers:

```text
sampleWorkflowAiProvider.provide
```

The command receives one request object:

```ts
{
  kind: "design" | "improve" | "explain",
  payload: unknown
}
```

It returns plain JSON-compatible objects:

- `WorkflowDesignDraft` for `kind: "design"`
- `WorkflowRepairProposal` for `kind: "improve"`
- `WorkflowDiagnosticExplanation` for `kind: "explain"`

The provider does not write files. workflow-register validates and applies safety gates.

## Run locally

This sample is intentionally small. In a real setup, package it as a separate VS Code extension and enable it beside workflow-register.
