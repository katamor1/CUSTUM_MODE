---
schemaVersion: workflow-register/v1
name: code-consistency-review
description: コード変更を要求書・設計書・テスト仕様書と照合し、正式レビュー前の整合プレレビューを実施します。
title: コード整合プレレビュー
category: code-review
mode: agent
todo: true
todoRequired: true
todoAsSteps: true
stepCompletion: manual
stepMessage: step
permissions:
  - read
  - mcp
  - skill
  - todo
autoApproval: true
workspaceRequired: false
requires:
  workspace: true
  bob:
    minVersion: "2.0.0"
  files:
    - review-input.yaml
guardrails:
  allowedCommands:
    - bobCodeConsistency.preprocess
    - bobCodeConsistency.captureBobOutput
    - bobCodeConsistency.validateOutput
    - bobCodeConsistency.triage
  deniedCommands:
    - shell
    - file.writeOutsideBob
  requireApproval:
    - id: large-review-package
      when: ".bob-review/review-package/bob-input.md is too large for one review pass"
      message: review-package が1回のレビューには大きすぎます。パッケージを分割し、slice ごとにこのワークフローを実行してください。
inputs:
  reviewInputPath:
    type: string
    title: review-input.yaml のパス
    default: review-input.yaml
  reviewPackagePath:
    type: string
    title: review-package の出力先
    default: .bob-review/review-package
  textEncoding:
    type: string
    title: テキスト読み取り文字コード
    default: auto
  bobOutputPath:
    type: string
    title: Bob 出力 YAML の保存先
    default: .bob-review/bob-output/bob-output.yaml
  triagePath:
    type: string
    title: 人間 triage の出力先
    default: .bob-review/human-triage
tools:
  bobCodeConsistency.preprocess:
    purpose: review-package と bob-input.md を生成します。
    required: true
    outputKey: reviewPackage
    failurePolicy: stop
  bobCodeConsistency.captureBobOutput:
    purpose: 直前の Bob YAML 出力を .bob-review/bob-output/bob-output.yaml に保存します。
    required: true
    outputKey: captureResult
    inputSource: state
    failurePolicy: stop
  bobCodeConsistency.validateOutput:
    purpose: Bob YAML 出力を schema と package evidence に照らして検証します。
    required: true
    outputKey: validationResult
    failurePolicy: stop
  bobCodeConsistency.triage:
    purpose: 人間確認用 triage ファイルを生成します。
    required: true
    outputKey: triageResult
    failurePolicy: stop
artifacts:
  - id: reviewPackage
    producedBy: preprocess-review-package
    path: .bob-review/review-package
  - id: bobInput
    producedBy: preprocess-review-package
    path: .bob-review/review-package/bob-input.md
  - id: bobOutput
    producedBy: capture-bob-output
    path: .bob-review/bob-output/bob-output.yaml
    schema: docs/workflows/code-consistency-review/schemas/bob-output.schema.json
  - id: triage
    producedBy: human-triage
    path: .bob-review/human-triage
completion:
  summary: markdown
  includeArtifacts: true
  validateResult: true
  visualization:
    type: mermaid
    enabled: false
steps:
  - id: preprocess-review-package
    title: review-package と bob-input.md を生成
    type: command
    action:
      provider: bobCodeConsistency.preprocess
    prompt: |
      review-input.yaml から review-package を生成してください。入力検証エラーまたは関連文書の欠落が報告された場合は停止してください。
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
    maxResultBytes: 40000
    prompt: |
      .bob-review/review-package/bob-input.md を読み、そこに定義された整合プレレビューだけを実施してください。

      あなたの役割は、要求書、基本設計書、詳細設計書、テスト仕様書、台帳、チケット、変更コードの間で、根拠に基づく不整合候補と人間への確認事項を抽出することです。

      厳守事項:
      - 最終承認をしてはいけません。
      - 変更が完全に網羅されていると断定してはいけません。
      - 根拠が不足していることを、正しさの証明として扱ってはいけません。
      - すべての finding には package 内の具体的な evidence を含めてください。
      - 根拠が弱い場合は finding ではなく question として出力してください。

      docs/workflows/code-consistency-review/schemas/bob-output.schema.json に一致する YAML を返してください。final_approval の値は必ず not_performed にしてください。
  - id: capture-bob-output
    title: Bob YAML 出力を取り込み
    type: command
    action:
      provider: bobCodeConsistency.captureBobOutput
    includeState:
      - bobReviewResult
    stateRequired: true
    prompt: |
      直前の Bob YAML 出力を .bob-review/bob-output/bob-output.yaml に保存してください。
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
    prompt: |
      取り込んだ Bob YAML 出力を schema と evidence-index.json に照らして検証してください。検証エラーが残っている間は続行しないでください。
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
    prompt: |
      triage-result.yaml、accepted-findings.md、rejected-findings.md、questions-to-author.md、follow-up-actions.md を生成してください。
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
      - reviewPackage
      - validationResult
      - triageResult
    stateRequired: true
    prompt: |
      正式な人間レビューへ渡すための簡潔な Markdown 引き継ぎを作成してください。

      含める内容:
      - レビュー対象と package path
      - 採用候補のプレレビュー指摘
      - 作成者への確認事項
      - 検証エラーまたは warning があればその内容
      - 不足しているテストまたは文書更新の gap
      - Bob はこの変更を承認していない、という明示的な注記

      出力は引き継ぎサマリに限定し、最終レビュー判断として書かないでください。
---
# コード整合プレレビュー

## 目的

コード変更を要求書・設計書・テスト仕様書と照合し、構造化された整合プレレビューを実施します。

このワークフローは `docs/workflows/code-consistency-review/` の仕様を実行手順化し、Bob を支援役に限定します。Bob は根拠に基づく不整合候補と確認事項を提示できますが、最終解釈、承認、リスク受容は人間のレビュー担当者が行います。
