---
schemaVersion: workflow-register/v1
name: process-code-doc-investigation
title: コード・文書調査
description: 工程入力を検証し、対象コードと文書の調査結果を工程レビュー結果として保存します。
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
    path: .bob-process-runs/{{run.id}}/investigation/review-result.yaml
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
    prompt: 指定された工程カタログの構造と参照整合性を検証してください。
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
    prompt: 指定された process-input.yaml を読み込み、スキーマと工程カタログ参照を検証してください。
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
    title: 対象文書とコードをエビデンス化
    type: command
    prompt: process input に指定された文書とコードを収集し、再現可能な evidence index を作成してください。
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
    title: 調査結果を作成
    type: agent
    includeState:
      - processInput
      - evidenceIndex
    stateRequired: true
    resultKey: reviewResultYaml
    prompt: |
      工程入力と evidence-index を使い、コード・文書調査の結果を `process-review-result/v1` YAML だけで返してください。

      必須事項:
      - campaignId は processInput.input.campaignId、runId は現在の run id、workflowName は process-code-doc-investigation を使います。
      - checklist は調査対象、文書根拠、コード根拠を最低 1 件ずつ確認します。
      - evidenceRefs は evidence-index に存在する id だけを使います。
      - Bazaar の追加調査が必要な場合、`bzr --no-aliases <command>` 以外は禁止です。
      - Markdown の説明文や fenced code block は付けず、YAML 本文だけを返します。
  - id: save-review-result
    title: 調査レビュー結果を保存
    type: result
    result:
      source: state
      stateKey: reviewResultYaml
      sinks:
        - type: file
          path: .bob-process-runs/{{run.id}}/investigation/review-result.yaml
          encoding: utf8
  - id: validate-review-result
    title: 調査レビュー結果を検証
    type: command
    prompt: 保存した調査レビュー結果をスキーマとevidence indexに照らして検証してください。
    action:
      provider: vscode.executeCommand
      args:
        - bobProcess.validateReviewResult
        - reviewResultPath: .bob-process-runs/{{run.id}}/investigation/review-result.yaml
          evidenceIndexPath: .bob-process-runs/{{run.id}}/evidence-index.json
    resultKey: reviewValidation
    required: true
    sendResult: true
    completeOnSuccess: true
  - id: human-gate
    title: 調査結果を人間が確認
    type: manual
    prompt: 調査結果、証跡、追加調査の必要性を確認し、記録へ進むか差し戻すかを判断してください。
    approval:
      resultKey: humanGate
      approveLabel: 記録へ進む
      rejectLabel: 差し戻す
      message: 調査結果、証跡、追加調査の必要性を確認してください。
    required: true
  - id: write-process-record
    title: 工程記録を書き込む
    type: command
    prompt: 承認済みの調査結果と人間ゲートの判断を工程記録として保存してください。
    action:
      provider: vscode.executeCommand
      args:
        - bobProcess.writeProcessRecord
        - record:
            schemaVersion: bob-process-record/v1
            campaignId: "{{json state.processInput.input.campaignId}}"
            runId: "{{run.id}}"
            workflowName: process-code-doc-investigation
            phase: investigation
            status: completed
            inputPath: "{{inputs.processInputPath}}"
            artifactRoot: .bob-process-runs/{{run.id}}
            evidenceIndexPath: .bob-process-runs/{{run.id}}/evidence-index.json
            reviewResultPath: .bob-process-runs/{{run.id}}/investigation/review-result.yaml
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
    prompt: 最新の工程記録を集計し、キャンペーンサマリーを再生成してください。
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
# コード・文書調査

工程入力を検証し、対象コードと関連文書を証跡化して、調査結果を工程記録へ残します。
