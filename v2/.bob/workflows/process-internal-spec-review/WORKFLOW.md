---
schemaVersion: workflow-register/v1
name: process-internal-spec-review
title: 内部仕様レビュー
description: 内部仕様を外部仕様、コード制約、テスト観点と照合して工程記録へ保存します。
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
  - { id: reviewResult, producedBy: save-review-result, path: ".bob-process-runs/{{run.id}}/internal-spec-review/review-result.yaml" }
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
    title: 内部仕様レビューの証跡を収集
    type: command
    action: { provider: vscode.executeCommand, args: [bobProcess.collectEvidence, { inputPath: "{{inputs.processInputPath}}", runId: "{{run.id}}" }] }
    resultKey: evidenceIndex
    sendResult: true
    completeOnSuccess: true
  - id: draft-review-result
    title: 内部仕様レビュー結果を作成
    type: agent
    includeState: [processInput, evidenceIndex]
    stateRequired: true
    resultKey: reviewResultYaml
    prompt: |
      内部仕様レビューとして `process-review-result/v1` YAML だけを返してください。workflowName は process-internal-spec-review です。
      外部仕様対応、データ境界、例外処理、互換性、テスト可能性を checklist 化し、evidenceRefs は証跡 id だけを使います。Bazaar は `bzr --no-aliases` 必須です。
  - id: save-review-result
    title: 内部仕様レビュー結果を保存
    type: result
    result: { source: state, stateKey: reviewResultYaml, sinks: [{ type: file, path: ".bob-process-runs/{{run.id}}/internal-spec-review/review-result.yaml", encoding: utf8 }] }
  - id: validate-review-result
    title: 内部仕様レビュー結果を検証
    type: command
    action: { provider: vscode.executeCommand, args: [bobProcess.validateReviewResult, { reviewResultPath: ".bob-process-runs/{{run.id}}/internal-spec-review/review-result.yaml", evidenceIndexPath: ".bob-process-runs/{{run.id}}/evidence-index.json" }] }
    resultKey: reviewValidation
    sendResult: true
    completeOnSuccess: true
  - id: human-gate
    title: 内部仕様レビューを人間が確認
    type: manual
    approval: { resultKey: humanGate, approveLabel: 記録へ進む, rejectLabel: 差し戻す, message: 内部仕様レビューの指摘と根拠を確認してください。 }
  - id: write-process-record
    title: 工程記録を書き込む
    type: command
    action:
      provider: vscode.executeCommand
      args:
        - bobProcess.writeProcessRecord
        - record: { schemaVersion: bob-process-record/v1, campaignId: "{{json state.processInput.input.campaignId}}", runId: "{{run.id}}", workflowName: process-internal-spec-review, phase: internal_spec, status: completed, inputPath: "{{inputs.processInputPath}}", artifactRoot: ".bob-process-runs/{{run.id}}", evidenceIndexPath: ".bob-process-runs/{{run.id}}/evidence-index.json", reviewResultPath: ".bob-process-runs/{{run.id}}/internal-spec-review/review-result.yaml", humanGate: { required: true, status: "{{json state.humanGate.decision}}" } }
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
# 内部仕様レビュー

内部仕様を実装制約とテスト観点に照らして確認します。
