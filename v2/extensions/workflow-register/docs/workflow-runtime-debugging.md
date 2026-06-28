# Workflow Runtime Debugging

This guide explains how to debug workflow execution after a `WORKFLOW.md` file validates successfully.

## Runtime checks covered by the engine

The standalone workflow engine performs runtime checks that are different from authoring validation.

Current runtime behavior includes:

- Required workflow inputs are validated before execution.
- `requires.workspace` can fail when no workspace is available.
- `requires.files` and `preflight[].files` are checked before steps run.
- `failurePolicy: stop` fails the run when a required preflight check fails.
- Agent prompts render placeholders such as `{{inputs.target}}` and `{{state.context}}`.
- Command step arguments render the same placeholder style.
- Result steps can write state or agent output to result sinks.
- File result sinks refuse paths that escape the workspace.
- Guardrails can deny or allow command providers at runtime.

## Inspecting run failures

Use the Command Palette command:

```text
Bob Workflow Register: Inspect Workflow Run Diagnostics
```

The report shows:

- Run id
- Workflow id and name
- Run status
- Current step
- Run error
- Failed or held step
- State keys captured so far
- Per-step status
- Suggested fix for common failure patterns

## Common failures

### Unsupported action provider

```text
Unsupported action provider: example.collectReviewContext
```

Fix: register an `ActionProvider` for that id, or use `vscode.executeCommand` with a real VS Code command id in `action.args`.

### Missing required file

```text
Workflow preflight failed: Required workflow file is missing: package.json
```

Fix: create the file or remove it from `requires.files` / `preflight.files`.

### Missing state key

```text
Workflow state is missing: analysisReport
```

Fix: check that an earlier step uses `resultKey: analysisReport`, and that the producing step runs before the consuming step.

### Agent provider missing

```text
Agent provider is required for agent workflow steps.
```

Fix: configure `workflowRegister.agentCommand` or register an `AgentProvider` through the extension API.

### Guardrail rejected command

```text
Command is not allowed by workflow guardrails: vscode.executeCommand
```

Fix: add the provider to `guardrails.allowedCommands`, remove the allowlist, or choose a different provider.

## Placeholder rendering

Supported placeholders include:

```text
{{inputs.target}}
{{state.collectedContext}}
{{run.id}}
{{workflow.id}}
{{step.id}}
```

Short names are also resolved from inputs or state when unambiguous:

```text
{{target}}
{{collectedContext}}
```

Unknown placeholders are left unchanged so the report can reveal the unresolved value.

## Debugging checklist

1. Validate the workflow first.
2. Run the workflow.
3. If it fails, inspect run diagnostics.
4. Fix the first failed step.
5. Retry the current step or rerun the workflow.
6. Confirm that expected state keys and artifacts are created.
