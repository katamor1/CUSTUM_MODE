# Phase 3 工程別 Bob ワークフロー整備 CODEX向け設計・テスト計画

- 対象リポジトリ: `katamor1/bob_builtin_analyze`
- 対象ディレクトリ: `extensions/`, `.bob/workflows/`, `docs/workflows/`
- 主対象拡張機能: `workflow-register`
- 関連拡張機能: `bob-code-consistency-review`, `bob-bazaar-review`, `IBM.bob-code`
- 対象フェーズ: Phase 3 工程別 Bob ワークフロー整備
- 作成日: 2026-07-04
- 想定読者: CODEX 実装エージェント、ワークフロー設計者、プロジェクトリーダ、SE、レビュー担当、UAT 担当

## 1. 目的

本書は、Phase 0 で安定化した `workflow-register`、Phase 1 で作成した Bazaar レビュー実績モデル、Phase 2 で整備する Git / 複数言語の整合プレレビュー基盤を前提に、対象部門の開発工程ごとに IBM Bob を活用するワークフロー群を整備するための CODEX 向け設計・テスト計画である。

Phase 3 の目的は、個別の Bob チャット運用を属人的に増やすことではない。工程ごとに「入力」「前提チェック」「Bob に渡す evidence」「人間が確認すべき gate」「保存する成果物」「次工程へ渡す handoff」を定義し、7 プロジェクトへ横展開できるワークフローカタログを作ることである。

## 2. Phase 3 の位置づけ

| フェーズ | 主目的 | Phase 3 との関係 |
|---|---|---|
| Phase 0 | 基盤安定化・運用設計 | command guardrail、path 境界、snapshot privacy、CI/VSIX、workflow 実行品質を前提にする。 |
| Phase 1 | Bazaar レビュー実績作成 | review record、human triage、summary の実績記録モデルを工程別 workflow record へ流用する。 |
| Phase 2 | Git / 複数言語の整合プレレビュー | Git / Bazaar、C/C++、C#、Java、SQL の evidence と traceability を工程別 workflow へ接続する。 |
| Phase 3 | 工程別 Bob ワークフロー整備 | 調査、QA、設計、コーディング、テスト設計、テスト実施、レビュー工程ごとに Bob workflow を整備する。 |

## 3. 対象工程

対象部門のプロジェクトでクラウド AI の Bob に接続できる工程を、Phase 3 のワークフロー整備対象とする。

| 工程カテゴリ | 対象工程 | Phase 3 での扱い |
|---|---|---|
| 調査 | コードベースやドキュメントベースの調査 | 変更影響、仕様所在、既存実装、関連文書候補を収集する workflow を作る。 |
| QA | QA | 問い合わせ、障害、再現条件、既知仕様、関連変更候補を整理する workflow を作る。 |
| 設計 | 外部仕様設計 | 要求・UX・画面・API・外部 I/F の設計支援とレビュー workflow を作る。 |
| 設計 | 内部仕様設計 | モジュール、データ、DB、例外、シーケンス、処理方式の設計支援とレビュー workflow を作る。 |
| 実装 | コーディング | 実装計画、変更影響確認、コード整合プレレビューへの handoff workflow を作る。 |
| テスト | 単体テスト設計 | 変更関数・クラス・SQL・境界値・異常系から単体テスト観点を作る workflow を作る。 |
| テスト | 単体テスト実施 | テスト結果、失敗ログ、coverage、再実行判断を整理する workflow を作る。 |
| テスト | 機能テスト設計 | 要求・外部仕様・UX から機能テスト観点とケースを作る workflow を作る。 |
| テスト | 機能テスト実施 | 実施結果、証跡、障害候補、未実施理由を整理する workflow を作る。 |
| テスト | 結合テスト設計 | API / DB / batch / interface / multi-module 連携観点を作る workflow を作る。 |
| レビュー | 上記工程に対するレビュー | 各工程成果物を checklist / evidence / human triage 付きでレビューする共通 workflow を作る。 |

## 4. Phase 3 の完了定義

| 区分 | 完了条件 |
|---|---|
| catalog | 工程別 workflow catalog が `.bob/workflows` または templates として定義され、各 workflow の目的・入力・出力・適用工程が明示されている。 |
| input contract | 工程別 workflow が共通の `process-input.yaml` または workflow `inputs` 契約に従い、必須ファイル・任意ファイル・VCS 情報・対象言語を検証できる。 |
| artifact contract | 各 workflow が `.bob/process-runs/<runId>/` または `.bob-review/` 配下へ成果物を保存し、次工程へ渡す handoff を生成できる。 |
| human gate | AI が最終承認を行わず、人間の確認・承認・棄却・追加調査 gate を workflow 内に持つ。 |
| review reuse | 設計・コーディング・テスト工程のレビューで Phase 2 の evidence / traceability / Bob output validation を再利用できる。 |
| UAT | 最小 3 工程、推奨 6 工程以上で workflow の dry run と実行確認ができる。 |
| metrics | workflow 実行件数、完了率、差戻し件数、採用指摘、所要時間などを集計できる。 |
| compatibility | 既存 `bazaar-project-rule-review` と `code-consistency-review` workflow を壊さない。 |

