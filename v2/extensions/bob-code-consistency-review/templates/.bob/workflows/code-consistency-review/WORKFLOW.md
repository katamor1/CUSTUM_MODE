---
schemaVersion: workflow-register/v1
name: code-consistency-review
title: コード整合プレレビュー
description: 文書候補収集から traceability catalog と review-input.yaml を作成し、コード変更と文書の整合プレレビューを実施します。
category: code-review
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
  pauseAfter: everyStep
  requireAcceptBeforeNext: true
  allowRetry: true
  allowEditBeforeRetry: true
  preserveAttempts: true
autoApproval: true
workspaceRequired: false
requires:
  workspace: true
  bob:
    minVersion: "2.0.0"
guardrails:
  allowedCommands:
    - vscode.executeCommand
    - bobCodeConsistency.captureAiTraceabilityDraft
    - bobCodeConsistency.applyAiTraceabilityDraft
    - bobCodeConsistency.openTraceabilityPrep
    - bobCodeConsistency.validateTraceabilityCatalog
    - bobCodeConsistency.createReviewInputFromTraceability
    - bobCodeConsistency.preprocess
    - bobCodeConsistency.captureBobOutput
    - bobCodeConsistency.validateOutput
    - bobCodeConsistency.triage
  allowedCommandIds:
    - bobCodeConsistency.prepareAiTraceabilityDraft
inputs:
  reviewId:
    type: string
    title: review.id
    default: code-consistency-review
  reviewTitle:
    type: string
    title: review.title
    default: コード整合プレレビュー
  reviewPurpose:
    type: string
    title: review.purpose
    default: 要求・設計・テスト仕様とコード変更の整合性を確認する
  changeType:
    type: select
    title: 変更種別
    default: maintenance
    options: [bugfix, feature, spec_change, refactor, performance, maintenance]
  vcs:
    type: select
    title: VCS
    default: git
    options: [git, bazaar, bzr]
  base:
    type: string
    title: 比較元 revision
    default: HEAD~1
  head:
    type: string
    title: 比較先 revision
    default: HEAD
  vcsRoot:
    type: string
    title: VCS root
    default: ""
  docsRoot:
    type: string
    title: 文書候補 root
    default: docs
  reviewFocus:
    type: string
    title: review_focus
    default: requirement-code-consistency,design-code-consistency,test-gap
  reviewInputPath:
    type: string
    title: review-input.yaml
    default: review-input.yaml
  traceabilityCatalogPath:
    type: string
    title: traceability catalog
    default: .bob-trace/traceability-catalog.json
  traceabilityGateReportPath:
    type: string
    title: traceability gate report
    default: .bob-trace/gate-report.md
  aiTraceabilityDraftPromptPath:
    type: string
    title: traceability AI draft prompt path
    default: .bob-trace/ai-traceability-draft
  reviewPackagePath:
    type: string
    title: review-package path
    default: .bob-review/review-package
  textEncoding:
    type: string
    title: text encoding
    default: auto
  bobOutputPath:
    type: string
    title: Bob output YAML path
    default: .bob-review/bob-output/bob-output.yaml
  triagePath:
    type: string
    title: human triage path
    default: .bob-review/human-triage
artifacts:
  - id: traceabilityDraftPrompt
    producedBy: collect-document-candidates
    path: .bob-trace/ai-traceability-draft/ai-draft-prompt.md
  - id: traceabilityCatalog
    producedBy: apply-traceability-draft
    path: .bob-trace/traceability-catalog.json
  - id: traceabilityGateReport
    producedBy: validate-traceability-catalog
    path: .bob-trace/gate-report.md
  - id: reviewInput
    producedBy: create-review-input-from-traceability
    path: review-input.yaml
  - id: reviewPackage
    producedBy: preprocess-review-package
    path: .bob-review/review-package
  - id: bobOutput
    producedBy: capture-bob-output
    path: .bob-review/bob-output/bob-output.yaml
completion:
  summary: markdown
  includeArtifacts: true
  validateResult: true
