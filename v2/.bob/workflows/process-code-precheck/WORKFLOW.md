---
schemaVersion: workflow-register/v1
name: process-code-precheck
title: コード事前チェック
description: Phase 2 のコード整合プレレビューを実行し、出力検証と human triage を工程記録へ handoff します。
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
  phase2ReviewInputPath: { type: string, title: Phase 2 review-input.yaml, default: review-input.yaml }
  reviewPackagePath: { type: string, title: Phase 2 review-package, default: .bob-review/review-package }
  bobOutputPath: { type: string, title: Phase 2 Bob output, default: .bob-review/bob-output/bob-output.yaml }
  triagePath: { type: string, title: Phase 2 human triage, default: .bob-review/human-triage }
  textEncoding: { type: string, title: text encoding, default: auto }
guardrails:
  allowedCommands:
    - vscode.executeCommand
    - bobCodeConsistency.preprocess
    - bobCodeConsistency.validateOutput
    - bobCodeConsistency.triage
  allowedCommandIds: [bobProcess.validateCatalog, bobProcess.loadProcessInput, bobProcess.collectEvidence, bobProcess.validateReviewResult, bobProcess.writeProcessRecord, bobProcess.generateCampaignSummary]
  deniedCommands: [shell, git.reset, git.clean, bzr]
artifacts:
  - { id: evidenceIndex, producedBy: collect-evidence, path: ".bob-process-runs/{{run.id}}/evidence-index.json" }
  - { id: reviewResult, producedBy: save-review-result, path: ".bob-process-runs/{{run.id}}/code-precheck/review-result.yaml" }
  - { id: phase2Handoff, producedBy: write-process-record, path: ".bob-process-runs/{{run.id}}/code-precheck/phase2-handoff.json" }
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
    title: コード事前チェックの証跡を収集
    type: command
    action: { provider: vscode.executeCommand, args: [bobProcess.collectEvidence, { inputPath: "{{inputs.processInputPath}}", runId: "{{run.id}}" }] }
    resultKey: evidenceIndex
    sendResult: true
    completeOnSuccess: true
  - id: phase2-preprocess
    title: Phase 2 review-package を生成
    type: command
    action:
      provider: bobCodeConsistency.preprocess
      args: { reviewInputPath: "{{inputs.phase2ReviewInputPath}}", outDir: "{{inputs.reviewPackagePath}}", textEncoding: "{{inputs.textEncoding}}", workflowRunId: "{{run.id}}" }
    resultKey: phase2Preprocess
    sendResult: true
    completeOnSuccess: true
  - id: phase2-review
    title: Phase 2 Bob 出力 YAML を作成
    type: agent
    includeState: [phase2Preprocess]
    stateRequired: true
    resultKey: phase2BobOutputYaml
    prompt: |
      Phase 2 review-package の bob-input.md に従い、bob-code-consistency-review の Bob 出力 YAML だけを返してください。
      final_approval は人間確認前なので not_performed にしてください。Markdown や fenced code block は返さないでください。
  - id: save-phase2-bob-output
    title: Phase 2 Bob 出力を保存
    type: result
    result: { source: state, stateKey: phase2BobOutputYaml, sinks: [{ type: file, path: "{{inputs.bobOutputPath}}", encoding: utf8 }] }
  - id: phase2-validate-output
    title: Phase 2 Bob 出力を検証
    type: command
    action:
      provider: bobCodeConsistency.validateOutput
      args: { bobOutputPath: "{{inputs.bobOutputPath}}", reviewPackagePath: "{{inputs.reviewPackagePath}}" }
    resultKey: phase2Validation
    sendResult: true
    completeOnSuccess: true
  - id: phase2-triage
    title: Phase 2 human triage を生成
    type: command
    action:
      provider: bobCodeConsistency.triage
      args: { bobOutputPath: "{{inputs.bobOutputPath}}", reviewPackagePath: "{{inputs.reviewPackagePath}}", triagePath: "{{inputs.triagePath}}" }
    resultKey: phase2Triage
    sendResult: true
    completeOnSuccess: true
  - id: draft-review-result
    title: コード事前チェック結果を工程レビュー結果に変換
    type: agent
    includeState: [processInput, evidenceIndex, phase2Validation, phase2Triage]
    stateRequired: true
    resultKey: reviewResultYaml
    prompt: |
      Phase 2 の検証結果と human triage を踏まえて `process-review-result/v1` YAML だけを返してください。workflowName は process-code-precheck です。
      指摘がある場合は finding を作り、evidenceRefs は evidence-index の id だけを使います。Bazaar 調査は `bzr --no-aliases <command>` 必須です。
  - id: save-review-result
    title: コード事前チェック結果を保存
    type: result
    result: { source: state, stateKey: reviewResultYaml, sinks: [{ type: file, path: ".bob-process-runs/{{run.id}}/code-precheck/review-result.yaml", encoding: utf8 }] }
  - id: validate-review-result
    title: コード事前チェック結果を検証
    type: command
    action: { provider: vscode.executeCommand, args: [bobProcess.validateReviewResult, { reviewResultPath: ".bob-process-runs/{{run.id}}/code-precheck/review-result.yaml", evidenceIndexPath: ".bob-process-runs/{{run.id}}/evidence-index.json" }] }
    resultKey: reviewValidation
    sendResult: true
    completeOnSuccess: true
  - id: human-gate
    title: Phase 2 triage と工程結果を人間が確認
    type: manual
    approval: { resultKey: humanGate, approveLabel: 記録へ進む, rejectLabel: 差し戻す, message: Phase 2 出力、validateOutput、human triage、工程レビュー結果を確認してください。 }
    transition:
      decisions:
        - id: approved
          when: { stateKey: humanGate.decision, equals: approved }
          goto: write-process-record
      default: fail
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
            workflowName: process-code-precheck
            phase: coding
            status: completed
            inputPath: "{{inputs.processInputPath}}"
            artifactRoot: ".bob-process-runs/{{run.id}}"
            evidenceIndexPath: ".bob-process-runs/{{run.id}}/evidence-index.json"
            reviewResultPath: ".bob-process-runs/{{run.id}}/code-precheck/review-result.yaml"
            humanGate: { required: true, status: "{{json state.humanGate.decision}}" }
            phase2Handoff:
              reviewPackage: "{{inputs.reviewPackagePath}}"
              bobOutput: "{{inputs.bobOutputPath}}"
              validation: "{{state.phase2Validation}}"
              triage: "{{state.phase2Triage}}"
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
# コード事前チェック

Phase 2 のレビュー package、検証結果、human triage を工程記録へ handoff します。