## 5. 設計原則

CODEX は、工程別 workflow を追加・変更するときに次を守る。

1. workflow の `name` は安定 ID とし、フォルダ名と一致させる。
2. 既存 command ID、action provider ID、result sink type を破壊的に変更しない。
3. Bob の出力は必ず schema、checklist、evidence index、または人間 gate で検証する。
4. AI には最終承認、正式採否、完了判定を直接させない。
5. workflow は 3〜7 step を基本とし、長すぎる工程は sub-workflow または別 workflow に分ける。
6. 各 workflow は `preflight`、`guardrails`、`artifacts`、`completion` を持つ。
7. VCS 操作は read-only を基本とし、Git / Bazaar の書き込み操作は Phase 3 の範囲外とする。
8. 成果物は workspace 内の明示領域に保存し、workspace 外 path を許可しない。
9. プロジェクト固有の規約は `.bob/review`、`.bob/process`、`.bob/skills` のテンプレートで差し替えられるようにする。
10. 7 プロジェクトで使えるよう、workflow 本体とプロジェクト固有 checklist を分離する。

## 6. 工程別ワークフローカタログ案

Phase 3 では、最初から全工程の完全自動化を目指さず、以下の catalog を段階的に整備する。

| workflow name | 工程 | 目的 | 主な入力 | 主な出力 |
|---|---|---|---|---|
| `process-code-doc-investigation` | 調査 | コード・文書・VCS から調査メモと関連 evidence を作る。 | 調査テーマ、対象 path、VCS range、関連文書 | investigation-report.md, evidence-index.json |
| `process-qa-intake-analysis` | QA | 問い合わせ・障害票・再現条件を整理し、確認観点を作る。 | QA ticket、ログ、画面、環境、関連 revision | qa-analysis.md, reproduction-checklist.md |
| `process-external-spec-design` | 外部仕様設計 | 要求から外部仕様の draft と未決事項を作る。 | requirements, ticket, UX note, current spec | external-spec-draft.md, open-questions.md |
| `process-external-spec-review` | 外部仕様レビュー | 外部仕様を checklist と evidence でレビューする。 | external spec, requirements, UI/API docs | external-spec-review-result.yaml |
| `process-internal-spec-design` | 内部仕様設計 | 外部仕様と既存コードから内部仕様 draft を作る。 | external spec, code evidence, DB docs | internal-spec-draft.md, design-risk.md |
| `process-internal-spec-review` | 内部仕様レビュー | 内部仕様と実装影響・DB・例外・テスト観点の整合を確認する。 | internal spec, requirements, code evidence | internal-spec-review-result.yaml |
| `process-coding-plan` | コーディング | 実装タスク分解、変更影響、注意点を作る。 | design docs, VCS context, language profile | coding-plan.md, implementation-checklist.md |
| `process-code-precheck` | コーディング / レビュー | Phase 2 の整合プレレビューへ接続し、コード差分と文書の整合を確認する。 | review-input.yaml, Git/Bazaar diff | bob-output.yaml, human-triage |
| `process-unit-test-design` | 単体テスト設計 | 変更関数・クラス・SQL・要求から単体テスト観点を作る。 | code evidence, design docs, test policy | unit-test-viewpoints.md, unit-test-cases.yaml |
| `process-unit-test-execution-review` | 単体テスト実施 | テスト実施結果と失敗ログを整理し、再実行・修正要否を判断する。 | test result, logs, coverage | unit-test-execution-review.md |
| `process-functional-test-design` | 機能テスト設計 | 外部仕様・UX・要求から機能テストケース候補を作る。 | external spec, requirements, UX docs | functional-test-cases.yaml |
| `process-functional-test-execution-review` | 機能テスト実施 | 実施結果、証跡、障害候補、未実施理由を整理する。 | test evidence, screenshots, logs | functional-test-execution-review.md |
| `process-integration-test-design` | 結合テスト設計 | API / DB / batch / module 間の結合観点を作る。 | internal spec, interface list, DB impact | integration-test-plan.md |
| `process-common-review` | 共通レビュー | 任意工程成果物を checklist に照らして review-result に正規化する。 | target artifact, checklist, evidence | process-review-result.yaml, review-summary.md |

