---
schemaVersion: workflow-register/v1
name: process-functional-test-execution-review
title: 機能テスト実行レビュー
description: 機能テスト結果、ログ、未解決事項を確認して工程記録へ保存します。
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
  - { id: reviewResult, producedBy: save-review-result, path: ".bob-process-runs/{{run.id}}/functional-test-execution/review-result.yaml" }
  - { id: processRecord, producedBy: write-process-record, path: ".bob-process-records/campaigns/{{json state.processInput.input.campaignId}}/records/{{run.id}}/record.yaml" }
  - { id: campaignSummary, producedBy: generate-campaign-summary, path: ".bob-process-records/campaigns/{{json state.processInput.input.campaignId}}/summary.yaml" }
completion: { summary: markdown, includeArtifacts: true, validateResult: true }
steps:
  - id: validate-catalog
    title: 工程カタログを検証
    type: command
    prompt: 設定された工程カタログを検証し、利用可能な工程定義として読み込んでください。
    action: { provider: vscode.executeCommand, args: [bobProcess.validateCatalog, { catalogPath: "{{inputs.catalogPath}}" }] }
    resultKey: processCatalog
    sendResult: true
    completeOnSuccess: true
  - id: load-process-input
    title: 工程入力を検証
    type: command
    prompt: process-input.yaml を検証し、キャンペーンと対象工程の入力値を読み込んでください。
    action: { provider: vscode.executeCommand, args: [bobProcess.loadProcessInput, { inputPath: "{{inputs.processInputPath}}" }] }
    resultKey: processInput
    sendResult: true
    completeOnSuccess: true
  - id: collect-evidence
    title: 機能テスト実行証跡を収集
    type: command
    prompt: 対象工程の証跡を収集し、evidence-index.json を作成してください。
    action: { provider: vscode.executeCommand, args: [bobProcess.collectEvidence, { inputPath: "{{inputs.processInputPath}}", runId: "{{run.id}}" }] }
    resultKey: evidenceIndex
    sendResult: true
    completeOnSuccess: true
  - id: draft-review-result
    title: 機能テスト実行レビュー結果を作成
    type: agent
    includeState: [processInput, evidenceIndex]
    stateRequired: true
    resultKey: reviewResultYaml
    prompt: |
      機能テスト実行レビューとして `process-review-result/v1` YAML だけを返してください。workflowName は process-functional-test-execution-review です。
      実行環境、実行結果、失敗ログ、未解決事項、再試験条件を checklist 化してください。
  - id: save-review-result
    title: 機能テスト実行結果を保存
    type: result
    result: { source: state, stateKey: reviewResultYaml, sinks: [{ type: file, path: ".bob-process-runs/{{run.id}}/functional-test-execution/review-result.yaml", encoding: utf8 }] }
  - id: validate-review-result
    title: 機能テスト実行結果を検証
    type: command
    prompt: 工程レビュー結果を process-review-result/v1 と evidence index に照らして検証してください。
    action: { provider: vscode.executeCommand, args: [bobProcess.validateReviewResult, { reviewResultPath: ".bob-process-runs/{{run.id}}/functional-test-execution/review-result.yaml", evidenceIndexPath: ".bob-process-runs/{{run.id}}/evidence-index.json" }] }
    resultKey: reviewValidation
    sendResult: true
    completeOnSuccess: true
  - id: human-gate
    title: 機能テスト実行結果を人間が確認
    type: manual
    prompt: 工程の成果物、検証結果、レビュー結果を人間が確認し、記録へ進むか差し戻すかを判断してください。
    approval: { resultKey: humanGate, approveLabel: 記録へ進む, rejectLabel: 差し戻す, message: 実行結果、ログ、再試験条件を確認してください。 }
  - id: write-process-record
    title: 工程記録を書き込む
    type: command
    prompt: 人間承認済みの工程結果を監査可能な工程記録として保存してください。
    action:
      provider: vscode.executeCommand
      args:
        - bobProcess.writeProcessRecord
        - record: { schemaVersion: bob-process-record/v1, campaignId: "{{json state.processInput.input.campaignId}}", runId: "{{run.id}}", workflowName: process-functional-test-execution-review, phase: functional_test, status: completed, inputPath: "{{inputs.processInputPath}}", artifactRoot: ".bob-process-runs/{{run.id}}", evidenceIndexPath: ".bob-process-runs/{{run.id}}/evidence-index.json", reviewResultPath: ".bob-process-runs/{{run.id}}/functional-test-execution/review-result.yaml", humanGate: { required: true, status: "{{json state.humanGate.decision}}" } }
    resultKey: processRecord
    sendResult: true
    completeOnSuccess: true
  - id: generate-campaign-summary
    title: キャンペーンサマリーを更新
    type: command
    prompt: 最新の工程記録を集約し、キャンペーンサマリーを更新してください。
    action: { provider: vscode.executeCommand, args: [bobProcess.generateCampaignSummary, { campaignId: "{{json state.processInput.input.campaignId}}" }] }
    resultKey: campaignSummary
    sendResult: true
    completeOnSuccess: true
---
# 機能テスト実行レビュー

機能テスト実行結果を証跡付きで工程記録に保存します。
