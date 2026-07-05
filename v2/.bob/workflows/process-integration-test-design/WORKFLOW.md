---
schemaVersion: workflow-register/v1
name: process-integration-test-design
title: 結合テスト設計
description: インターフェース、データ連携、異常系を中心に結合テスト設計結果を工程記録へ保存します。
category: process-workflow
mode: agent
todo: true
todoRequired: true
todoAsSteps: true
stepCompletion: manual
stepMessage: step
stepExecution: { mode: engineSteps, allowOutOfOrder: false, showInBob: true }
stepReview: { enabled: true, pauseAfter: agentAndCommand, requireAcceptBeforeNext: true, allowRetry: true, allowEditBeforeRetry: true, preserveAttempts: true }
autoApproval: true
workspaceRequired: true
permissions: [read, todo]
requires: { workspace: true, bob: { minVersion: "2.0.0" } }
inputs:
  processInputPath: { type: string, title: process-input.yaml, default: process-input.yaml }
  catalogPath: { type: string, title: process catalog, default: .bob/process/process-catalog.yaml }
guardrails:
  allowedCommands: [vscode.executeCommand]
  allowedCommandIds: [bobProcess.validateCatalog, bobProcess.loadProcessInput, bobProcess.collectEvidence, bobProcess.validateReviewResult, bobProcess.writeProcessRecord, bobProcess.generateCampaignSummary]
  deniedCommands: [shell, git.reset, git.clean, bzr]
artifacts:
  - { id: evidenceIndex, producedBy: collect-evidence, path: ".bob-process-runs/{{run.id}}/evidence-index.json" }
  - { id: reviewResult, producedBy: save-review-result, path: ".bob-process-runs/{{run.id}}/integration-test-design/review-result.yaml" }
  - { id: processRecord, producedBy: write-process-record, path: ".bob-process-records/campaigns/{{json state.processInput.input.campaignId}}/records/{{run.id}}/record.yaml" }
  - { id: campaignSummary, producedBy: generate-campaign-summary, path: ".bob-process-records/campaigns/{{json state.processInput.input.campaignId}}/summary.yaml" }
completion: { summary: markdown, includeArtifacts: true, validateResult: true }
steps:
  - id: validate-catalog
    title: 工程カタログを検証
    type: command
    action: { provider: vscode.executeCommand, args: [bobProcess.validateCatalog, { catalogPath: "{{inputs.catalogPath}}" }] }
    resultKey: processCatalog
    sendResult: true
    completeOnSuccess: true
  - id: load-process-input
    title: 工程入力を検証
    type: command
    action: { provider: vscode.executeCommand, args: [bobProcess.loadProcessInput, { inputPath: "{{inputs.processInputPath}}" }] }
    resultKey: processInput
    sendResult: true
    completeOnSuccess: true
  - id: collect-evidence
    title: 結合テスト設計の証跡を収集
    type: command
    action: { provider: vscode.executeCommand, args: [bobProcess.collectEvidence, { inputPath: "{{inputs.processInputPath}}", runId: "{{run.id}}" }] }
    resultKey: evidenceIndex
    sendResult: true
    completeOnSuccess: true
  - id: draft-review-result
    title: 結合テスト設計レビュー結果を作成
    type: agent
    includeState: [processInput, evidenceIndex]
    stateRequired: true
    resultKey: reviewResultYaml
    prompt: |
      結合テスト設計として `process-review-result/v1` YAML だけを返してください。workflowName は process-integration-test-design です。
      インターフェース境界、データ連携、順序依存、異常系、復旧条件、外部システム前提を checklist 化してください。Bazaar は `bzr --no-aliases` 必須です。
  - id: save-review-result
    title: 結合テスト設計結果を保存
    type: result
    result: { source: state, stateKey: reviewResultYaml, sinks: [{ type: file, path: ".bob-process-runs/{{run.id}}/integration-test-design/review-result.yaml", encoding: utf8 }] }
  - id: validate-review-result
    title: 結合テスト設計結果を検証
    type: command
    action: { provider: vscode.executeCommand, args: [bobProcess.validateReviewResult, { reviewResultPath: ".bob-process-runs/{{run.id}}/integration-test-design/review-result.yaml", evidenceIndexPath: ".bob-process-runs/{{run.id}}/evidence-index.json" }] }
    resultKey: reviewValidation
    sendResult: true
    completeOnSuccess: true
  - id: human-gate
    title: 結合テスト設計を人間が確認
    type: manual
    approval: { resultKey: humanGate, approveLabel: 記録へ進む, rejectLabel: 差し戻す, message: 連携観点、異常系、外部前提、証跡を確認してください。 }
  - id: write-process-record
    title: 工程記録を書き込む
    type: command
    action:
      provider: vscode.executeCommand
      args:
        - bobProcess.writeProcessRecord
        - record: { schemaVersion: bob-process-record/v1, campaignId: "{{json state.processInput.input.campaignId}}", runId: "{{run.id}}", workflowName: process-integration-test-design, phase: integration_test, status: completed, inputPath: "{{inputs.processInputPath}}", artifactRoot: ".bob-process-runs/{{run.id}}", evidenceIndexPath: ".bob-process-runs/{{run.id}}/evidence-index.json", reviewResultPath: ".bob-process-runs/{{run.id}}/integration-test-design/review-result.yaml", humanGate: { required: true, status: "{{json state.humanGate.decision}}" } }
    resultKey: processRecord
    sendResult: true
    completeOnSuccess: true
  - id: generate-campaign-summary
    title: キャンペーンサマリーを更新
    type: command
    action: { provider: vscode.executeCommand, args: [bobProcess.generateCampaignSummary, { campaignId: "{{json state.processInput.input.campaignId}}" }] }
    resultKey: campaignSummary
    sendResult: true
    completeOnSuccess: true
---
# 結合テスト設計

連携境界と異常系を中心に結合テスト設計を工程記録へ保存します。