## 7. 共通成果物モデル

### 7.1 配置

```text
.bob/
  workflows/
    <workflow-name>/
      WORKFLOW.md
  process/
    process-catalog.yaml
    checklists/
      external-spec-review.yaml
      internal-spec-review.yaml
      coding-review.yaml
      test-design-review.yaml
    prompt-packs/
      investigation/
      design/
      test/
      review/
.bob-process-runs/
  <runId>/
    process-input.yaml
    evidence-index.json
    workflow-state-summary.json
    <artifact>.md
    <artifact>.yaml
.bob-process-records/
  campaigns/
    <campaign_id>/
      records/
        <runId>/
          record.yaml
          triage.yaml
          summary.md
      campaign-summary.md
```

### 7.2 process-catalog.yaml

```yaml
schema_version: bob-process-catalog/v1
catalog_id: department-standard-process-workflows
workflows:
  - name: process-code-doc-investigation
    phase: investigation
    title: コード・ドキュメント調査
    owner_role: SE
    required_extensions:
      - local.workflow-register
      - IBM.bob-code
    optional_extensions:
      - local.bob-code-consistency-review
    inputs:
      - investigation_topic
      - target_paths
      - vcs_range
    outputs:
      - investigation-report.md
      - evidence-index.json
```

### 7.3 process-input.yaml

```yaml
schema_version: bob-process-input/v1
process:
  id: qa-timeout-investigation-001
  phase: qa
  project: product-a
  change_type: bugfix
  target_language:
    - c_cpp
  vcs:
    type: git
    base: HEAD~1
    head: HEAD
inputs:
  tickets:
    - path: docs/tickets/BUG-1234.md
  requirements:
    - path: docs/requirements-timeout.md
  design_docs:
    - path: docs/internal-design-timeout.md
  test_docs:
    - path: docs/test-spec-timeout.md
constraints:
  workspace_only: true
  human_approval_required: true
```

### 7.4 process record

```yaml
schema_version: bob-process-record/v1
run_id: wrun-20260704-001
workflow_name: process-qa-intake-analysis
phase: qa
project: product-a
status: completed
started_at: "2026-07-04T10:00:00+09:00"
finished_at: "2026-07-04T10:20:00+09:00"
inputs:
  process_input: .bob-process-runs/wrun-20260704-001/process-input.yaml
outputs:
  primary_artifact: .bob-process-runs/wrun-20260704-001/qa-analysis.md
  evidence_index: .bob-process-runs/wrun-20260704-001/evidence-index.json
human_gate:
  reviewed_by: se-name
  decision: accepted
  notes: "正式レビューへ引き継ぎ可能"
metrics:
  duration_minutes: 20
  ai_steps: 2
  command_steps: 1
  manual_steps: 1
  findings_total: 4
  accepted_items: 3
```

## 8. Workflow 設計テンプレート

各 workflow は、次の構成を標準にする。

```yaml
---
schemaVersion: workflow-register/v1
name: process-example
category: process-workflow
title: 工程別サンプル workflow
mode: agent
workspaceRequired: true
permissions:
  - read
  - todo
inputs:
  processInputPath:
    type: string
    title: process-input.yaml
    prompt: true
preflight:
  - id: check-process-input
    title: process-input.yaml を確認
    required: true
    files:
      - .bob/process/process-catalog.yaml
guardrails:
  allowedCommands:
    - vscode.executeCommand
  allowedCommandIds:
    - bobProcess.collectEvidence
    - bobProcess.writeArtifact
artifacts:
  - id: processReport
    producedBy: write-report
    path: .bob-process-runs/{{run.id}}/process-report.md
stepReview:
  enabled: true
  pauseAfter: agentAndCommand
  requireAcceptBeforeNext: true
steps:
  - id: collect-evidence
    title: evidence を収集
    type: command
    action:
      provider: vscode.executeCommand
      args:
        - bobProcess.collectEvidence
    resultKey: evidence
    sendResult: true
    required: true
  - id: analyze
    title: Bob 分析
    type: agent
    includeState:
      - evidence
    resultKey: analysis
  - id: human-review
    title: 人間確認
    type: manual
  - id: write-report
    title: レポート保存
    type: result
    result:
      source: state
      stateKey: analysis
      sinks:
        - type: file
          path: .bob-process-runs/{{run.id}}/process-report.md
---
# 工程別サンプル workflow
```

## 9. Work package 一覧

