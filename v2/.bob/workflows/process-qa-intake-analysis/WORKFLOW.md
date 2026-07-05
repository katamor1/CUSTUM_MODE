---
schemaVersion: workflow-register/v1
name: process-qa-intake-analysis
title: QA 受付分析
description: QA 受付情報、再現条件、関連資料を整理し、後続工程へ渡せる工程レビュー結果を作成します。
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
    path: .bob-process-runs/{{run.id}}/qa-intake/review-result.yaml
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
    title: 受付資料をエビデンス化
    type: command
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
    title: QA 受付分析を作成
    type: agent
    includeState:
      - processInput
      - evidenceIndex
    stateRequired: true
    resultKey: reviewResultYaml
    prompt: |
      工程入力と evidence-index を使い、QA 受付分析の結果を `process-review-result/v1` YAML だけで返してください。

      必須事項:
      - campaignId は processInput.input.campaignId、runId は現在の run id、workflowName は process-qa-intake-analysis を使います。
      - 再現条件、期待結果、実結果、影響範囲、後続工程への引継ぎを checklist で確認します。
      - evidenceRefs は evidence-index に存在する id だけを使います。
      - Bazaar の追加調査が必要な場合、`bzr --no-aliases <command>` 以外は禁止です。
      - Markdown の説明文や fenced code block は付けず、YAML 本文だけを返します。
  - id: save-review-result
    title: QA 分析結果を保存
    type: result
    result:
      source: state
      stateKey: reviewResultYaml
      sinks:
        - type: file
          path: .bob-process-runs/{{run.id}}/qa-intake/review-result.yaml
          encoding: utf8
  - id: validate-review-result
    title: QA 分析結果を検証
    type: command
    action:
      provider: vscode.executeCommand
      args:
        - bobProcess.validateReviewResult
        - reviewResultPath: .bob-process-runs/{{run.id}}/qa-intake/review-result.yaml
          evidenceIndexPath: .bob-process-runs/{{run.id}}/evidence-index.json
    resultKey: reviewValidation
    required: true
    sendResult: true
    completeOnSuccess: true
  - id: human-gate
    title: QA 分析を人間が確認
    type: manual
    approval:
      resultKey: humanGate
      approveLabel: 記録へ進む
      rejectLabel: 差し戻す
      message: 受付分析、再現条件、後続工程への引継ぎを確認してください。
    required: true
  - id: write-process-record
    title: 工程記録を書き込む
    type: command
    action:
      provider: vscode.executeCommand
      args:
        - bobProcess.writeProcessRecord
        - record:
            schemaVersion: bob-process-record/v1
            campaignId: "{{json state.processInput.input.campaignId}}"
            runId: "{{run.id}}"
            workflowName: process-qa-intake-analysis
            phase: qa
            status: completed
            inputPath: "{{inputs.processInputPath}}"
            artifactRoot: .bob-process-runs/{{run.id}}
            evidenceIndexPath: .bob-process-runs/{{run.id}}/evidence-index.json
            reviewResultPath: .bob-process-runs/{{run.id}}/qa-intake/review-result.yaml
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
# QA 受付分析

QA 受付情報を工程入力として検証し、再現性と後続工程への引継ぎを記録します。
