# Phase 1 Bazaar レビュー実績作成 CODEX向け設計・テスト計画

- 対象リポジトリ: `katamor1/bob_builtin_analyze`
- 対象ディレクトリ: `extensions/`
- 主対象拡張機能: `bob-bazaar-review`
- 関連拡張機能: `workflow-register`, `IBM.bob-code`
- 対象フェーズ: Phase 1 Bazaar レビュー実績作成
- 作成日: 2026-07-04
- 想定読者: CODEX 実装エージェント、UAT 担当、プロジェクトリーダ、拡張機能レビュー担当

## 1. 目的

本書は、Phase 0 で安定化した Bob / Bazaar レビュー基盤を使い、実案件または実案件相当の Bazaar リポジトリで「IBM Bob を用いたレビュー実績」を再現可能に作成するための CODEX 向け設計・テスト計画である。

Phase 1 では、単に `bob-bazaar-review` が動くことを確認するだけでは不十分である。次の実績データを、後から集計・説明・監査できる形で残すことをゴールにする。

1. どの Bazaar revision / revision range / working tree 差分をレビューしたか。
2. どのプロジェクト規約 checklist に照らしたか。
3. Bob がどの review-result JSON / Markdown を生成し、schema 検証に通ったか。
4. 人間が Bob の指摘を採用、棄却、追加調査、保留のどれに分類したか。
5. 従来レビューと比べた所要時間、見落とし防止、レビュー準備効率の効果をどう測るか。
6. 7 プロジェクトへ横展開できる運用テンプレートになっているか。

## 2. Phase 1 の位置づけ

Phase 1 は、次期開発段階の中で `bob-bazaar-review` の有効性を示すための実績作成フェーズである。

| フェーズ | 主目的 | Phase 1 との関係 |
|---|---|---|
| Phase 0 | 基盤安定化・運用設計 | command guardrail、snapshot privacy、MCP cwd、VCS/path 境界、CI/VSIX を固める前提。 |
| Phase 1 | Bazaar レビュー実績作成 | Bazaar レビューを UAT / 実案件相当で回し、実績データと改善 backlog を作る。 |
| Phase 2 | Git 対応・レビュー横展開 | Phase 1 で固めた実績記録モデルを Git review に流用する。 |
| Phase 3 | 工程別 Bob workflow 展開 | レビュー実績モデルを外部仕様、内部仕様、テスト設計などへ拡張する。 |

Phase 1 では、Git や code consistency review の本格拡張は行わない。対象は Bazaar レビューの実績作成に絞る。

## 3. Phase 1 の完了定義

| 区分 | 完了条件 |
|---|---|
| review execution | `singleRevision`, `revisionRange`, `workingTreeSinceRevision` の代表ケースで review packet を作成し、Bob review を実行できる。 |
| structured output | Bob 出力が `review-result.schema.json` に通り、`.bob/review/results/<review_id>.json` と `.md` に保存される。 |
| human triage | Bob 指摘を人間が `accepted` / `rejected` / `needs_investigation` / `deferred` に分類できる。 |
| evidence record | review packet、review-result、triage、所要時間、対象 revision、環境情報を 1 件の review record として追跡できる。 |
| metrics | 実績報告に使う集計値を Markdown / JSON で出せる。 |
| reproducibility | UAT 担当が手順書だけで review campaign を再実行できる。 |
| safety | Bazaar CLI は `--no-aliases` 経路を維持し、MCP は読み取り専用のまま実績作成できる。 |

## 4. 前提条件

Phase 1 の実装・UAT に入る前に、最低限次を満たす。

1. `bob-bazaar-review`、`workflow-register`、`IBM.bob-code` の VSIX または開発版が導入できる。
2. Bazaar CLI が利用可能である。
3. `.bob/review/checklist.json` と `.bob/review/review-result.schema.json` がプロジェクトごとに準備されている。
4. `.bob/workflows/bazaar-project-rule-review/WORKFLOW.md` が Bob Workflow UI へ登録されている。
5. Phase 0 の security / privacy 方針に反しない設定である。
6. 実績作成に使ってよい revision / revision range がプロジェクトリーダにより選定されている。