| ID | 対象 | 名称 | 優先度 | 主な成果物 |
|---|---|---|---:|---|
| P3-WR-01 | workflow-register / docs | process workflow catalog schema | 1 | process-catalog schema、validation、template |
| P3-WR-02 | workflow-register | process input / record 共通 helper | 1 | process-input validator、record writer、path boundary tests |
| P3-WF-01 | investigation | コード・ドキュメント調査 workflow | 1 | `process-code-doc-investigation`、evidence report |
| P3-WF-02 | QA | QA intake / 障害分析 workflow | 1 | `process-qa-intake-analysis`、reproduction checklist |
| P3-WF-03 | design | 外部仕様設計 / レビュー workflow | 2 | `process-external-spec-design`, `process-external-spec-review` |
| P3-WF-04 | design | 内部仕様設計 / レビュー workflow | 2 | `process-internal-spec-design`, `process-internal-spec-review` |
| P3-WF-05 | coding | コーディング計画 / コード precheck workflow | 2 | `process-coding-plan`, `process-code-precheck` |
| P3-WF-06 | unit-test | 単体テスト設計 / 実施レビュー workflow | 2 | `process-unit-test-design`, `process-unit-test-execution-review` |
| P3-WF-07 | functional-test | 機能テスト設計 / 実施レビュー workflow | 3 | `process-functional-test-design`, `process-functional-test-execution-review` |
| P3-WF-08 | integration-test | 結合テスト設計 workflow | 3 | `process-integration-test-design` |
| P3-WF-09 | review | 共通工程レビュー workflow | 1 | `process-common-review`, review-result schema |
| P3-CCR-01 | bob-code-consistency-review | Phase 2 evidence handoff 連携 | 2 | review-package / evidence-index を工程 workflow で参照 |
| P3-OPS-01 | docs/templates | 工程別 UAT / rollout guide | 1 | UAT checklist、導入手順、metrics 定義 |
| P3-OPS-02 | docs/metrics | 工程別 metrics summary | 3 | workflow summary, project summary, 部門報告 template |

## 10. P3-WR-01: process workflow catalog schema

### 10.1 目的

工程別 workflow を増やしても、目的・工程・入力・出力・前提拡張・責任ロールがばらばらにならないよう、catalog schema を定義する。

### 10.2 設計

追加候補:

```text
docs/workflows/process-workflows/process-catalog-schema.md
docs/workflows/process-workflows/templates/process-catalog.yaml
extensions/workflow-register/resources/schemas/process-catalog.schema.json
```

必須項目:

- `schema_version`
- `catalog_id`
- `workflows[].name`
- `workflows[].phase`
- `workflows[].title`
- `workflows[].owner_role`
- `workflows[].inputs`
- `workflows[].outputs`
- `workflows[].human_gate`
- `workflows[].metrics`

### 10.3 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| valid catalog | 全必須項目を含む catalog。 | validation success。 |
| missing phase | `phase` がない。 | validation error。 |
| unknown phase | `phase: release`。 | schema error。 |
| duplicate name | 同じ workflow name が重複。 | validation error。 |
| missing output | outputs が空。 | warning または error。 |

### 10.4 受け入れ条件

- workflow 追加時に catalog validation ができる。
- phase / owner / input / output が一覧化できる。
- 7 プロジェクトへ配布する workflow set を catalog から説明できる。

## 11. P3-WR-02: process input / record 共通 helper

### 11.1 目的

工程別 workflow が共通の `process-input.yaml` と `bob-process-record` を使えるようにする。

### 11.2 設計

追加候補:

```text
extensions/workflow-register/src/process/processInputTypes.ts
extensions/workflow-register/src/process/processInputValidator.ts
extensions/workflow-register/src/process/processRecordStore.ts
extensions/workflow-register/src/process/processArtifactPaths.ts
```

責務:

| module | 責務 |
|---|---|
| `processInputTypes.ts` | process-input / record 型定義。 |
| `processInputValidator.ts` | schema、path、phase、VCS、target language の検証。 |
| `processRecordStore.ts` | `.bob-process-records` への read/write。 |
| `processArtifactPaths.ts` | workspace 内 path と run artifact path を生成。 |

### 11.3 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| valid input | QA 工程の process-input。 | validation success。 |
| invalid path | `../secret.md` を含む。 | rejection。 |
| unknown language | `target_language: ruby`。 | validation error。 |
| record write | runId 付き record を保存。 | `.bob-process-records` 配下に作成。 |
| no overwrite | 既存 record がある。 | backup または明示確認。 |

### 11.4 受け入れ条件

- 工程別 workflow が共通 validator を使える。
- workspace 外 path が拒否される。
- record が後から metrics 集計に使える。

## 12. P3-WF-01: コード・ドキュメント調査 workflow

### 12.1 目的

調査依頼、影響範囲確認、既存仕様確認を Bob で再利用可能な手順にする。

### 12.2 workflow

```text
.bob/workflows/process-code-doc-investigation/WORKFLOW.md
```

