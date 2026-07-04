# Workflow Authoring Guide

This guide explains how to write `.bob/workflows/<name>/WORKFLOW.md` files for Bob Workflow Register.

## File shape

A workflow file is a Markdown file with YAML front matter.

```md
---
schemaVersion: workflow-register/v1
name: example-workflow
description: Run an example workflow.
title: Example Workflow
steps:
  - id: analyze
    title: Analyze
    type: agent
    prompt: |
      Analyze the current context and summarize the result.
---
# Example Workflow
```

## Required fields

- `name`: Stable workflow name. Use letters, numbers, dots, underscores, and hyphens. It must not start with punctuation.
- `description`: Human-readable workflow purpose.

`schemaVersion: workflow-register/v1` is recommended for all new workflows.

## Steps

`steps` is the main execution plan. Supported step types are:

- `manual`: A human confirmation or checklist step.
- `agent`: An AI step that runs a prompt.
- `command`: A VS Code command or registered action provider step.
- `result`: A step that writes a result to a sink such as a file.

Every step needs `id`, `title`, and `type`.

## Step execution and review gates

Use `stepExecution` when Bob should show engine `steps[]` as visible Bob steps instead of one full workflow entry or legacy Todo entries.

```yaml
stepExecution:
  mode: engineSteps
  allowOutOfOrder: false
  showInBob: true
stepReview:
  enabled: true
  pauseAfter: everyStep
  requireAcceptBeforeNext: true
  allowRetry: true
  allowEditBeforeRetry: true
  preserveAttempts: true
```

- `mode: full`: show one Bob step that runs the full workflow.
- `mode: todo`: show Todo-derived Bob steps.
- `mode: engineSteps`: show each `steps[]` item as a Bob step.
- `allowOutOfOrder: false`: reject a later `singleStep` run until all previous steps are `completed`.
- `stepReview.enabled: true`: successful steps stop in `reviewing`; accept marks the step `completed`, retry archives the attempt and reruns it.

## State flow

Use `resultKey` to store output from a command or agent step. Later steps can read that value with `includeState` or `result.source: state`.

```yaml
steps:
  - id: collect-context
    title: Collect context
    type: command
    action:
      provider: vscode.executeCommand
      args:
        - example.collectContext
    resultKey: collectedContext
  - id: analyze
    title: Analyze
    type: agent
    includeState:
      - collectedContext
    prompt: |
      Analyze the collected context.
```

Manual steps can also produce state with `form.resultKey` or `approval.resultKey`. These keys are available to later `includeState`, `result.source: state`, and `transition.when.stateKey` references.

```yaml
steps:
  - id: collect-user-input
    title: Collect user input
    type: manual
    form:
      resultKey: userRequest
      fields:
        - id: request
          title: Request
          type: string
          required: true
          multiline: true
  - id: user-approval
    title: User approval
    type: manual
    approval:
      resultKey: userApproval
      approveLabel: Approve
      rejectLabel: Reject
```

## Branching and Step-back Loops

Use top-level `branching` plus step-level `transition` when a successful step should conditionally move to another step. Backward `goto` transitions must reference a named loop so the engine can count attempts and stop at a checkpoint.

```yaml
branching:
  enabled: true
  loops:
    - id: revise-until-approved
      entryStep: collect-user-input
      maxIterations: 5
      extensionSize: 5
steps:
  - id: preapproval-check
    title: Preapproval check
    type: command
    resultKey: preapproval
    transition:
      decisions:
        - id: preapproval-ng
          when:
            stateKey: preapproval.status
            equals: ng
          goto: collect-user-input
          loop: revise-until-approved
      default: next
```

Supported condition operators are `equals`, `notEquals`, `in`, `exists`, and `truthy`. A run that reaches the loop limit moves to `checkpoint`; use `workflowRegister.approveBranchCheckpoint`, `workflowRegister.abortBranchCheckpoint`, or `workflowRegister.inspectBranching` to operate on it.

## Inputs

Use `inputs` when the workflow needs user-provided values.

```yaml
inputs:
  target:
    type: string
    title: Target path or topic
    required: true
  outputStyle:
    type: select
    title: Output style
    options:
      - concise
      - detailed
```

A `select` input must include `options`.

## Artifacts

Use `artifacts` to describe outputs created by the workflow.

```yaml
artifacts:
  - id: report
    producedBy: write-report
    path: .bob/artifacts/report.md
```

`producedBy` should reference an existing step id.

## Guardrails

Use `guardrails` to document command restrictions and approval points.

```yaml
guardrails:
  allowedCommands:
    - example.safeCommand
  deniedCommands:
    - example.destructiveCommand
```

A command should not appear in both `allowedCommands` and `deniedCommands`.

## Validation

Run these commands from the Command Palette:

- `Bob Workflow Register: Validate Current Workflow`
- `Bob Workflow Register: Validate Workspace Workflows`

Validation results are shown in a Markdown report and in the VS Code Problems panel. Open workflow files are also validated when saved.
