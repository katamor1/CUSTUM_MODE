# Phase 4 7プロジェクト展開に向けたテンプレートカスタマイズ評価・育成企画書

- 対象リポジトリ: `katamor1/bob_builtin_analyze`
- 対象ディレクトリ: `extensions/`, `.bob/`, `docs/`
- 主対象拡張機能: `workflow-register`
- 関連拡張機能: `bob-bazaar-review`, `bob-code-consistency-review`, `IBM.bob-code`
- 関連計画: `ibm-bob-extensions-next-development-plan-ja.md` Phase 4: 7プロジェクト展開
- 作成日: 2026-07-04
- 想定読者: プロジェクトリーダ、SE、ワークフロー設計者、UAT 担当、拡張機能開発者、CODEX 実装エージェント

## 1. 目的

本書は、Phase 4: 7プロジェクト展開にあたり、`workflow-register` の既存ワークフロー設計・編集機能と、現在の GUI 設計状況を「基準テンプレートを各プロジェクトが安全にカスタマイズする」という観点で評価し、必要な育成・支援・追加開発を企画するものである。

Phase 4 では、中央チームが作ったワークフローを 7 プロジェクトへ単純配布するだけでは不十分である。各プロジェクトは、製品特性、VCS、開発言語、文書構成、レビュー規約、体制、既存プロセスが異なるため、標準テンプレートを自分たちの現場に合わせて調整する必要がある。

そのため、本書では次を明確にする。

1. 現状の `workflow-register` はテンプレートカスタマイズ基盤としてどこまで使えるか。
2. GUI ファースト設計は各プロジェクトのカスタマイズ作業をどこまで支援できるか。
3. Phase 4 で不足する機能・運用・教育は何か。
4. 各プロジェクトが自走できるようにする育成プログラムはどう設計すべきか。
5. CODEX に実装・ドキュメント化させる work package は何か。

## 2. 結論

現状の `workflow-register` は、Phase 4 の土台としては有効である。`.bob/workflows/*/WORKFLOW.md` の読み込み、schema validation、テンプレート作成、GUI Builder、実行、再開、診断、step review、AI 補助が既にあり、ワークフローを設計・編集・運用する最低限の基盤は揃っている。

ただし、7プロジェクト展開で各プロジェクトが標準テンプレートを安全にカスタマイズするには、現状機能だけでは不足がある。特に不足しているのは、次の 6 点である。

1. 標準テンプレートとプロジェクト固有差分を分離・比較する仕組み。
2. GUI 上で「どこを変更してよいか」を制限・案内する Template Customization Studio。
3. カスタマイズ後の互換性、guardrail、必須成果物、命名、成果物 path を評価する readiness check。
4. 7プロジェクトのカスタマイズ状況を横断して確認する rollout dashboard。
5. テンプレート更新時に各プロジェクトへ安全に追従させる migration / diff / merge 支援。
6. PL / SE / workflow owner / UAT 担当を役割別に育てる教育・認定・相談体制。

したがって、Phase 4 では「機能追加」と同じくらい「育成」が重要である。推奨方針は、標準テンプレートを中央管理し、各プロジェクトは GUI 上で許可された範囲をカスタマイズし、readiness check に合格したものだけを UAT / 実案件へ展開する形である。

## 3. 評価対象

### 3.1 評価する既存機能

| 対象 | 評価観点 |
|---|---|
| `workflow-register` | workflow 作成、GUI Builder、validation、step 定義、guardrails、run state、診断、AI 補助。 |
| `bob-bazaar-review` | Bazaar review GUI、project rules、review-result capture、Phase 1 実績作成との接続。 |
| `bob-code-consistency-review` | review-input wizard、traceability prep、review-package、Bob output validation、human triage。 |
| GUIファースト設計 | Bob Operation Hub、Workflow Catalog、Run Monitor、Result Capture、Human Triage、Report Center。 |
| Phase 0〜3 計画 | 基盤安定化、実績作成、Git/複数言語整合、工程別 workflow catalog。 |