### 12.3 step 案

1. `load-process-input`: 調査テーマ、対象 path、VCS range、関連文書を読み込む。
2. `collect-evidence`: code / docs / traceability / VCS evidence を収集する。
3. `summarize-current-state`: Bob が現状仕様・実装・関連箇所を整理する。
4. `identify-open-questions`: 不明点と追加調査候補を出す。
5. `human-review`: SE が調査結果を確認する。
6. `write-report`: investigation-report.md を保存する。

### 12.4 出力

```text
.bob-process-runs/<runId>/investigation-report.md
.bob-process-runs/<runId>/evidence-index.json
.bob-process-runs/<runId>/open-questions.md
```

### 12.5 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| docs only | 文書だけを指定して調査。 | document evidence と調査 report が出る。 |
| code + docs | code path と docs を指定。 | 両方の evidence が report に反映。 |
| missing docs | 指定文書がない。 | preflight error。 |
| large code | 大きいコード範囲。 | truncation warning。 |

## 13. P3-WF-02: QA intake / 障害分析 workflow

### 13.1 目的

QA 問い合わせや障害票を、再現条件、既知仕様、関連変更候補、追加確認事項へ整理する。

### 13.2 step 案

1. `load-qa-ticket`: ticket / 問い合わせ本文 / ログ / 画面情報を読む。
2. `collect-related-context`: 関連仕様、過去変更、VCS diff、既知不具合を集める。
3. `analyze-reproduction`: 再現条件と不足情報を整理する。
4. `classify-qa-response`: 仕様確認、障害候補、追加調査、再現不可へ分類する。
5. `human-review`: QA / SE が分類を承認する。
6. `write-report`: qa-analysis.md と reproduction-checklist.md を保存する。

### 13.3 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| bug ticket | 再現手順付き障害票。 | reproduction checklist が出る。 |
| inquiry | 仕様問い合わせ。 | 関連仕様と回答 draft が出る。 |
| missing log | ログ不足。 | open questions に不足情報が出る。 |
| human gate | AI が障害確定しようとする。 | 人間確認 gate で止まる。 |

## 14. P3-WF-03: 外部仕様設計 / レビュー workflow

### 14.1 目的

要求、UX、画面、API、外部 I/F から外部仕様 draft を作成し、別 workflow でレビューできるようにする。

### 14.2 workflow

- `process-external-spec-design`
- `process-external-spec-review`

### 14.3 design step 案

1. requirements / ticket / UX note を読み込む。
2. 既存外部仕様と類似画面・API を収集する。
3. 外部仕様 draft を作る。
4. 未決事項、影響範囲、非対象を列挙する。
5. 人間が draft を確認する。
6. external-spec-draft.md を保存する。

### 14.4 review checklist

| 観点 | 例 |
|---|---|
| requirement coverage | 要求 ID が外部仕様に反映されているか。 |
| UX consistency | 既存画面や用語と矛盾しないか。 |
| API compatibility | 外部 I/F 変更が明示されているか。 |
| error handling | エラー表示、例外、境界条件があるか。 |
| testability | 機能テストへ落とせる記述か。 |

### 14.5 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| requirement coverage | 要求 3 件から draft 作成。 | 要求 ID が trace される。 |
| missing UX | UX note なし。 | open question に出る。 |
| review fail | API 影響未記載。 | review-result に finding。 |

## 15. P3-WF-04: 内部仕様設計 / レビュー workflow

### 15.1 目的

外部仕様、既存コード、DB、非機能制約から内部仕様 draft を作る。

### 15.2 workflow

- `process-internal-spec-design`
- `process-internal-spec-review`

### 15.3 review checklist

| 観点 | 例 |
|---|---|
| module responsibility | モジュール責務が明確か。 |
| data design | DB / file / shared memory への影響が明記されているか。 |
| exception handling | 異常系処理が設計されているか。 |
| compatibility | 既存 API / data / migration 互換性が検討されているか。 |
| test design handoff | 単体・結合テスト観点へ渡せるか。 |

### 15.4 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| code evidence | Phase 2 evidence を入力。 | 内部仕様 draft に関連 symbol が出る。 |
| db impact | SQL 変更を含む。 | DB 影響 section が出る。 |
| review | 例外設計不足。 | finding と修正観点が出る。 |

## 16. P3-WF-05: コーディング計画 / コード precheck workflow

### 16.1 目的

設計から実装タスクへ落とし込み、実装後は Phase 2 の整合プレレビューへ接続する。

### 16.2 workflow

- `process-coding-plan`
- `process-code-precheck`

### 16.3 coding plan 出力

```text
implementation-checklist.md
change-impact.md
risk-and-rollback.md
unit-test-handoff.md
```

