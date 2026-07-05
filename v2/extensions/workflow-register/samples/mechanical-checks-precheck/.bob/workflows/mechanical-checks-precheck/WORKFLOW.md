---
schemaVersion: workflow-register/v1
name: mechanical-checks-precheck
title: 機械チェック pre-code-review smoke
description: .bob/checks/mechanical-checks.yaml の pre-code-review profile を workflow step から実行するサンプルです。
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
inputs:
  baseRevision:
    type: string
    title: 比較元 revision
    default: HEAD~1
  targetRevision:
    type: string
    title: 比較先 revision
    default: HEAD
artifacts:
  - id: mechanicalCheckResult
    producedBy: run-mechanical-checks
    path: .bob/mechanical-checks/runs/{{json state.mechanicalCheckResult.run_id}}/profile-result.json
    schema: bob-mechanical-check-profile-result/v1
completion:
  summary: markdown
  includeArtifacts: true
  validateResult: true
steps:
  - id: run-mechanical-checks
    title: コードレビュー前の機械チェックを実行
    type: command
    action:
      provider: workflowRegister.runMechanicalChecks
      args:
        profile: pre-code-review
        baseRevision: "{{inputs.baseRevision}}"
        targetRevision: "{{inputs.targetRevision}}"
    resultKey: mechanicalCheckResult
    sendResult: true
    maxResultBytes: 30000
    required: true
    completeOnSuccess: true
    transition:
      decisions:
        - id: checks-passed
          when:
            stateKey: mechanicalCheckResult.status
            equals: passed
          goto: review-mechanical-check-result
        - id: checks-warning
          when:
            stateKey: mechanicalCheckResult.status
            equals: warning
          goto: review-mechanical-check-result
      default: fail
  - id: review-mechanical-check-result
    title: 機械チェック結果を確認
    type: manual
    userAction:
      message: .bob/mechanical-checks/runs 配下の profile-summary.md と evidence を確認してください。
      completeLabel: 確認完了
      confirmOnComplete: true
      confirmMessage: 機械チェック結果と evidence を確認済みですか？
---

## 目的

既存の bat / PowerShell / Python / Node / exe を Bob に実行させず、`workflow-register` の command step から deterministic に実行する最小サンプルです。

## 運用メモ

- pass / fail / blocked の source of truth は `.bob/mechanical-checks/runs/<runId>/profile-result.json` です。
- `failed` と `blocked` はこのサンプル workflow では `transition.default: fail` により後続 step へ進めません。
- `warning` は人間確認 step へ進めます。