### 3.2 Phase 4 で想定するカスタマイズ対象

| カスタマイズ対象 | 例 |
|---|---|
| workflow 表示名・説明 | プロジェクト名、製品名、工程名に合わせる。 |
| 入力項目 | revision、ticket、要求書、設計書、対象言語、review focus。 |
| 必須ファイル | プロジェクト固有の要求書、設計書、台帳、規約ファイル。 |
| checklist | コーディング規約、設計レビュー観点、テスト観点。 |
| prompt body | 製品用語、禁止事項、レビュー観点、出力形式。 |
| guardrails | 許可 command、MCP、成果物保存先。 |
| artifacts | review-result、triage、summary、handoff の保存先。 |
| workflow step | 手動確認の追加、不要 step の非表示、レビュー停止位置。 |
| metrics | プロジェクトで見る件数、所要時間、採用指摘、差戻し。 |

## 4. 現状評価

### 4.1 `workflow-register` の強み

`workflow-register` は、Phase 4 のカスタマイズ基盤として次の強みを持つ。

| 観点 | 評価 | 理由 |
|---|---|---|
| workflow 配置規約 | 良い | `.bob/workflows/*/WORKFLOW.md` という明確な配置規約がある。 |
| schema version | 良い | `schemaVersion: workflow-register/v1` を推奨しており、標準化しやすい。 |
| GUI Builder | 良い | テンプレートまたは GUI Builder から新規 workflow を作成できる。 |
| validation | 良い | YAML front matter、必須項目、step、state 参照、artifact 参照などの検証がある。 |
| step model | 良い | `agent` / `command` / `manual` / `result` の基本 step が揃っている。 |
| stepReview | 良い | AI / command 結果を人間が確認してから次へ進められる。 |
| run state | 良い | `.bob/workflows/runs/<runId>/run.json` で再開・診断しやすい。 |
| external extension 連携 | 良い | action provider / result sink により Bazaar review や code consistency review と接続できる。 |

### 4.2 `workflow-register` の不足

7プロジェクト展開の「基準テンプレートからの安全なカスタマイズ」観点では、次が不足している。

| 不足 | 影響 | 必要な対応 |
|---|---|---|
| 標準テンプレートの version 管理 | 各プロジェクトが古いテンプレートを使い続けても分からない。 | `templateId`, `templateVersion`, `baseTemplateHash` を workflow metadata に持たせる。 |
| 標準差分の可視化 | どこを変更したのかレビューしにくい。 | base template と project workflow の diff viewer を用意する。 |
| 変更許可範囲の制御 | project が guardrail や result sink を壊す可能性。 | customizable fields を定義し、GUI で安全領域だけ編集可能にする。 |
| カスタマイズ readiness | 使える状態か人手で判断しがち。 | readiness check と score を追加する。 |
| 7プロジェクト横断状況 | 展開状況、未対応、失敗が見えない。 | rollout dashboard と project profile を作る。 |
| テンプレート migration | 標準テンプレート更新時に差分適用が難しい。 | template update assistant / migration guide を追加する。 |
| 育成導線 | GUI Builder があっても、何をどう変えるべきか分からない。 | 役割別 training、演習、認定、レビュー会を設計する。 |

### 4.3 GUI 設計状況の評価

直近の GUI ファースト企画では、Bob Operation Hub、Setup Checklist、Workflow Catalog、Run Monitor、Result Capture、Human Triage、Report Center などが提案されている。これは Phase 4 展開に必要な方向性と合っている。

しかし、Phase 4 の観点では、さらに `Template Customization Studio` が必要である。既存 GUI 案は「実行しやすくする」ことに強い一方で、「標準テンプレートをプロジェクト用に安全に変える」体験はまだ十分に具体化されていない。