## 5. 既存機能の利用方針

Phase 1 は、既存機能を最大限使い、必要な追加実装を「実績記録」「UAT支援」「集計」に絞る。

| 既存機能 | Phase 1 での使い方 |
|---|---|
| `bobBazaar.openReviewGui` | レビュー対象選定、packet 生成、Bob context 追加の標準入口にする。 |
| `bobBazaar.collectReviewContext` | workflow state / review record の対象情報として利用する。 |
| `bobBazaar.loadReviewRules` | checklist 件数、カテゴリ、schema 情報を実績 record に含める。 |
| `bobBazaar.captureReviewResult` | Bob 出力 JSON を検証・保存する正式導線にする。 |
| `bobBazaar.validateReviewResultJson` | UAT 時の検証再実行、異常系確認に使う。 |
| Bazaar MCP readonly tools | Bob が追加確認する場合の調査手段として使う。破壊的操作は追加しない。 |
| `.bob/review/results/*.json` | 実績 record の中核データとして参照する。 |
| `.bob/workflows/runs/<runId>/run.json` | workflow 実行の補助 evidence として参照する。 |

## 6. Phase 1 で追加する成果物モデル

### 6.1 review record の配置

Phase 1 では、review-result の保存先を変えず、追加の実績記録を次へ保存する設計にする。

```text
.bob-review-records/
  campaigns/
    <campaign_id>/
      campaign.yaml
      targets.yaml
      records/
        <review_id>/
          record.yaml
          triage.yaml
          metrics.json
          notes.md
      summary.json
      summary.md
```

`bob-bazaar-review` の既存成果物はそのまま維持する。

```text
.bob/review/results/<review_id>.json
.bob/review/results/<review_id>.md
```

`record.yaml` から既存成果物を参照する。

### 6.2 campaign.yaml

レビュー実績作成の単位を `campaign` と呼ぶ。

```yaml
schema_version: bazaar-review-campaign/v1
campaign_id: phase1-bazaar-review-uat-001
title: Phase 1 Bazaar レビュー実績作成 UAT
project: legacy-control
owner: project-leader-name
repository:
  type: bazaar
  path_hint: .
review_policy:
  checklist_path: .bob/review/checklist.json
  schema_path: .bob/review/review-result.schema.json
privacy:
  share_level: internal
  snapshot_messages_allowed: false
metrics:
  baseline_review_minutes_required: true
  human_triage_required: true
```

### 6.3 targets.yaml

レビュー対象 revision を事前定義する。

```yaml
schema_version: bazaar-review-targets/v1
campaign_id: phase1-bazaar-review-uat-001
targets:
  - target_id: bzr-r125-single
    mode: singleRevision
    revision: "125"
    change_type: bugfix
    reason: 不具合修正の代表ケース
    expected_review_focus:
      - error-handling
      - regression-risk
  - target_id: bzr-r120-r126-range
    mode: revisionRange
    base_revision: "120"
    target_revision: "126"
    change_type: feature
    reason: 複数 revision にまたがる機能追加
  - target_id: bzr-working-tree-001
    mode: workingTreeSinceRevision
    base_revision: "126"
    change_type: precommit
    reason: コミット前レビューの代表ケース
```

### 6.4 record.yaml

1 回の Bob Bazaar review 実行ごとの記録である。

