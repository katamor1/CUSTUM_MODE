---
schemaVersion: workflow-register/v1
name: process-common-review
title: 共通レビュー
description: 工程を問わないレビュー対象を、共通チェックリストと工程記録の形で確認します。
category: process-workflow
mode: agent
todo: true
todoRequired: true
todoAsSteps: true
stepCompletion: manual
stepMessage: step
stepExecution:
  mode: engineSteps
  allowOutOfOrder: false
  showInBob: true
stepReview:
  enabled: true
  pauseAfter: agentAndCommand
  requireAcceptBeforeNext: true
  allowRetry: true
  allowEditBeforeRetry: true
  preserveAttempts: true
autoApproval: true
workspaceRequired: true
permissions:
  - read
  - todo
requires:
  workspace: true
  bob:
    minVersion: "2.0.0"
inputs:
  processInputPath:
    type: string
    title: process-input.yaml
    default: process-input.yaml
  catalogPath:
    type: string
    title: process catalog
    default: .bob/process/process-catalog.yaml
guardrails:
  allowedCommands:
    - vscode.executeCommand
  allowedCommandIds:
    - bobProcess.validateCatalog
    - bobProcess.loadProcessInput
    - bobProcess.collectEvidence
    - bobProcess.validateReviewResult
    - bobProcess.writeProcessRecord
    - bobProcess.generateCampaignSummary
  deniedCommands:
    - shell
    - git.reset
    - git.clean
    - bzr
artifacts:
  - id: evidenceIndex
    producedBy: collect-evidence
    path: .bob-process-runs/{{run.id}}/evidence-index.json
  - id: reviewResult
    producedBy: save-review-result
    path: .bob-process-runs/{{run.id}}/common-review/review-result.yaml
  - id: processRecord
    producedBy: write-process-record
    path: .bob-process-records/campaigns/{{json state.processInput.input.campaignId}}/records/{{run.id}}/record.yaml
  - id: campaignSummary
    producedBy: generate-campaign-summary
    path: .bob-process-records/campaigns/{{json state.processInput.input.campaignId}}/summary.yaml
completion:
  summary: markdown
  includeArtifacts: true
  validateResult: true
steps:
  - id: validate-catalog
    title: 工程カタログを検証
    type: command
    prompt: 設定された工程カタログを検証し、利用可能な工程定義として読み込んでください。
    action:
      provider: vscode.executeCommand
      args:
        - bobProcess.validateCatalog
        - catalogPath: "{{inputs.catalogPath}}"
    resultKey: processCatalog
    required: true
    sendResult: true
    completeOnSuccess: true
  - id: load-process-input
    title: 工程入力を検証
    type: command
    prompt: process-input.yaml を検証し、キャンペーンと対象工程の入力値を読み込んでください。
    action:
      provider: vscode.executeCommand
      args:
        - bobProcess.loadProcessInput
        - inputPath: "{{inputs.processInputPath}}"
    resultKey: processInput
    required: true
    sendResult: true
    completeOnSuccess: true
  - id: collect-evidence
    title: レビュー対象をエビデンス化
    type: command
    prompt: 対象工程の証跡を収集し、evidence-index.json を作成してください。
    action:
      provider: vscode.executeCommand
      args:
        - bobProcess.collectEvidence
        - inputPath: "{{inputs.processInputPath}}"
          runId: "{{run.id}}"
    resultKey: evidenceIndex
    required: true
    sendResult: true
    completeOnSuccess: true
  - id: draft-review-result
    title: 共通レビュー結果を作成
    type: agent
    includeState:
      - processInput
      - evidenceIndex
    stateRequired: true
    resultKey: reviewResultYaml
    prompt: |
      工程入力と evidence-index を使い、共通レビューの結果を `process-review-result/v1` YAML だけで返してください。

      必須事項:
      - campaignId は processInput.input.campaignId、runId は現在の run id、workflowName は process-common-review を使います。
      - 目的、対象範囲、根拠、未解決事項を checklist で確認します。
      - evidenceRefs は evidence-index に存在する id だけを使います。
      - Bazaar の追加調査が必要な場合、`bzr --no-aliases <command>` 以外は禁止です。
      - Markdown の説明文や fenced code block は付けず、YAML 本文だけを返します。
  - id: save-review-result
    title: 共通レビュー結果を保存
    type: result
    result:
      source: state
      stateKey: reviewResultYaml
      sinks:
        - type: file
          path: .bob-process-runs/{{run.id}}/common-review/review-result.yaml
          encoding: utf8
  - id: validate-review-result
    title: 共通レビュー結果を検証
    type: command
    prompt: 工程レビュー結果を process-review-result/v1 と evidence index に照らして検証してください。
    action:
      provider: vscode.executeCommand
      args:
        - bobProcess.validateReviewResult
        - reviewResultPath: .bob-process-runs/{{run.id}}/common-review/review-result.yaml
          evidenceIndexPath: .bob-process-runs/{{run.id}}/evidence-index.json
    resultKey: reviewValidation
    required: true
    sendResult: true
    completeOnSuccess: true
  - id: human-gate
    title: 共通レビューを人間が確認
    type: manual
    prompt: 工程の成果物、検証結果、レビュー結果を人間が確認し、記録へ進むか差し戻すかを判断してください。
    approval:
      resultKey: humanGate
      approveLabel: 記録へ進む
      rejectLabel: 差し戻す
      message: レビュー結果、証跡、未解決事項を確認してください。
    required: true
  - id: write-process-record
    title: 工程記録を書き込む
    type: command
    prompt: 人間承認済みの工程結果を監査可能な工程記録として保存してください。
    action:
      provider: vscode.executeCommand
      args:
        - bobProcess.writeProcessRecord
        - record:
            schemaVersion: bob-process-record/v1
            campaignId: "{{json state.processInput.input.campaignId}}"
            runId: "{{run.id}}"
            workflowName: process-common-review
            phase: common
            status: completed
            inputPath: "{{inputs.processInputPath}}"
            artifactRoot: .bob-process-runs/{{run.id}}
            evidenceIndexPath: .bob-process-runs/{{run.id}}/evidence-index.json
            reviewResultPath: .bob-process-runs/{{run.id}}/common-review/review-result.yaml
            humanGate:
              required: true
              status: "{{json state.humanGate.decision}}"
    resultKey: processRecord
    required: true
    sendResult: true
    completeOnSuccess: true
  - id: generate-campaign-summary
    title: キャンペーンサマリーを更新
    type: command
    prompt: 最新の工程記録を集約し、キャンペーンサマリーを更新してください。
    action:
      provider: vscode.executeCommand
      args:
        - bobProcess.generateCampaignSummary
        - campaignId: "{{json state.processInput.input.campaignId}}"
    resultKey: campaignSummary
    required: true
    sendResult: true
    completeOnSuccess: true
---
# 共通レビュー

工程を問わないレビュー対象を証跡化し、人間確認を経て工程記録として保存します。
