# Workflow AI Design Guide

This guide describes how an AI assistant should help design `WORKFLOW.md` files.

## Core rule

Do not treat free-form YAML generation as the source of truth.

Preferred flow:

1. Ask for the workflow goal and constraints.
2. Build a small intermediate design object.
3. Choose the closest scaffold template.
4. Generate `WORKFLOW.md` through the scaffold or a typed builder.
5. Run `validateWorkflowText()`.
6. Fix diagnostics before saving or recommending the workflow.

## Intermediate design shape

```json
{
  "goal": "Review changed files and produce a Markdown report.",
  "inputs": [],
  "steps": [],
  "artifacts": [],
  "guardrails": []
}
```

The exact design shape can evolve, but it should remain easier to validate than hand-written YAML.

## Template selection

- Use `simple-agent` for one prompt.
- Use `command-then-agent` when a command must collect context first.
- Use `input-driven-agent` when the user needs to answer questions.
- Use `preflight-files` when required files must exist.
- Use `artifact-output` when the workflow creates a file.
- Use `guarded-command` when command safety is important.
- Use `review-workflow` for review-style tasks.

## Validation loop

AI-generated workflows must be validated before use.

If validation returns errors:

- Fix schema errors first.
- Then fix semantic references such as `includeState`, `resultKey`, and `producedBy`.
- Re-run validation.
- Only save or present the final workflow when `ok=true`.

## Avoid these patterns

- Do not invent unsupported top-level fields without documenting them.
- Do not reference state keys that no earlier step produces.
- Do not create command steps without a provider.
- Do not put the same command in both `allowedCommands` and `deniedCommands`.
- Do not create `select` inputs without options.

## Future commands

Planned AI-oriented commands can follow this pattern:

- `workflowRegister.designWorkflowWithAi`
- `workflowRegister.improveWorkflowWithAi`
- `workflowRegister.explainWorkflowDiagnostics`

These commands should call the same scaffold and validator used by human authoring flows.
