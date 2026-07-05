---
schemaVersion: workflow-register/v1
name: process-coding-plan
title: コーディング計画
description: 実装前の変更計画、影響範囲、検証観点を工程記録へ保存します。
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
  - { id: reviewResult, producedBy: save-review-result, path: ".bob-process-runs/{{run.id}}/coding-plan/review-result.yaml" }
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
    title: コーディング計画の証跡を収集
    type: command
    action: { provider: vscode.executeCommand, args: [bobProcess.collectEvidence, { inputPath: "{{inputs.processInputPath}}", runId: "{{run.id}}" }] }
    resultKey: evidenceIndex
    sendResult: true
    completeOnSuccess: true
  - id: draft-review-result
    title: コーディング計画レビュー結果を作成
    type: agent
    includeState: [processInput, evidenceIndex]
    stateRequired: true
    resultKey: reviewResultYaml
    prompt: |
      コーディング計画として `process-review-result/v1` YAML だけを返してください。workflowName は process-coding-plan です。
      変更単位、影響範囲、後方互換、レビュー観点、テスト計画を checklist 化し、破壊的 VCS 操作を計画に含めないでください。Bazaar は `bzr --no-aliases` 必須です。
  - id: save-review-result
    title: コーディング計画結果を保存
    type: result
    result: { source: state, stateKey: reviewResultYaml, sinks: [{ type: file, path: ".bob-process-runs/{{run.id}}/coding-plan/review-result.yaml", encoding: utf8 }] }
  - id: validate-review-result
    title: コーディング計画結果を検証
    type: command
    action: { provider: vscode.executeCommand, args: [bobProcess.validateReviewResult, { reviewResultPath: ".bob-process-runs/{{run.id}}/coding-plan/review-result.yaml", evidenceIndexPath: ".bob-process-runs/{{run.id}}/evidence-index.json" }] }
    resultKey: reviewValidation
    sendResult: true
    completeOnSuccess: true
  - id: human-gate
    title: コーディング計画を人間が確認
    type: manual
    approval: { resultKey: humanGate, approveLabel: 記録へ進む, rejectLabel: 差し戻す, message: 実装範囲、レビュー観点、テスト計画を確認してください。 }
  - id: write-process-record
    title: 工程記録を書き込む
    type: command
    action:
      provider: vscode.executeCommand
      args:
        - bobProcess.writeProcessRecord
        - record: { schemaVersion: bob-process-record/v1, campaignId: "{{json state.processInput.input.campaignId}}", runId: "{{run.id}}", workflowName: process-coding-plan, phase: coding, status: completed, inputPath: "{{inputs.processInputPath}}", artifactRoot: ".bob-process-runs/{{run.id}}", evidenceIndexPath: ".bob-process-runs/{{run.id}}/evidence-index.json", reviewResultPath: ".bob-process-runs/{{run.id}}/coding-plan/review-result.yaml", humanGate: { required: true, status: "{{json state.humanGate.decision}}" } }
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
# コーディング計画

実装前の変更計画を証跡付きで保存します。