### 16.4 code precheck

`process-code-precheck` は `bob-code-consistency-review` の `review-input.yaml`、`review-package`、`bob-output.yaml`、human triage を参照する。Phase 2 の evidence を再利用し、工程 record に handoff する。

### 16.5 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| design to tasks | 内部仕様から実装 checklist を作る。 | task、risk、test handoff が出る。 |
| code diff | Git diff を入力。 | Phase 2 precheck へ handoff。 |
| no design | 設計書なし。 | preflight warning / stop。 |

## 17. P3-WF-06: 単体テスト設計 / 実施レビュー workflow

### 17.1 目的

変更関数、クラス、SQL、設計観点から単体テスト観点を作り、実施結果をレビューする。

### 17.2 workflow

- `process-unit-test-design`
- `process-unit-test-execution-review`

### 17.3 unit test design 観点

| 言語 | 観点 |
|---|---|
| C/C++ | 関数、境界値、エラー戻り値、global/shared data、RT/TS 制約。 |
| C# | class/method、Controller、service、validation、mock、config。 |
| Java | method、service、repository、exception、JUnit。 |
| SQL | migration、stored procedure、rollback、データ境界。 |

### 17.4 実施レビュー入力

- test result log
- coverage report
- failed tests
- skipped tests
- manual evidence

### 17.5 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| C++ function | 変更関数から単体テスト観点生成。 | normal / boundary / error が出る。 |
| C# service | service 変更。 | mock と validation 観点が出る。 |
| failed test | failed log 入力。 | 再現・原因候補・再実行判断が出る。 |
| skipped test | skip を含む。 | 未実施理由と risk が出る。 |

## 18. P3-WF-07: 機能テスト設計 / 実施レビュー workflow

### 18.1 目的

外部仕様、UX、要求、QA 観点から機能テストケースを作り、実施結果を整理する。

### 18.2 workflow

- `process-functional-test-design`
- `process-functional-test-execution-review`

### 18.3 test design output

```yaml
schema_version: functional-test-cases/v1
cases:
  - case_id: FT-001
    requirement_refs:
      - REQ-001
    title: 正常系: 注文登録
    preconditions: []
    steps: []
    expected: []
    priority: high
    evidence_refs: []
```

### 18.4 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| UX change | 画面仕様変更からケース作成。 | 正常系 / 異常系 / 表示確認が出る。 |
| requirement gap | 要求に対応ケースなし。 | test-gap finding。 |
| execution evidence | screenshot / result を入力。 | 合否と不足証跡が出る。 |

## 19. P3-WF-08: 結合テスト設計 workflow

### 19.1 目的

内部仕様、API、DB、batch、モジュール間連携から結合テスト観点を作る。

### 19.2 観点

| 観点 | 例 |
|---|---|
| API chain | 呼び出し元・呼び出し先・例外 propagation。 |
| DB transaction | commit / rollback / migration / lock。 |
| batch integration | 入出力 file、再実行、異常終了。 |
| external interface | message、REST、file transfer、shared memory。 |
| version compatibility | 既存製品・旧データ・旧 API との互換。 |

### 19.3 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| API + DB | API と SQL 変更。 | integration-test-plan に DB 観点。 |
| batch | batch 入出力変更。 | 再実行・異常終了観点。 |
| missing interface doc | I/F 文書なし。 | open question / risk。 |

## 20. P3-WF-09: 共通工程レビュー workflow

### 20.1 目的

外部仕様、内部仕様、テスト仕様、調査報告など任意工程成果物を、工程別 checklist に照らしてレビューする。

### 20.2 設計

`process-common-review` は、次を入力に取る。

- target artifact path
- review phase
- checklist path
- evidence index path
- output schema path

出力:

```text
process-review-result.yaml
review-summary.md
human-triage.yaml
```

### 20.3 review-result schema

```yaml
schema_version: process-review-result/v1
review_id: external-spec-review-001
phase: external_spec_design
target_artifact: docs/external-spec.md
checklist_results:
  - rule_id: EXT-001
    status: pass
    severity: info
    evidence_refs:
      - REQ-001
findings: []
summary:
  pass: 1
  fail: 0
  unknown: 0
  blocked: 0
```

### 20.4 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| valid review | 外部仕様 + checklist。 | review-result が valid。 |
| missing evidence | evidence ref がない。 | validation error。 |
| fail rule | checklist fail。 | finding 必須。 |
| triage | review-result から triage。 | human decision が保存される。 |

## 21. P3-CCR-01: Phase 2 evidence handoff 連携

### 21.1 目的

Phase 2 の `review-package`、`evidence-index.json`、`bob-output.yaml`、human triage を、工程別 workflow から参照できるようにする。

