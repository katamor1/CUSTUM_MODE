---
schemaVersion: workflow-register/v1
name: bazaar-project-rule-review
description: Bazaar のリビジョンまたはリビジョン範囲を、プロジェクト固有ルールに照らしてレビューします。
title: Bazaar プロジェクト規約レビュー
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
    - .bob/review/checklist.json
    - .bob/review/review-result.schema.json
    - .bob/skills/project-review-checklist/SKILL.md
inputs:
  revisionMode:
    type: select
    title: レビュー対象
    prompt: false
    options:
      - singleRevision
      - revisionRange
      - workingTreeSinceRevision
  revision:
    type: string
    title: リビジョン
    prompt: false
  baseRevision:
    type: string
    title: 基準リビジョン
    prompt: false
  targetRevision:
    type: string
    title: 比較先リビジョン
    prompt: false
preflight:
  - id: check-workspace
    title: Bob ワークスペースと Bazaar リポジトリを確認
    required: true
    checks:
      - workspaceOpen
      - bazaarRepository
      - bobWorkspaceInitialized
    failurePolicy: stop
  - id: check-review-assets
    title: レビュー用チェックリスト、スキーマ、Skill ファイルを確認
    required: true
    files:
      - .bob/review/checklist.json
      - .bob/review/review-result.schema.json
      - .bob/skills/project-review-checklist/SKILL.md
    failurePolicy: stop
tools:
  bobBazaar.openReviewGui:
    purpose: ユーザーと一緒に Bazaar の対象リビジョンまたはリビジョン範囲を確認します。
    required: true
    failurePolicy: stop
  bobBazaar.collectReviewContext:
    purpose: Bazaar のリビジョンメタデータ、変更ファイル、差分コンテキストを収集します。
    required: true
    outputKey: reviewContext
    failurePolicy: stop
  bobBazaar.loadReviewRules:
    purpose: プロジェクトのレビュー用チェックリストとレビュー結果 JSON スキーマを読み込みます。
    required: true
    outputKey: reviewRules
    failurePolicy: stop
  bobBazaar.captureReviewResult:
    purpose: 最終的な review-result JSON と Markdown サマリを検証して保存します。
    required: true
    inputSource: lastAssistant
    failurePolicy: stop
guardrails:
  allowedCommands:
    - bobBazaar.openReviewGui
    - bobBazaar.collectReviewContext
    - bobBazaar.loadReviewRules
    - bobBazaar.captureReviewResult
  deniedCommands:
    - shell
    - file.writeOutsideBob
  requireApproval:
    - id: large-review
      when: "reviewContext.changedFiles.count > 100"
      message: 変更ファイルが多いリビジョンです。レビューを続行するか、分割して確認するかを確認してください。
artifacts:
  - id: reviewContext
    producedBy: collect-context
    path: .bob/workflows/runs/{{run.id}}/review-context.json
  - id: reviewRules
    producedBy: load-rules
    path: .bob/workflows/runs/{{run.id}}/review-rules.json
  - id: reviewAnalysis
    producedBy: analyze-changes
    path: .bob/workflows/runs/{{run.id}}/review-analysis.md
  - id: reviewResultJson
    producedBy: output-result
    path: .bob/workflows/runs/{{run.id}}/review-result.json
    schema: .bob/review/review-result.schema.json
completion:
  summary: markdown
  includeArtifacts: true
  validateResult: true
  visualization:
    type: mermaid
    enabled: false