必要な追加画面は次の通りである。

| 画面 | 目的 |
|---|---|
| Template Library | 標準テンプレート一覧、version、対象工程、適用条件を表示する。 |
| Project Profile Editor | プロジェクト名、VCS、言語、文書構成、規約、保存先を登録する。 |
| Template Customization Studio | 許可された項目だけをボタン・選択肢・入力欄で編集する。 |
| Template Diff Viewer | 標準テンプレートと project customized workflow の差分を表示する。 |
| Readiness Check | カスタマイズ後の validation、guardrail、成果物、UAT readiness を判定する。 |
| Rollout Dashboard | 7プロジェクトの導入状況、テンプレート version、UAT 結果を一覧化する。 |

## 5. Phase 4 のテンプレートカスタマイズ運用モデル

### 5.1 標準テンプレートとプロジェクト差分の分離

Phase 4 では、標準テンプレートを中央管理し、各プロジェクトは project profile と customization patch を持つ方式を推奨する。

```text
.bob/
  template-library/
    standard/
      process-code-doc-investigation/
        WORKFLOW.md
        template.yaml
      process-code-precheck/
        WORKFLOW.md
        template.yaml
  project-profile.yaml
  project-customizations/
    process-code-precheck.customization.yaml
  workflows/
    process-code-precheck/
      WORKFLOW.md
```

### 5.2 project-profile.yaml

プロジェクト固有情報は workflow 本体へ直接埋め込みすぎず、profile に寄せる。

```yaml
schema_version: bob-project-profile/v1
project_id: product-a
project_name: Product A 保守開発
vcs:
  primary: git
  secondary: bazaar
languages:
  - c_cpp
  - csharp
document_layout:
  requirements: docs/requirements
  external_spec: docs/external-spec
  internal_spec: docs/internal-spec
  test_spec: docs/test-spec
review_policy:
  checklist_root: .bob/process/checklists
  default_severity: warning
workflow_preferences:
  require_human_gate: true
  default_step_review: true
  output_root: .bob-process-runs
```

### 5.3 customization.yaml

各プロジェクトが変更してよい内容だけを customization として表す。

```yaml
schema_version: bob-workflow-customization/v1
template_id: process-code-precheck
template_version: 1.0.0
project_id: product-a
customize:
  title: Product A コード整合プレレビュー
  inputs:
    default_vcs: git
    default_review_focus:
      - requirement-code-consistency
      - design-code-consistency
      - test-gap
  checklist:
    path: .bob/process/checklists/product-a-code-review.yaml
  prompts:
    project_terms:
      - 製品固有用語A
      - 制御周期
  artifacts:
    output_root: .bob-process-runs
```

### 5.4 generated WORKFLOW.md

実行用の `.bob/workflows/<name>/WORKFLOW.md` は、template + profile + customization から生成する。直接編集も完全禁止にはしないが、標準導線では GUI 生成を推奨する。

## 6. 必要な機能企画

### 6.1 Template Library

目的: 各プロジェクトが使える標準テンプレートを一覧から選べるようにする。

機能:

- 工程別 filter
- 対象 VCS / 言語 filter
- template version 表示
- 推奨プロジェクトタイプ表示
- サンプル成果物 preview
- `このテンプレートを採用` ボタン

### 6.2 Project Profile Editor

目的: カスタマイズ前に、プロジェクト固有情報を GUI で登録する。

入力欄:

- project id / name
- VCS: Git / Bazaar
- languages: C/C++ / C# / Java / SQL
- docs layout
- checklist path
- output root
- human gate policy
- UAT owner

### 6.3 Template Customization Studio

目的: 標準テンプレートを壊さず、許可された範囲だけ編集する。

編集 UI:

| 項目 | UI |
|---|---|
| 表示名 | text input |
| 対象工程 | select |
| 入力項目 | checkbox / form builder |
| 必須文書 | folder picker / file picker |
| review focus | checkbox |
| checklist | dropdown / file picker |
| prompt 補足 | textarea with preview |
| human gate | toggle |
| step review | toggle |
| artifacts | output path picker |