### 21.2 設計

- `process-code-precheck` は Phase 2 の `bobCodeConsistency.preprocess` を command step で呼ぶ。
- `process-coding-plan` は `changed-symbols-v2.json` と `interface-impact.json` を実装計画へ反映する。
- `process-unit-test-design` は `test-gap` と code evidence を単体テスト観点へ変換する。
- `process-internal-spec-review` は `document-update-gap` と `interface-impact` を review finding に変換する。

### 21.3 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| review-package input | evidence-index を工程 workflow に渡す。 | evidence ref が維持される。 |
| missing package | review-package なし。 | preflight error。 |
| output validation | Bob output が missing evidence。 | workflow が fail / reviewing で止まる。 |

## 22. P3-OPS-01: 工程別 UAT / rollout guide

### 22.1 目的

7 プロジェクトへ展開する前に、工程別 workflow を小さく UAT できるようにする。

### 22.2 追加 docs 候補

```text
docs/uat/process-workflows-uat-plan-ja.md
docs/ops/process-workflows-rollout-guide-ja.md
docs/metrics/process-workflows-metrics-ja.md
docs/templates/process-workflow-report-template-ja.md
```

### 22.3 推奨 UAT ケース

| ID | workflow | 目的 |
|---|---|---|
| P3-UAT-001 | `process-code-doc-investigation` | 調査 workflow の基本導線確認。 |
| P3-UAT-002 | `process-qa-intake-analysis` | QA 問い合わせ / 障害分析の再現性確認。 |
| P3-UAT-003 | `process-external-spec-review` | 外部仕様 review-result と triage 確認。 |
| P3-UAT-004 | `process-internal-spec-review` | 内部仕様と Phase 2 evidence の接続確認。 |
| P3-UAT-005 | `process-code-precheck` | Git / Bazaar 差分と整合プレレビュー handoff。 |
| P3-UAT-006 | `process-unit-test-design` | 変更 evidence から単体テスト観点生成。 |
| P3-UAT-007 | `process-functional-test-design` | 外部仕様から機能テストケース生成。 |
| P3-UAT-008 | `process-common-review` | 任意成果物の checklist review。 |

### 22.4 合格基準

- 最小 3 workflow が Bob Workflow UI に表示され、実行できる。
- 各 workflow が成果物を workspace 内に保存する。
- human gate が機能し、AI 出力を人間が承認または差戻しできる。
- invalid input / missing file / missing evidence の negative test が通る。
- workflow 実行 record と summary が作成される。

## 23. P3-OPS-02: 工程別 metrics summary

### 23.1 目的

工程別 workflow の利用実績を、プロジェクトリーダが確認できる形で集計する。

### 23.2 指標

| 指標 | 意味 |
|---|---|
| workflow_runs_total | workflow 実行件数。 |
| completed_runs | 完了件数。 |
| failed_runs | 失敗件数。 |
| human_review_wait_minutes | 人間 gate 待ち時間。 |
| artifacts_created | 成果物数。 |
| findings_total | review finding 件数。 |
| accepted_findings | 採用指摘数。 |
| rejected_findings | 棄却指摘数。 |
| open_questions | 未決事項数。 |
| handoff_created | 次工程 handoff 件数。 |
| rework_candidates | 差戻し候補数。 |

### 23.3 summary 出力

```text
.bob-process-records/campaigns/<campaign_id>/campaign-summary.json
.bob-process-records/campaigns/<campaign_id>/campaign-summary.md
```

### 23.4 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| empty campaign | record なし。 | warning 付き summary。 |
| multiple phases | QA / design / test の record を集計。 | phase 別件数が一致。 |
| invalid record | 不正 record 混入。 | invalid count に入り、成功件数に混ぜない。 |

## 24. 全体テスト戦略

### 24.1 テスト層

| 層 | 目的 | 対象 |
|---|---|---|
| schema unit | process catalog / input / record / review-result schema を検証する。 | schema validators |
| workflow parse | `WORKFLOW.md` の front matter と step 定義を検証する。 | workflow-register parser / validator |
| command integration | action provider / VS Code command / result sink を検証する。 | workflow-register + related extensions |
| fixture integration | sample docs / code / test logs から成果物を生成する。 | docs/workflows/process-workflows/examples |
| workflow integration | Bob Workflow UI 相当の run state で step 実行を確認する。 | workflow-register engine |
| real-machine UAT | Bob IDE / VS Code 上で実 workspace を使い確認する。 | UAT project |

### 24.2 共通 negative tests