steps:
  - id: review-input
    title: 対象の Bazaar リビジョンまたはリビジョン範囲を確認
    type: command
    action:
      provider: bobBazaar.openReviewGui
    prompt: |
      GUI で対象の Bazaar リビジョンまたはリビジョン範囲を確認してください。Bazaar Review 拡張機能では、レビュー対象入力の Bob 事前プロンプトを意図的に無効化しているため、このワークフローは既定で GUI から開始します。
      追加で Bazaar CLI 調査が必要な場合でも、`bzr <command>` を直接実行してはいけません。
      必ず `bzr --no-aliases <command>` を実行するか、このオプションを内部で強制する提供済み MCP tool を使用してください。
    sendResult: false
    required: true
    completeOnSuccess: false
  - id: collect-context
    title: Bazaar 差分と変更ファイルのコンテキストを収集
    type: command
    action:
      provider: bobBazaar.collectReviewContext
    prompt: |
      コマンドが返した Bazaar レビューコンテキストを使用してください。リビジョンメタデータ、変更ファイル、重要な差分箇所を要約します。完全な差分詳細は、すでに Bob コンテキストへ追加された Bazaar review packet を使用してください。
      Bazaar CLI を `--no-aliases` なしで実行してはいけません。
      log、diff、cat、status の確認には、拡張機能側で `--no-aliases` を内部強制する MCP tool を優先してください。
    sendResult: true
    resultKey: reviewContext
    maxResultBytes: 20000
    required: true
    completeOnSuccess: true
  - id: load-rules
    title: プロジェクトチェックリストとレビュー結果スキーマを読み込み
    type: command
    action:
      provider: bobBazaar.loadReviewRules
    prompt: |
      プロジェクトのレビュー用チェックリストとレビュー結果スキーマを読み込み、現在の変更に関連するレビューカテゴリを特定してください。
    sendResult: true
    resultKey: reviewRules
    maxResultBytes: 20000
    required: true
    completeOnSuccess: true
  - id: analyze-changes
    title: 変更内容をプロジェクト固有ルールに照らして分析
    type: agent
    prompt: |
      チェックリストに沿って変更内容を分析してください。インターフェース影響、エラー処理、回帰リスク、データ互換性、テスト不足に重点を置きます。
      追加の Bazaar コンテキストが必要な場合は、まず MCP tool を使用してください。Bazaar CLI を直接呼ぶ必要がある場合は、`bzr --no-aliases <command>` が必須です。
      `--no-aliases` なしの `bzr <command>` 呼び出しは禁止です。ユーザー環境の alias により GUI ツールが起動し、stdout が返らない可能性があるためです。
    includeState:
      - reviewContext
      - reviewRules
    stateRequired: true
    resultKey: reviewAnalysis
  - id: output-result
    title: review-result JSON と Markdown チェックリストを作成
    type: agent
    prompt: |
      保存済みのレビュー分析を使って、最終的な review-result JSON を作成してください。出力は fenced `json` code block を1つだけにし、それ以外の JSON 風オブジェクトは出力しないでください。

      JSON は次の形に一致している必要があります。

      返却前に `<revision>` を実際の Bazaar リビジョンまたはリビジョン範囲へ置き換えてください。placeholder をそのままコピーしてはいけません。

      `checklist_results[].severity` は必ず `error`、`warning`、`info` のいずれかにしてください。
      `severity` に `N/A`、`not_applicable`、`none`、その他の status 値を入れてはいけません。
      `pass`、`unknown`、`not_applicable`、`blocked` の checklist result は、具体的な問題がない限り `info` を使ってください。`fail` では rule の `severity_on_fail` を使ってください。
      読み込んだ checklist rule ごとに、必ず1つの `checklist_results` entry を含めてください。
      `summary.pass`、`summary.fail`、`summary.unknown`、`summary.not_applicable`、`summary.blocked` の合計は、読み込んだ checklist rule 数と一致している必要があります。

      Markdown 生成や保存で中断した場合、このステップは保持された最新の assistant 出力を再利用して capture を再試行できます。差分収集や分析からやり直さず、直前に生成済みの review-result JSON を使って保存処理を再開してください。

      ```json
      {
        "review_id": "bazaar-r<revision>-project-rule-review",
        "vcs": {
          "type": "bazaar",
          "repository": "<repository root>",
          "revision_mode": "singleRevision",
          "revision": "<revision>"
        },
        "checklist_results": [
          {
            "rule_id": "<checklist rule id>",
            "title": "<checklist rule title>",
            "status": "pass",
            "severity": "info",
            "confidence": "medium",
            "evidence": [
              {
                "file": "<path>",
                "summary": "<evidence summary>"
              }
            ],
            "reason": "<reason>"
          }
        ],
        "findings": [],
        "summary": {
          "pass": 0,
          "fail": 0,
          "unknown": 0,
          "not_applicable": 0,
          "blocked": 0
        }
      }
      ```

      JSON を作成した後、このワークフローは自動的に検証し、`.bob/review/results/<review_id>.json` と `.bob/review/results/<review_id>.md` を保存します。
    includeState:
      - reviewContext
      - reviewRules
      - reviewAnalysis
    stateRequired: true
    resultKey: reviewResultJson
    result:
      source: agent
      sinks:
        - type: command
          command: bobBazaar.captureReviewResult
---
# Bazaar プロジェクト規約レビュー

## 目的

選択した Bazaar リビジョンまたはリビジョン範囲を、プロジェクト固有のレビュー規約に沿って確認します。

## 手順

まず workflow step 定義から Todo リストを作成し、その後、各項目を順番に実施してください。