編集不可にすべき項目:

- 危険 command / guardrail の解除
- workspace 外 file sink
- Bob の最終承認化
- VCS 書き込み command
- result sink type の任意追加

### 6.4 Readiness Check

目的: カスタマイズ済み workflow がプロジェクトで使える状態か判定する。

チェック項目:

| チェック | 内容 |
|---|---|
| schema | `workflow-register/v1` と customization schema が valid。 |
| naming | workflow name、folder name、project id が規約に合う。 |
| required files | checklist、schema、docs folder が存在。 |
| guardrails | allowedCommands / allowedCommandIds が安全。 |
| artifacts | 保存先が workspace 内で、衝突しない。 |
| human gate | 必須工程に manual / stepReview がある。 |
| template version | 標準テンプレートの最新互換 version か。 |
| UAT | smoke test / dry run 済みか。 |

出力:

```text
.bob/template-readiness/<project_id>/<workflow_name>-readiness.md
.bob/template-readiness/<project_id>/<workflow_name>-readiness.json
```

### 6.5 Rollout Dashboard

目的: 7プロジェクト展開状況を PL / 推進チームが確認できるようにする。

表示項目:

- project id
- template version
- customized workflows count
- readiness score
- UAT status
- last run
- failed checks
- owner
- next action

### 6.6 Template Update Assistant

目的: 標準テンプレート更新時に、各プロジェクトのカスタマイズへ安全に反映する。

機能:

- base version と latest version の比較
- project customization の影響確認
- 破壊的変更 warning
- migration guide 表示
- `差分を適用`, `保留`, `手動確認へ回す` ボタン

## 7. 現状評価スコア

| 評価項目 | 現状スコア | コメント |
|---|---:|---|
| workflow 作成 | 4 / 5 | テンプレート作成と GUI Builder がある。 |
| workflow 編集 | 3 / 5 | 編集は可能だが、標準差分や許可範囲管理が弱い。 |
| workflow validation | 4 / 5 | schema / step / state / artifact 検証は強い。Phase 4 readiness には追加チェックが必要。 |
| GUI 操作 | 3 / 5 | GUI 化の方向性はあるが、Template Customization Studio は未整備。 |
| プロジェクト固有化 | 2 / 5 | project profile / customization patch / template version 管理が必要。 |
| 7プロジェクト横断管理 | 1 / 5 | rollout dashboard が必要。 |
| 育成しやすさ | 2 / 5 | ガイドはあるが、役割別演習・認定・相談会が必要。 |
| 安全な自走 | 2 / 5 | guardrail や path 境界はあるが、カスタマイズ時の安全 UI が必要。 |

総評: **基盤はあるが、Phase 4 の主役である「各プロジェクトが標準テンプレートを安全にカスタマイズして自走する」には、GUI・テンプレート統制・育成の追加が必要である。**

## 8. 育成企画

### 8.1 育成の目的

7プロジェクト展開では、中央チームがすべての workflow を作り続けると普及が止まる。各プロジェクトが、標準テンプレートを理解し、自分たちの規約・文書・工程に合わせて安全にカスタマイズできる状態を作る。

育成のゴール:

1. 各プロジェクトに 1〜2 名の `Workflow Customizer` を置く。
2. 各プロジェクトの PL / SE が readiness 結果を読める。
3. UAT 担当が GUI で workflow を実行し、結果を記録できる。
4. カスタマイズ差分を中央レビューへ提出できる。
5. テンプレート更新時に自プロジェクトへの影響を判断できる。

### 8.2 役割別育成トラック