```yaml
schema_version: bazaar-review-record/v1
campaign_id: phase1-bazaar-review-uat-001
record_id: bzr-r125-single-run-001
review_id: bazaar-r125-project-rule-review
target_id: bzr-r125-single
workflow:
  workflow_id: bazaar-project-rule-review
  run_id: <workflow-register-run-id>
  started_at: "2026-07-04T10:00:00+09:00"
  finished_at: "2026-07-04T10:18:00+09:00"
  status: completed
vcs:
  type: bazaar
  repository: <repository-root>
  revision_mode: singleRevision
  revision: "125"
inputs:
  review_packet_path: .bob-review-records/campaigns/phase1-bazaar-review-uat-001/records/bazaar-r125-project-rule-review/review-packet.md
  checklist_path: .bob/review/checklist.json
outputs:
  review_result_json: .bob/review/results/bazaar-r125-project-rule-review.json
  review_result_markdown: .bob/review/results/bazaar-r125-project-rule-review.md
  triage_yaml: .bob-review-records/campaigns/phase1-bazaar-review-uat-001/records/bazaar-r125-project-rule-review/triage.yaml
quality_gate:
  schema_valid: true
  checklist_count_matches: true
  evidence_required_satisfied: true
  findings_have_rule_id: true
metrics:
  baseline_review_minutes: 45
  bob_review_minutes: 18
  human_triage_minutes: 12
  findings_total: 3
  findings_accepted: 2
  findings_rejected: 1
  findings_needs_investigation: 0
notes: notes.md
```

### 6.5 triage.yaml

Bob の指摘を人間が評価した結果である。

```yaml
schema_version: bazaar-review-triage/v1
review_id: bazaar-r125-project-rule-review
triaged_by: reviewer-name
triaged_at: "2026-07-04T11:00:00+09:00"
items:
  - finding_id: F-001
    rule_id: RT-001
    decision: accepted
    action: fix_required
    owner: developer-name
    reason: 実コード上で規約違反を確認したため。
  - finding_id: F-002
    rule_id: API-003
    decision: rejected
    action: no_action
    reason: 対象外モジュールのため。
summary:
  accepted: 1
  rejected: 1
  needs_investigation: 0
  deferred: 0
```

### 6.6 summary.json / summary.md

campaign 単位で実績を集計する。

```json
{
  "campaign_id": "phase1-bazaar-review-uat-001",
  "records_total": 6,
  "schema_valid_records": 6,
  "findings_total": 18,
  "findings_accepted": 11,
  "findings_rejected": 5,
  "findings_needs_investigation": 2,
  "baseline_review_minutes_total": 270,
  "bob_review_minutes_total": 110,
  "human_triage_minutes_total": 74,
  "estimated_minutes_saved": 86
}
```

## 7. CODEX 実装原則

CODEX は次を守る。

1. 既存の `review-result.schema.json` 形式を壊さない。
2. `.bob/review/results` の保存仕様を変更しない。
3. 追加の実績 record は `.bob-review-records` に分離する。
4. Bob の判断を最終判断にしない。人間 triage を必須にする。
5. 実績集計は、検証済み JSON と人間 triage のみを source of truth にする。
6. Bazaar CLI は必ず `--no-aliases` 経路を維持する。
7. workspace 外への読み書きを追加しない。
8. 実案件情報を含む可能性があるため、record export は redaction / share level を意識する。

## 8. Work package 一覧

| ID | 対象 | 名称 | 優先度 | 主な成果物 |
|---|---|---|---:|---|
| P1-OPS-01 | docs/templates | Bazaar review campaign 運用テンプレート | 1 | campaign / target / record / triage template、UAT 手順 |
| P1-BBR-01 | bob-bazaar-review | review record schema / writer | 1 | `.bob-review-records` writer、path validation、record tests |
| P1-BBR-02 | bob-bazaar-review | review packet artifact 化 | 1 | packet 保存、record への packet path 記録、GUI/direct command 対応 |
| P1-BBR-03 | bob-bazaar-review | human triage helper | 1 | triage YAML 生成、validation、Markdown report |
| P1-BBR-04 | bob-bazaar-review | campaign summary generator | 2 | summary.json / summary.md 生成、metrics tests |
| P1-WR-01 | workflow-register 連携 | workflow run metadata 連携 | 2 | runId / step status / duration 取得、record への反映 |
| P1-UAT-01 | test/docs | Bazaar 実績作成 UAT script / checklist | 2 | UAT checklist、結果記録テンプレート、合格基準 |
| P1-OPS-02 | docs | 実績報告テンプレート | 3 | 部門報告用 Markdown、効果測定項目 |

