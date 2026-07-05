---
schemaVersion: workflow-register/v1
name: mechanical-checks-parser-pilot
title: 機械チェック parser pilot smoke
description: SARIF / CSV / delta / known IDs を含む parser pilot profile を workflow step から実行するサンプルです。
category: code-review
mode: agent
todo: true
todoRequired: true
todoAsSteps: true
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
requires:
  workspace: true
  files:
    - .bob/checks/mechanical-checks.yaml
guardrails:
  allowedCommands:
    - workflowRegister.runMechanicalChecks
branching:
  enabled: true
  loops: []
artifacts:
  - id: parserPilotResult
    producedBy: run-parser-pilot-checks
    path: .bob/mechanical-checks/runs/{{json state.parserPilotResult.run_id}}/profile-result.json
    schema: bob-mechanical-check-profile-result/v1
completion:
  summary: markdown
  includeArtifacts: true
  validateResult: true
steps:
  - id: run-parser-pilot-checks
    title: Parser pilot 機械チェックを実行
    type: command
    action:
      provider: workflowRegister.runMechanicalChecks
      args:
        profile: pre-code-review-parser-pilot
    resultKey: parserPilotResult
    sendResult: true
    maxResultBytes: 30000
    required: true
    completeOnSuccess: true
    transition:
      decisions:
        - id: checks-passed
          when:
            stateKey: parserPilotResult.status
            equals: passed
          goto: review-parser-pilot-result
        - id: checks-warning
          when:
            stateKey: parserPilotResult.status
            equals: warning
          goto: review-parser-pilot-result
      default: fail
  - id: review-parser-pilot-result
    title: Parser pilot 結果を確認
    type: manual
    userAction:
      message: .bob/mechanical-checks/runs 配下の profile-summary.md、profile-result.json、evidence を確認してください。
      completeLabel: 確認完了
      confirmOnComplete: true
      confirmMessage: Parser pilot の result と evidence を確認済みですか？
---

## 目的

SARIF / CSV / baseline-target delta / known IDs が workflow command step の結果として保存されることを確認する smoke です。

## 期待結果

fixture は意図的に新規 warning / finding / mismatch を含むため、profile status は `failed` になります。