| トラック | 対象 | 到達目標 | 所要目安 |
|---|---|---|---|
| T1: Operator | プログラマ、テスタ、UAT 担当 | GUI から workflow を実行し、結果を保存・triage できる。 | 2時間 |
| T2: Reviewer | SE、レビュー担当 | Bob 出力、evidence、triage、readiness 結果を評価できる。 | 3時間 |
| T3: Workflow Customizer | 各プロジェクト代表 SE | 標準テンプレートを project profile と GUI でカスタマイズできる。 | 1日 |
| T4: Project Owner | PL、PM | rollout dashboard、metrics、UAT 結果を見て展開判断できる。 | 2時間 |
| T5: Workflow Maintainer | 中央推進チーム、拡張機能担当 | 標準テンプレート更新、migration、互換性レビューができる。 | 2日 |

### 8.3 カリキュラム

#### Module 1: Bob ワークフロー基礎

内容:

- workflow とは何か
- `agent` / `command` / `manual` / `result` step
- human gate の意味
- 成果物と evidence
- してよいこと / してはいけないこと

演習:

- 標準 workflow を GUI で実行する。
- Run Monitor で step を確認する。
- 成果物を開く。

#### Module 2: 標準テンプレートの読み方

内容:

- template id / version
- 入力項目
- preflight
- guardrails
- artifacts
- checklist
- prompt 補足

演習:

- `process-code-precheck` のテンプレートを表示する。
- どの項目がプロジェクト固有か分類する。

#### Module 3: Project Profile 作成

内容:

- VCS / 言語 / 文書構成 / checklist path の登録
- プロジェクト固有用語
- output root
- human gate policy

演習:

- サンプルプロジェクトの `project-profile.yaml` を GUI で作る。
- readiness check を実行する。

#### Module 4: テンプレートカスタマイズ

内容:

- 変更してよい項目
- 変更してはいけない項目
- checklist 差し替え
- prompt 補足
- 必須文書の指定
- stepReview / manual gate

演習:

- 標準 `process-unit-test-design` を自プロジェクト向けに変更する。
- Template Diff Viewer で差分を見る。
- readiness check を通す。

#### Module 5: UAT と実績記録

内容:

- UAT ケースの選び方
- review record / process record
- human triage
- summary / metrics
- 不具合・改善要望の出し方

演習:

- 1 workflow を dry run する。
- triage を保存する。
- summary を生成する。

#### Module 6: テンプレート更新と保守

内容:

- template version update
- migration check
- project customization への影響確認
- 中央レビューへの差分提出
- rollback

演習:

- 古いテンプレートから新テンプレートへの migration を試す。
- conflict を手動判断する。

### 8.4 認定基準

| 認定 | 条件 |
|---|---|
| Operator Ready | GUI で標準 workflow を実行し、成果物と triage を保存できる。 |
| Reviewer Ready | review-result、evidence、triage、readiness report を説明できる。 |
| Customizer Ready | project profile と customization を作成し、readiness check を通せる。 |
| Maintainer Ready | 標準テンプレート更新、migration、互換性レビューを実施できる。 |

各プロジェクトは Phase 4 UAT 前に、少なくとも以下を満たす。

- PL または SE 1 名: Reviewer Ready
- SE 1 名: Customizer Ready
- UAT 担当 1 名: Operator Ready

## 9. 育成運用計画

### 9.1 Train-the-Trainer

中央チームが先に Maintainer / Customizer を育成し、その後、各プロジェクト代表者へ展開する。

```text
Week 1: 中央チーム向け Maintainer training
Week 2: 7プロジェクト代表 SE 向け Customizer training
Week 3: 各プロジェクト内 Operator / Reviewer training
Week 4: プロジェクト別 UAT clinic
```

### 9.2 ハンズオン sandbox

各プロジェクトへ、壊してもよい sandbox workspace を配る。

```text
sandbox-product-template/
  .bob/
    template-library/
    workflows/
    process/
  docs/
    requirements/
    external-spec/
    internal-spec/
    test-spec/
  src/
  tests/
```