## 9. P1-OPS-01: Bazaar review campaign 運用テンプレート

### 9.1 目的

UAT 担当者が、レビュー対象を事前選定し、同じ条件で複数回の Bob Bazaar review を実行できるようにする。

### 9.2 追加候補ファイル

```text
docs/uat/bazaar-review-campaign-template-ja.md
docs/uat/bazaar-review-record-template.yaml
docs/uat/bazaar-review-triage-template.yaml
docs/uat/bazaar-review-summary-template.md
```

または `extensions/bob-bazaar-review/templates/` に runtime 用テンプレートとして追加する。

### 9.3 設計

UAT 手順は次の構成にする。

1. 環境情報の記録
2. campaign 作成
3. targets 選定
4. `.bob` 初期化
5. review packet 生成
6. Bob workflow 実行
7. review-result capture / validation
8. human triage
9. summary 生成
10. 不具合 / 改善 backlog 化

### 9.4 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| template completeness | template に必須項目があるか確認する。 | campaign_id、target_id、review_id、triage decision が含まれる。 |
| docs dry run | テスト担当が docs だけで手順を追う。 | 不足手順がない。 |
| copy safety | template を workspace にコピーして使う。 | 実案件ファイルを上書きしない。 |

### 9.5 受け入れ条件

- campaign 開始前に対象 revision / range を合意できる。
- triage と summary まで記録できる。
- 7 プロジェクトへ配布しても project 名と checklist だけ差し替えれば使える。

## 10. P1-BBR-01: review record schema / writer

### 10.1 目的

Bob Bazaar review の実行結果を、後から集計できる `record.yaml` として保存する。

### 10.2 設計

#### 10.2.1 record writer module

追加候補:

```text
extensions/bob-bazaar-review/src/records/reviewRecordTypes.ts
extensions/bob-bazaar-review/src/records/reviewRecordStore.ts
extensions/bob-bazaar-review/src/records/reviewRecordValidator.ts
extensions/bob-bazaar-review/src/records/reviewRecordCommands.ts
```

責務:

| module | 責務 |
|---|---|
| `reviewRecordTypes.ts` | campaign / target / record / triage / summary の型。 |
| `reviewRecordStore.ts` | `.bob-review-records` 配下への read/write。 |
| `reviewRecordValidator.ts` | required field、path、summary consistency の検証。 |
| `reviewRecordCommands.ts` | Command Palette から record 作成・検証を呼ぶ。 |

#### 10.2.2 command 候補

| コマンド | command ID | 用途 |
|---|---|---|
| `Bazaar レビュー: 実績 campaign を初期化` | `bobBazaar.records.initCampaign` | campaign.yaml / targets.yaml 雛形を作る。 |
| `Bazaar レビュー: 実績 record を作成` | `bobBazaar.records.createRecord` | 保存済み review-result から record.yaml を作る。 |
| `Bazaar レビュー: 実績 record を検証` | `bobBazaar.records.validateRecord` | record と参照成果物の整合を検証する。 |

#### 10.2.3 path boundary

`.bob-review-records` の writer は workspace root 配下のみを許可する。

禁止:

- absolute path
- `..` escape
- symlink escape
- `.bob/review/results` の上書き
- Bazaar repository への書き込み

### 10.3 テスト計画

| レイヤー | テスト | 期待結果 |
|---|---|---|
| unit | valid record を保存する。 | `.bob-review-records/.../record.yaml` が作成される。 |
| unit | `review_id` がない record を保存する。 | validation error。 |
| unit | workspace 外 path を指定する。 | 拒否。 |
| unit | review-result JSON が存在しない。 | record validation error。 |
| unit | schema_valid false の review-result を参照する。 | quality_gate が fail になる。 |
| integration | capture 後に record を作成する。 | review-result 参照付き record が生成される。 |

### 10.4 受け入れ条件