| 観点 | 異常入力 | 期待結果 |
|---|---|---|
| process input | phase 不明 | validation error。 |
| path | absolute path / `..` / symlink escape | validation error。 |
| required file | 必須文書なし | preflight stop。 |
| evidence | 存在しない evidence ref | output validation error。 |
| command | allowlist 外 command | guardrail error。 |
| AI output | schema 外 field / 最終承認主張 | validation error または human gate。 |
| record | summary 件数不一致 | validation error。 |

## 25. CODEX への作業指示テンプレート

```text
対象: <P3 work package ID>
目的: <1文で目的>
変更対象:
- <path>

制約:
- 既存 workflow name / command ID / provider ID を破壊的に変更しない。
- workflow は schemaVersion: workflow-register/v1 を使う。
- process-input / process-record / review-result の schema とテストを追加する。
- workspace 外 path を許可しない。
- AI に最終承認をさせない。human gate を置く。
- Bob 出力は schema / checklist / evidence で検証する。
- README/docs とテストを同時に更新する。

実装内容:
1. <実装ステップ>
2. <実装ステップ>
3. <実装ステップ>

テスト:
- npm run compile
- npm run test
- 追加 unit test: <list>
- 追加 workflow fixture: <list>
- 追加 UAT testcase: <list>

完了条件:
- <受け入れ条件>
```

## 26. 推奨実装順

Phase 3 は次の順序で進める。

1. `P3-WR-01`: process workflow catalog schema
2. `P3-WR-02`: process input / record 共通 helper
3. `P3-WF-09`: 共通工程レビュー workflow
4. `P3-WF-01`: コード・ドキュメント調査 workflow
5. `P3-WF-02`: QA intake / 障害分析 workflow
6. `P3-CCR-01`: Phase 2 evidence handoff 連携
7. `P3-WF-05`: コーディング計画 / コード precheck workflow
8. `P3-WF-03`: 外部仕様設計 / レビュー workflow
9. `P3-WF-04`: 内部仕様設計 / レビュー workflow
10. `P3-WF-06`: 単体テスト設計 / 実施レビュー workflow
11. `P3-WF-07`: 機能テスト設計 / 実施レビュー workflow
12. `P3-WF-08`: 結合テスト設計 workflow
13. `P3-OPS-01`: 工程別 UAT / rollout guide
14. `P3-OPS-02`: 工程別 metrics summary

最初に catalog と共通 record を固める理由は、工程別 workflow を個別最適で増やすと、入力・出力・metrics がばらけて横展開できなくなるためである。

## 27. CODEX レビュー観点

| 観点 | 確認内容 |
|---|---|
| process fit | 対象工程の入力・出力・人間 gate が明確か。 |
| compatibility | 既存 workflow / command / provider を壊していないか。 |
| evidence integrity | evidence refs と成果物が追跡できるか。 |
| safety | workspace 外 path、VCS 書き込み、危険 command がないか。 |
| human-in-the-loop | AI の判断を人間が確認する gate があるか。 |
| operability | UAT 担当が手順だけで実行できるか。 |
| metrics | 実行 record と summary に必要な指標が残るか。 |
| maintainability | workflow が長すぎず、共通 helper / template を再利用しているか。 |

## 28. Phase 3 の成功指標

| 指標 | 目標 |
|---|---|
| workflow catalog 登録数 | 最小 6、推奨 10 以上。 |
| UAT 成功 workflow 数 | 最小 3、推奨 6 以上。 |
| human gate 実施率 | UAT run の 100%。 |
| artifact 保存成功率 | UAT run の 95% 以上。 |
| invalid input 検出率 | negative test で 100%。 |
| workflow record 作成率 | UAT run の 100%。 |
| project rollout readiness | 7 プロジェクトへ配布できる template / guide が揃う。 |

## 29. Phase 3 で実装しないこと

以下は Phase 3 の範囲外とする。

- 工程成果物の自動承認
- 自動コード修正・自動コミット
- Git / Bazaar への書き込み操作
- 本番 DB 接続やテスト環境操作の自動実行
- 全工程の完全自動化
- 組織標準プロセスそのものの変更
- プロジェクト固有 checklist の全量作成

## 30. 参照資料

- `docs/phase0-foundation-stabilization-codex-plan-ja.md`
- `docs/phase1-bazaar-review-record-codex-plan-ja.md`
- `docs/phase2-git-multilanguage-consistency-prereview-codex-plan-ja.md`
- `extensions/workflow-register/README.md`
- `docs/workflow-authoring-guide-ja.md`
- `extensions/bob-code-consistency-review/README.md`
- `docs/workflows/code-consistency-review/README.md`
- `extensions/bob-bazaar-review/README.md`
- `extensions/README.md`

## 31. 推奨コミット

```text
docs: add phase 3 process Bob workflows Codex plan
```
