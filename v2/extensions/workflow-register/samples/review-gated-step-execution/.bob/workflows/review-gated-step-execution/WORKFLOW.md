---
schemaVersion: workflow-register/v1
name: review-gated-step-execution
description: Review-gated engine step execution smoke sample.
title: Review-gated Step Execution
mode: agent
todo: true
todoAsSteps: false
stepCompletion: auto
stepMessage: step
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
permissions:
  - read
  - mcp
  - skill
autoApproval: true
workspaceRequired: false
inputs:
  topic:
    type: string
    title: Topic
    default: review gate smoke
guardrails:
  allowedCommands:
    - vscode.open
  deniedCommands:
    - shell
artifacts:
  - id: draftText
    producedBy: draft-output
    path: .bob/workflows/runs/{{run.id}}/draft-output.txt
completion:
  summary: markdown
  includeArtifacts: true
  validateResult: false
steps:
  - id: collect-input
    title: Collect input
    type: result
    result:
      source: literal
      text: "Collected topic: {{inputs.topic}}"
      sinks:
        - type: file
          path: .bob/workflows/runs/{{run.id}}/collect-input.txt
  - id: draft-output
    title: Draft output
    type: agent
    prompt: |
      Produce a three-line smoke-test note for topic: {{inputs.topic}}
    resultKey: draftText
    result:
      source: agent
      sinks:
        - type: file
          path: .bob/workflows/runs/{{run.id}}/draft-output.txt
  - id: save-output
    title: Save final output
    type: result
    includeState:
      - draftText
    stateRequired: true
    result:
      source: state
      stateKey: draftText
      sinks:
        - type: file
          path: .bob/workflows/runs/{{run.id}}/final-output.txt
---
# Review-gated Step Execution

Use this sample to verify that each `steps[]` item appears as a Bob-visible step and that successful execution stops in `reviewing` until accepted.