- `review-result.json` と `record.yaml` が相互に追跡できる。
- `record.yaml` は workspace 外参照を持たない。
- invalid record は summary 集計対象から除外または fail として扱われる。

## 11. P1-BBR-02: review packet artifact 化

### 11.1 目的

Phase 1 の実績作成では、Bob に渡した review packet そのものが重要な evidence になる。GUI や direct command で生成した packet を、一時的な editor だけでなく campaign record 配下に保存できるようにする。

### 11.2 設計

#### 11.2.1 保存先

```text
.bob-review-records/campaigns/<campaign_id>/records/<review_id>/review-packet.md
```

campaign 未指定の場合は、Phase 0 の review packet identity 方針に合わせ、`.bob/review/packets/<review_id>.md` へ保存してもよい。ただし Phase 1 の実績 record では campaign 配下への保存を推奨する。

#### 11.2.2 GUI 連携

Bazaar Review GUI に以下を追加する。

| UI | 内容 |
|---|---|
| campaign id | 任意。指定時は campaign 配下へ保存する。 |
| target id | 任意。targets.yaml と紐付ける。 |
| save packet | Bob context 追加と同時に packet artifact を保存する。 |

#### 11.2.3 direct command 連携

`reviewRevisionWithProjectRules` / `reviewRangeWithProjectRules` の保存選択肢に `record artifact として保存` を追加する。

### 11.3 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| GUI single revision | campaign id 指定で packet を生成する。 | campaign records 配下に packet が保存される。 |
| GUI range | range packet を保存する。 | base / target revision が packet と record に残る。 |
| direct command | project rules 付き command で保存する。 | packet path が record 作成時に参照される。 |
| missing campaign | campaign 未指定で保存する。 | fallback path に保存されるか、保存なしが明示される。 |
| overwrite | 同じ review_id の packet が既にある。 | 上書き確認または backup が作られる。 |

### 11.4 受け入れ条件

- Bob に渡した packet を後から確認できる。
- record.yaml に `inputs.review_packet_path` が記録される。
- packet 保存は workspace 内に限定される。

## 12. P1-BBR-03: human triage helper

### 12.1 目的

Bob の review-result を、人間の正式判断へ変換する。Phase 1 の実績では「Bob が何を出したか」よりも「人間がどれを採用したか」が重要である。

### 12.2 設計

#### 12.2.1 triage generator

保存済み review-result JSON から `triage.yaml` の雛形を生成する。

```text
Bazaar レビュー: 人間 triage 雛形を生成
bobBazaar.records.createTriage
```

生成ルール:

- `findings[]` ごとに triage item を作る。
- `checklist_results[].status == fail` で finding がない場合は `needs_investigation` 候補を作る。
- 初期 decision は `needs_investigation` とする。
- 人間が明示的に `accepted` / `rejected` / `deferred` へ変更する。

#### 12.2.2 triage validator

```text
Bazaar レビュー: 人間 triage を検証
bobBazaar.records.validateTriage
```

検証項目:

- `review_id` が review-result と一致する。
- `finding_id` が存在する。
- `decision` が enum に合う。
- `accepted` の場合は `action` と `owner` を推奨または必須にする。
- summary 件数が items と一致する。

#### 12.2.3 Markdown report

triage 結果を human-friendly な Markdown に変換する。

```text
.bob-review-records/campaigns/<campaign_id>/records/<review_id>/triage.md
```

### 12.3 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| findingsあり | findings 2 件の review-result から triage を生成。 | items 2 件、初期 decision は `needs_investigation`。 |
| fail checklist findingなし | fail rule だが finding がない。 | 追加調査 item が生成される。 |
| invalid decision | `decision: maybe` を含む。 | validation error。 |
| summary mismatch | summary 件数が items と不一致。 | validation error。 |
| markdown | triage.yaml から Markdown を生成。 | accepted / rejected / needs_investigation が表で確認できる。 |

### 12.4 受け入れ条件

- Bob 指摘に対する人間判断を保存できる。
- 集計は triage.yaml を source of truth にできる。
- triage なしの record は campaign summary で `triage_missing` として扱われる。