演習は必ず sandbox で行い、実案件 workspace への適用は readiness check 合格後にする。

### 9.3 相談会とレビュー会

| 会 | 目的 | 頻度 |
|---|---|---|
| Customization Clinic | project profile / workflow customization の相談 | 週1 |
| Readiness Review | UAT 前の readiness report 確認 | プロジェクトごと |
| Template Owner Review | 標準テンプレートへの改善提案レビュー | 隔週 |
| Lessons Learned | 7プロジェクト共通課題の共有 | 月1 |

## 10. Phase 4 追加 work package

| ID | 対象 | 名称 | 優先度 | 主な成果物 |
|---|---|---|---:|---|
| P4-TPL-01 | docs/templates | 標準テンプレートライブラリ定義 | 1 | template metadata、version policy、catalog docs |
| P4-TPL-02 | workflow-register | project-profile schema / validator | 1 | `bob-project-profile/v1` schema、GUI 入力、validation tests |
| P4-TPL-03 | workflow-register | customization schema / generator | 1 | customization.yaml、template merge、generated WORKFLOW.md |
| P4-GUI-01 | GUI | Template Library UI | 1 | template list、filter、採用ボタン |
| P4-GUI-02 | GUI | Template Customization Studio | 1 | 安全編集 UI、diff viewer、保存 |
| P4-GUI-03 | GUI | Readiness Check UI | 1 | readiness score、修正導線、report 保存 |
| P4-GUI-04 | GUI | Rollout Dashboard | 2 | 7プロジェクト導入状況、version、UAT status |
| P4-MIG-01 | workflow-register | Template Update Assistant | 2 | version diff、migration、conflict 表示 |
| P4-EDU-01 | docs/training | 役割別育成教材 | 1 | T1〜T5 教材、演習、FAQ |
| P4-EDU-02 | docs/uat | sandbox / hands-on package | 1 | sandbox workspace、演習シナリオ |
| P4-OPS-01 | docs/ops | Phase 4 rollout guide | 1 | 展開手順、責任分担、認定条件、support flow |

## 11. CODEX 実装指示テンプレート

```text
対象: <P4 work package ID>
目的: <1文で目的>
変更対象:
- <path>

制約:
- 既存 workflow name / command ID / provider ID を破壊的に変更しない。
- 標準テンプレートと project customization を分離する。
- project workflow 生成時は readiness check を通す。
- workspace 外 path を許可しない。
- guardrails / result sink / command allowlist を GUI で危険に変更できないようにする。
- GUI は既存 validation / service を呼び、処理本体を重複実装しない。
- README/docs、training、UAT 手順を同時に更新する。

実装内容:
1. <実装ステップ>
2. <実装ステップ>
3. <実装ステップ>

テスト:
- npm run compile
- npm run test
- 追加 unit test: <list>
- 追加 GUI interaction test: <list>
- 追加 readiness fixture: <list>
- 追加 UAT testcase: <list>

完了条件:
- <受け入れ条件>
```

## 12. 推奨実装順

1. `P4-TPL-01`: 標準テンプレートライブラリ定義
2. `P4-TPL-02`: project-profile schema / validator
3. `P4-TPL-03`: customization schema / generator
4. `P4-GUI-01`: Template Library UI
5. `P4-GUI-02`: Template Customization Studio
6. `P4-GUI-03`: Readiness Check UI
7. `P4-EDU-01`: 役割別育成教材
8. `P4-EDU-02`: sandbox / hands-on package
9. `P4-OPS-01`: Phase 4 rollout guide
10. `P4-GUI-04`: Rollout Dashboard
11. `P4-MIG-01`: Template Update Assistant

最初にテンプレート metadata、project profile、customization schema を固める理由は、GUI と育成を先に作っても、カスタマイズの source of truth が定まらなければ、7プロジェクトで差分管理が破綻するためである。

## 13. テスト計画