steps:
  - id: collect-document-candidates
    title: 文書候補と差分サマリを収集
    type: command
    action:
      provider: vscode.executeCommand
      args:
        - bobCodeConsistency.prepareAiTraceabilityDraft
        - aiTraceabilityDraftPromptPath: "{{inputs.aiTraceabilityDraftPromptPath}}"
          base: "{{inputs.base}}"
          docsRoot: "{{inputs.docsRoot}}"
          head: "{{inputs.head}}"
          textEncoding: "{{inputs.textEncoding}}"
          vcs: "{{inputs.vcs}}"
          vcsRoot: "{{inputs.vcsRoot}}"
    prompt: traceability AI draft 用 prompt を生成してください。
    sendResult: true
    resultKey: traceabilityDraftPrompt
    maxResultBytes: 30000
    required: true
    completeOnSuccess: true
  - id: generate-traceability-draft
    title: traceability proposed draft JSON を生成
    type: agent
    required: true
    includeState:
      - traceabilityDraftPrompt
    stateRequired: true
    resultKey: traceabilityDraftJson
    prompt: |
      state.traceabilityDraftPrompt の prompt を使い、traceability catalog draft JSON を作成してください。

      厳守事項:
      - Markdown、説明文、mermaid、リンク、ファイル作成報告は禁止です。
      - 応答の先頭は `{`、末尾は `}` にしてください。
      - status は proposed のみです。
      - item は id を持たず proposed_id だけを使ってください。
      - link は from / to を持たず proposed_from / proposed_to だけを使ってください。
      - accepted / rejected / deprecated は人間だけが決めます。
      - 不確かな対応は無理に補完せず proposed 候補として残してください。
  - id: apply-traceability-draft
    title: AI draft JSON を sidecar catalog に反映
    type: command
    action:
      provider: bobCodeConsistency.applyAiTraceabilityDraft
    includeState:
      - traceabilityDraftJson
    stateRequired: true
    prompt: state.traceabilityDraftJson を検証し、traceability catalog へ merge して gate report を生成してください。
    sendResult: true
    resultKey: traceabilityCatalog
    maxResultBytes: 30000
    required: true
    completeOnSuccess: true
  - id: approve-traceability-catalog
    title: Traceability Prep で候補を人間承認
    type: command
    action:
      provider: bobCodeConsistency.openTraceabilityPrep
    prompt: Traceability Prep Webview を開き、人間が候補を確認して保存してください。
    sendResult: true
    resultKey: traceabilityPrep
    maxResultBytes: 12000
    required: true
    completeOnSuccess: false
  - id: validate-traceability-catalog
    title: traceability catalog を gate 検証
    type: command
    action:
      provider: bobCodeConsistency.validateTraceabilityCatalog
    prompt: traceability gate を検証してください。
    sendResult: true
    resultKey: traceabilityGate
    maxResultBytes: 20000
    required: true
    completeOnSuccess: true
  - id: create-review-input-from-traceability
    title: traceability catalog から review-input.yaml を生成
    type: command
    action:
      provider: bobCodeConsistency.createReviewInputFromTraceability
    includeState:
      - traceabilityGate
    stateRequired: true
    prompt: accepted catalog item から review-input.yaml を生成してください。
    sendResult: true
    resultKey: reviewInput
    maxResultBytes: 20000
    required: true
    completeOnSuccess: true
  - id: preprocess-review-package
    title: review-package と bob-input.md を生成
    type: command
    action:
      provider: bobCodeConsistency.preprocess
    includeState:
      - reviewInput
    stateRequired: true
    prompt: review-input.yaml から review-package を生成してください。
    sendResult: true
    resultKey: reviewPackage
    maxResultBytes: 20000
    required: true
    completeOnSuccess: true
  - id: run-bob-pre-review
    title: bob-input.md を使って整合プレレビューを実行
    type: agent
    required: true
    includeState:
      - reviewPackage
    stateRequired: true
    resultKey: bobReviewResult
    prompt: Bob 出力 schema に一致する YAML を返してください。final_approval は not_performed にしてください。
  - id: capture-bob-output
    title: Bob YAML 出力を取り込み
    type: command
    action:
      provider: bobCodeConsistency.captureBobOutput
    includeState:
      - bobReviewResult
    stateRequired: true
    prompt: 直前の Bob YAML 出力を保存してください。
    sendResult: true
    resultKey: captureResult
    maxResultBytes: 10000
    required: true
    completeOnSuccess: true
  - id: validate-bob-output
    title: Bob YAML 出力を検証
    type: command
    action:
      provider: bobCodeConsistency.validateOutput
    prompt: Bob YAML 出力を検証してください。
    sendResult: true
    resultKey: validationResult
    maxResultBytes: 20000
    required: true
    completeOnSuccess: true
  - id: human-triage
    title: 人間確認用 triage ファイルを生成
    type: command
    action:
      provider: bobCodeConsistency.triage
    prompt: 人間確認用 triage ファイルを生成してください。
    sendResult: true
    resultKey: triageResult
    maxResultBytes: 20000
    required: true
    completeOnSuccess: true
  - id: handoff-formal-review
    title: 正式レビューへの引き継ぎを作成
    type: agent
    required: true
    includeState:
      - traceabilityGate
      - reviewPackage
      - validationResult
      - triageResult
    stateRequired: true
    prompt: 正式な人間レビューへ渡すための簡潔な Markdown 引き継ぎを作成してください。
---
# コード整合プレレビュー

文書候補の収集から正式レビューへの引き継ぎまでを実行します。AI は proposed-only の traceability draft JSON を作成し、人間が Traceability Prep で候補を判断します。