## 13. P1-BBR-04: campaign summary generator

### 13.1 目的

複数 review record を集計し、Phase 1 の実績報告に使える summary を生成する。

### 13.2 設計

#### 13.2.1 command

```text
Bazaar レビュー: 実績 campaign summary を生成
bobBazaar.records.generateSummary
```

#### 13.2.2 集計項目

| 区分 | 指標 |
|---|---|
| 実行数 | records_total, completed, failed, blocked |
| 検証 | schema_valid_records, schema_invalid_records |
| 対象 | singleRevision_count, revisionRange_count, workingTree_count |
| checklist | checklist_rules_total, checklist_fail_total, unknown_total, blocked_total |
| findings | findings_total, accepted, rejected, needs_investigation, deferred |
| 時間 | baseline_review_minutes_total, bob_review_minutes_total, human_triage_minutes_total |
| 効果 | estimated_minutes_saved, accepted_findings_per_hour |
| 運用 | retry_count, manual_gate_wait_minutes, capture_failures |

#### 13.2.3 Markdown summary

summary.md には以下を含める。

1. campaign 概要
2. 対象 revision 一覧
3. 実行結果サマリ
4. checklist 結果
5. findings 採否
6. 所要時間比較
7. 代表的な採用指摘
8. 失敗・保留・改善 backlog
9. 次フェーズへの判断材料

### 13.3 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| empty campaign | record なしで summary 生成。 | records_total 0、warning あり。 |
| valid records | 3 件の valid record を集計。 | 件数と時間が一致する。 |
| missing triage | triage.yaml がない record を含める。 | `triage_missing` として warning。 |
| invalid record | validation error record を含める。 | summary に invalid count が入る。 |
| markdown | summary.md を生成。 | 報告書として読める構成になる。 |

### 13.4 受け入れ条件

- summary.json は機械集計に使える。
- summary.md はプロジェクトリーダ向け報告に使える。
- invalid / triage missing を隠さず表示する。

## 14. P1-WR-01: workflow run metadata 連携

### 14.1 目的

`workflow-register` の run state と、Bazaar review record を紐付ける。これにより、どの workflow 実行がどの成果物を作ったか追跡できる。

### 14.2 設計

`bob-bazaar-review` 側は workflow-register API が利用できる場合のみ、best effort で次を取得する。

- current run id
- workflow id
- current step id
- started / finished timestamp
- step status
- retry count
- paused / held / failed 状態

取得できない場合は、record に `workflow.unavailable: true` を保存し、手動入力で補完できるようにする。

### 14.3 record 反映

```yaml
workflow:
  workflow_id: bazaar-project-rule-review
  run_id: wrun-20260704-001
  status: completed
  unavailable: false
  steps:
    - id: collect-context
      status: completed
    - id: load-rules
      status: completed
    - id: output-result
      status: completed
```

### 14.4 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| workflow available | mock workflow-register API から run 情報取得。 | record に run_id が入る。 |
| workflow unavailable | workflow-register 未導入。 | `unavailable: true` で record 作成は継続。 |
| failed step | failed step を含む run。 | record quality_gate または workflow status に反映。 |
| retry count | retry あり run。 | retry_count が metrics に反映。 |

### 14.5 受け入れ条件

- workflow-register がある場合は run と review record が紐付く。
- workflow-register がない場合でも direct command 実績作成を阻害しない。
- 失敗 run を成功扱いしない。

## 15. P1-UAT-01: Bazaar 実績作成 UAT script / checklist

### 15.1 目的

UAT 担当が、最小 3 ケース、推奨 6 ケースの Bazaar review 実績を作れるようにする。

### 15.2 推奨 UAT ケース