### 13.1 unit test

| テスト | 内容 | 期待結果 |
|---|---|---|
| profile valid | 正常な project-profile。 | validation success。 |
| profile invalid language | 未対応 language。 | validation error。 |
| customization valid | 許可 field のみ変更。 | merge success。 |
| customization forbidden | guardrail 解除を指定。 | validation error。 |
| template version mismatch | 古い baseTemplateHash。 | warning / migration required。 |

### 13.2 GUI interaction test

| テスト | 内容 | 期待結果 |
|---|---|---|
| template select | Template Library で標準 template を選ぶ。 | Project Profile 入力へ進む。 |
| profile edit | VCS / language / docs layout を入力。 | profile.yaml が生成される。 |
| safe customization | checklist と表示名だけ変更。 | generated WORKFLOW.md が作成される。 |
| unsafe customization | workspace 外 output path を選ぶ。 | 保存不可。 |
| readiness | readiness check 実行。 | score と修正項目が表示される。 |

### 13.3 UAT

| ID | ケース | 合格条件 |
|---|---|---|
| P4-UAT-001 | 新規プロジェクトが標準テンプレートを採用 | GUI だけで template 採用と profile 作成が完了。 |
| P4-UAT-002 | project 固有 checklist へ差し替え | readiness check が pass。 |
| P4-UAT-003 | unsafe customization を試す | GUI / validation が拒否。 |
| P4-UAT-004 | workflow dry run | Run Monitor で完了し、record が残る。 |
| P4-UAT-005 | rollout dashboard | 7プロジェクトの状態が一覧表示される。 |
| P4-UAT-006 | template version update | 影響確認と migration guide が表示される。 |

## 14. Phase 4 の成功指標

| 指標 | 目標 |
|---|---|
| project profile 作成完了 | 7プロジェクト中 7。 |
| 標準テンプレート採用 | 各プロジェクト 3 workflow 以上。 |
| readiness pass | UAT 対象 workflow の 90% 以上。 |
| Customizer Ready 人数 | 各プロジェクト 1名以上。 |
| Operator Ready 人数 | 各プロジェクト 2名以上。 |
| GUI 経由カスタマイズ率 | 80% 以上。 |
| unsafe customization 検出率 | negative test で 100%。 |
| 中央チーム差戻し件数 | 初回より 2回目以降で減少。 |

## 15. リスクと対策

| リスク | 内容 | 対策 |
|---|---|---|
| 各プロジェクトが workflow を直接編集して標準から逸脱する | 保守不能になる。 | GUI 標準導線、diff viewer、readiness check、中央レビュー。 |
| 中央チームに依頼が集中する | 普及速度が落ちる。 | Customizer Ready 制度と clinic。 |
| GUI が未整備で結局 YAML 編集になる | 非コマンドユーザーが離脱する。 | Template Customization Studio を Phase 4 前半に実装。 |
| テンプレート更新が各プロジェクトへ反映されない | 古い手順が残る。 | Template Update Assistant と rollout dashboard。 |
| project 固有化しすぎる | 標準比較ができない。 | customization schema で変更範囲を制御。 |
| 教育が一度きりで定着しない | 実運用で使われない。 | sandbox、演習、認定、月次 lessons learned。 |

## 16. 参照資料

- `extensions/workflow-register/README.md`
- `docs/gui-first-operation-design-plan-ja.md`
- `docs/phase0-foundation-stabilization-codex-plan-ja.md`
- `docs/phase1-bazaar-review-record-codex-plan-ja.md`
- `docs/phase2-git-multilanguage-consistency-prereview-codex-plan-ja.md`
- `docs/phase3-process-bob-workflows-codex-plan-ja.md`
- `extensions/bob-bazaar-review/README.md`
- `extensions/bob-code-consistency-review/README.md`

## 17. 推奨コミット

```text
docs: add phase 4 template customization readiness and training plan
```