| ID | モード | 対象 | 目的 |
|---|---|---|---|
| P1-UAT-001 | singleRevision | 小規模 bugfix | 基本導線と schema 保存確認。 |
| P1-UAT-002 | singleRevision | UI / UX 改善 | 規約 checklist の該当 / 非該当判断確認。 |
| P1-UAT-003 | revisionRange | 複数 revision の機能追加 | range diff と checklist 件数整合確認。 |
| P1-UAT-004 | workingTreeSinceRevision | コミット前変更 | precommit review 導線確認。 |
| P1-UAT-005 | singleRevision | 既知不具合混入 revision | Bob 指摘の採用率確認。 |
| P1-UAT-006 | large diff | 大きい差分 | truncation、manual gate、運用限界確認。 |

### 15.3 UAT 手順

1. Phase 0 済み VSIX を導入する。
2. テスト対象 Bazaar workspace を開く。
3. `Bazaar レビュー: GUI を開く` を実行する。
4. `.bob` 未初期化の場合は初期化する。
5. campaign.yaml と targets.yaml を作る。
6. 対象ごとに review packet を生成する。
7. `bazaar-project-rule-review` workflow を実行する。
8. Bob が出力した JSON を capture する。
9. review-result JSON validation を実行する。
10. triage.yaml を生成し、人間が採否を記入する。
11. record.yaml を作成・検証する。
12. campaign summary を生成する。
13. 不具合と改善要望を backlog 化する。

### 15.4 合格基準

- 最小 3 件の review record が作成される。
- すべての record が review-result JSON / Markdown を参照している。
- すべての review-result が schema validation 済みである。
- すべての record に human triage がある。
- summary.md に所要時間、採用指摘、棄却指摘、保留が表示される。
- Developer Tools Console に未処理例外が残らない。

## 16. P1-OPS-02: 実績報告テンプレート

### 16.1 目的

Phase 1 終了時に、対象部門へ「Bob を使った Bazaar レビューがどの程度有効か」を説明できる資料を作る。

### 16.2 報告テンプレート構成

```text
# IBM Bob Bazaar レビュー実績報告

## 1. 対象
- project
- repository
- campaign_id
- 実施期間

## 2. 実施件数
- review records
- revision mode breakdown

## 3. 品質結果
- checklist pass/fail/unknown/blocked
- findings accepted/rejected/needs_investigation

## 4. 効率結果
- baseline review minutes
- Bob review minutes
- human triage minutes
- estimated saved minutes

## 5. 代表的な採用指摘

## 6. 棄却・誤検出の傾向

## 7. 運用課題

## 8. Phase 2 への提案
```

### 16.3 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| summary to report | summary.json から報告 Markdown を作る。 | テンプレート各章が埋まる。 |
| missing metrics | baseline 時間なし。 | 未計測として表示し、計算で落ちない。 |
| privacy check | repository path などを redaction する設定。 | 外部共有版で path が伏せられる。 |

### 16.4 受け入れ条件

- 部門報告に使える Markdown を出せる。
- 社内共有版と外部共有不可情報を区別できる。
- Phase 2 の Git 対応判断に使える指標が含まれる。

## 17. テスト戦略

### 17.1 テスト層

| 層 | 目的 | 対象 |
|---|---|---|
| unit | record / triage / summary の pure logic を検証する。 | `src/records/*` |
| command integration | VS Code command と workspace file I/O を検証する。 | initCampaign, createRecord, createTriage, generateSummary |
| workflow integration | `bazaar-project-rule-review` と record 生成の連携を検証する。 | workflow-register + bob-bazaar-review |
| real-machine UAT | Bazaar CLI、Bob IDE、MCP、GUI を含めた実機確認。 | UAT workspace |

### 17.2 既存 real-machine test との関係

既存の実機テスト仕様では、起動、project rules 初期化、MCP 設定、GUI、direct command、capture、validation、End-to-End が定義されている。Phase 1 はその上に、record / triage / summary の観点を追加する。

追加 testcase:

| ID | 目的 |
|---|---|
| BZR-RT-036 | campaign 初期化で `.bob-review-records` が作られる。 |
| BZR-RT-037 | GUI で packet artifact を campaign record 配下に保存できる。 |
| BZR-RT-038 | capture 済み review-result から record.yaml を生成できる。 |
| BZR-RT-039 | review-result から triage.yaml を生成し、人間が編集できる。 |
| BZR-RT-040 | triage validation error を検出できる。 |
| BZR-RT-041 | 複数 record から campaign summary を生成できる。 |
| BZR-RT-042 | workflow run metadata と record が紐付く。 |
| BZR-RT-043 | campaign summary から実績報告 Markdown を作成できる。 |

### 17.3 共通 negative tests

| 観点 | 異常入力 | 期待結果 |
|---|---|---|
| campaign | campaign_id なし | validation error |
| target | revision と base/target が同時指定 | mode と整合しなければ error |
| record | review-result path が存在しない | record validation error |
| record | workspace 外 path | 拒否 |
| triage | unknown finding_id | validation error |
| triage | summary 件数不一致 | validation error |
| summary | invalid record 混入 | invalid count に入り、成功件数へ混ぜない |
| privacy | external report で absolute path 表示 | redaction または warning |

## 18. CODEX への作業指示テンプレート

```text
対象: <P1 work package ID>
目的: <1文で目的>
変更対象:
- <path>

制約:
- 既存 review-result schema と保存先を壊さない。
- `.bob/review/results` の既存成果物を上書きしない。
- `.bob-review-records` 以外へ実績 record を書かない。
- workspace 外 path を許可しない。
- Bob 指摘の最終判断は human triage に残す。
- README/docs とテストを同時に更新する。

実装内容:
1. <実装ステップ>
2. <実装ステップ>
3. <実装ステップ>

テスト:
- npm run compile
- npm run test
- 追加 unit test: <list>
- 追加 UAT testcase: <list>

完了条件:
- <受け入れ条件>
```

## 19. 推奨実装順

Phase 1 は次の順序で進める。

1. `P1-OPS-01`: campaign / target / record / triage のテンプレートを確定する。
2. `P1-BBR-01`: review record schema / writer を実装する。
3. `P1-BBR-02`: review packet artifact 化を実装する。
4. `P1-BBR-03`: human triage helper を実装する。
5. `P1-BBR-04`: campaign summary generator を実装する。
6. `P1-WR-01`: workflow run metadata 連携を追加する。
7. `P1-UAT-01`: UAT checklist を完成させる。
8. `P1-OPS-02`: 実績報告テンプレートを追加する。

最初にテンプレートを固める理由は、record / triage / summary の schema を実装途中で揺らさないためである。

## 20. CODEX レビュー観点

| 観点 | 確認内容 |
|---|---|
| traceability | target -> packet -> review-result -> triage -> summary が追跡できるか。 |
| compatibility | 既存 command、workflow、review-result 保存先を壊していないか。 |
| human-in-the-loop | Bob 指摘を人間が採否判断する導線があるか。 |
| metrics integrity | summary が検証済み record だけを正しく集計しているか。 |
| safety | workspace 外 path、Bazaar 書き込み、MCP 破壊的操作を追加していないか。 |
| privacy | 実案件 path、担当者名、差分内容を共有範囲に応じて扱えるか。 |
| operability | UAT 担当が手順どおり実行でき、失敗時に再開・記録できるか。 |

## 21. Phase 1 で実装しないこと

以下は Phase 1 の範囲外とする。

- Git レビューへの対応
- code consistency review との統合
- 自動修正 patch 生成
- Bazaar commit / merge / revert などの書き込み操作
- 全 7 プロジェクトへの本格展開
- AI 指摘の自動採用
- 外部共有用の完全匿名化 export

## 22. 参照資料

- `docs/phase0-foundation-stabilization-codex-plan-ja.md`
- `extensions/bob-bazaar-review/README.md`
- `extensions/bob-bazaar-review/docs/real-machine-test-spec-ja.md`
- `.bob/workflows/bazaar-project-rule-review/WORKFLOW.md`
- `extensions/workflow-register/README.md`
- `docs/workflow-authoring-guide-ja.md`

## 23. 推奨コミット

```text
docs: add phase 1 Bazaar review record Codex plan
```
