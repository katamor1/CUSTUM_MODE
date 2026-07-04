# IBM Bob extensions 次期開発計画企画書

- 対象リポジトリ: `katamor1/bob_builtin_analyze`
- 対象コミット: `c77062af6541daf3e056ebba712dc4d131d610b5`
- 対象ディレクトリ: `extensions/`
- 対象拡張機能:
  - `workflow-register`
  - `bob-bazaar-review`
  - `bob-code-consistency-review`
- 作成日: 2026-07-04
- 目的: IBM Bob を使用したソフトウェア開発プロジェクト運営の効率化と品質向上を、次期開発段階として計画化する。

---

## 1. エグゼクティブサマリー

次期開発では、3つの拡張機能を「個別の便利機能」ではなく、対象部門の7プロジェクトで共通利用できる **Bob 開発運営基盤** として整備する。

現在の経緯は、まず `bob-bazaar-review` により Bazaar 差分を Bob レビューへ投入し、プロジェクト規約に照らしたレビュー結果を実績として残す必要があった。そのユーザー運用テストを成立させるため、途中で `workflow-register` が急遽必要になり、ワークフロー登録・実行・再開・診断・ステップ制御を担う基盤として追加開発された。

次期開発段階では、この暫定的な追加開発を本格運用に耐える形へ引き上げる。具体的には、以下の順で進める。

1. `workflow-register` を共通ワークフロー実行基盤として安定化する。
2. `bob-bazaar-review` を Bazaar 保守開発プロジェクトのレビュー実績作成ツールとして運用標準化する。
3. `bob-code-consistency-review` を、コード変更と要求・設計・テスト仕様の整合プレレビュー基盤として段階展開する。
4. Git / Bazaar、C/C++、C#/.NET/ASP、Java、SQL を含む対象プロジェクト群に対し、工程別の Bob 接続ワークフローを整備する。
5. 7プロジェクト横断で、利用実績、レビュー品質、手戻り削減、文書・コード整合性を測定できる運用へ移行する。

本企画では、次期開発を **Phase 0: 安定化**、**Phase 1: Bazaar レビュー実績化**、**Phase 2: Git / 複数言語展開**、**Phase 3: 工程別ワークフロー整備**、**Phase 4: 組織展開・効果測定** に分ける。

---

## 2. 現状認識

### 2.1 3拡張機能の位置づけ

`extensions/README.md` 上では、3拡張機能は次の関係で整理されている。

```text
IBM.bob-code
  └─ workflow-register
       ├─ bob-bazaar-review
       └─ bob-code-consistency-review
```

| 拡張機能 | 現在の主な役割 | 次期開発での位置づけ |
|---|---|---|
| `workflow-register` | `.bob/workflows/*/WORKFLOW.md` を読み込み、Bob のワークフローとして登録・実行する。手動ステップ、コマンドステップ、エージェントステップ、結果ステップ、実行状態保存、再開、診断、AI 補助、GUI Builder を提供する。 | 全プロジェクト共通の Bob ワークフロー実行基盤。 |
| `bob-bazaar-review` | Bazaar 差分、revision / range、working tree 差分を収集し、Bob レビュー用 packet を作成する。プロジェクト規約、review-result JSON 検証、Markdown 成果物保存、読み取り専用 Bazaar MCP を提供する。 | Bazaar プロジェクト向けのレビュー実績作成・規約レビュー運用基盤。 |
| `bob-code-consistency-review` | コード変更と要求書・基本設計書・詳細設計書・テスト仕様書の整合性を、正式レビュー前に Bob でプレレビューする。review-package、traceability sidecar、Bob 出力検証、人間 triage を提供する。 | 工程間整合性レビュー、設計・テスト漏れ検出、正式レビュー前品質ゲートの基盤。 |

### 2.2 現在の強み

現状の実装には、次期開発へ進める上で重要な土台がある。

- Bob 本体を変更せず、ローカル VS Code 拡張として段階導入できる。
- `workflow-register` により、Bob への依頼手順を毎回チャットで再説明せず、再利用可能なワークフローにできる。
- `bob-bazaar-review` により、Bazaar の revision / range / working tree 差分をレビュー用 packet に変換できる。
- `bob-code-consistency-review` により、コード差分だけでなく要求・設計・テスト仕様の根拠をまとめた review-package を作成できる。
- Bob 出力を JSON / YAML schema で検証し、人間確認用成果物へ落とす方向性がすでにある。
- AI の判断結果をそのまま正式判定にせず、人間承認や triage を挟む設計がある。

### 2.3 現在の課題

一方、急遽追加された要素を含むため、次期開発では以下を解消する必要がある。

| 課題 | 内容 | 次期開発での対応方針 |
|---|---|---|
| 基盤品質 | `workflow-register` が急ぎ追加されたため、セキュリティ、運用ログ、診断、権限制御、失敗時復旧の基準を明確にする必要がある。 | Phase 0 で安定化・品質ゲート化する。 |
| 運用標準 | Bazaar レビュー実績作成の手順が個人依存になる恐れがある。 | 標準ワークフロー、チェックリスト、成果物命名、保存先、レビュー結果の判定基準を定義する。 |
| 対象範囲 | 現在は Bazaar レビューが先行しているが、対象プロジェクトには Git もある。 | Git 対応を `bob-code-consistency-review` と共通差分抽出層で拡張する。 |
| 言語対応 | 対象言語が C/C++、C#、Java、SQL と広い。 | 汎用レビュー観点と、言語別アナライザ / テンプレートを分ける。 |
| 工程展開 | Bob 接続可能工程が多く、いきなり全工程へ広げると運用が散る。 | 優先工程から段階導入する。最初は調査、レビュー、設計、単体テスト設計、整合プレレビューに絞る。 |
| 効果測定 | 実績作成が目的だが、件数だけでは品質向上を示しにくい。 | KPI を定義し、レビュー指摘、手戻り、テスト観点追加、文書更新漏れ検出を測る。 |

---

## 3. 対象部門・対象プロジェクトの前提

### 3.1 Bob に接続できる工程

対象部門のプロジェクトでは、クラウド AI の Bob に接続できる工程は以下である。

| 工程 | Bob 活用の方向性 | 次期開発での優先度 |
|---|---|---:|
| コードベースやドキュメントベースの調査 | 変更影響調査、既存仕様確認、設計根拠抽出、問い合わせ回答 | 高 |
| QA | 質問応答、仕様確認、既知不具合調査、調査ログ作成 | 中 |
| 外部仕様設計 | 要求・外部仕様のレビュー、画面・帳票・API 変更影響整理 | 中 |
| 内部仕様設計 | 詳細設計、データ構造、インターフェース、例外処理のレビュー | 高 |
| コーディング | コード生成支援、変更方針レビュー、実装補助 | 中 |
| 単体テスト設計 | テスト観点抽出、境界値、異常系、回帰観点整理 | 高 |
| 単体テスト実施 | 失敗ログ解析、修正候補提示、実施結果要約 | 中 |
| 機能テスト設計 | 要求・仕様からのテスト観点抽出、テスト漏れ検出 | 中 |
| 機能テスト実施 | 不具合再現条件整理、ログ解析、障害票下書き | 中 |
| 結合テスト設計 | インターフェース、データ連携、周辺影響の観点整理 | 中 |
| 上記工程に対するレビュー | 変更差分、文書、テスト仕様、Bob 出力に対するレビュー支援 | 最高 |

初期展開では、効率化と品質向上の効果を示しやすい以下の5領域を重点対象とする。

1. 差分レビュー・規約レビュー
2. コードと要求・設計・テスト仕様の整合プレレビュー
3. 変更影響調査
4. 単体テスト設計支援
5. レビュー結果・実績の構造化保存

### 3.2 対象言語

対象プロジェクトの主な開発言語は以下である。

- C/C++
- C# / .NET / ASP
- Java
- SQL: SQL Server、PostgreSQL、MySQL

次期開発では、すべてを同時に高度解析するのではなく、以下の2層で対応する。

| 層 | 対応内容 | 対象 |
|---|---|---|
| 共通層 | diff、変更ファイル、要求・設計・テスト仕様、レビュー観点、Bob 入力、Bob 出力検証、triage | 全言語 |
| 言語別層 | 関数抽出、クラス・メソッド抽出、SQL オブジェクト抽出、影響範囲推定、テスト観点テンプレート | C/C++、C#、Java、SQL の順に段階追加 |

### 3.3 対象 VCS

対象プロジェクトの VCS は Git または Bazaar である。

| VCS | 現在の対応 | 次期対応 |
|---|---|---|
| Bazaar | `bob-bazaar-review` が先行対応。revision / range / working tree 差分、review packet、MCP、project rules に対応。 | 実績作成の主対象として標準化する。 |
| Git | `bob-code-consistency-review` が Git / Bazaar の差分入力を扱う方向。 | Git 差分レビュー、規約レビュー、整合プレレビューを同等に扱う。 |

### 3.4 対象プロジェクト種別

対象プロジェクトは以下である。

| 種別 | 特徴 | Bob 活用の重点 |
|---|---|---|
| 既存製品の保守開発 | 機能追加、UX 改善、不具合修正。既存仕様との整合と回帰影響が重要。 | 差分レビュー、規約レビュー、影響調査、テスト観点抽出。 |
| 既存製品のメジャーアップデート | 画面刷新、大きな機能追加、変更によるリニューアル。言語・フレームワークのメジャーバージョン変更や言語変更を伴う場合がある。 | 要求・設計・コード・テストの traceability、移行影響調査、仕様差分レビュー。 |

### 3.5 開発体制

平均的な体制は、プロジェクトリーダー1名、SE 3名、プログラマ・テスタ10名である。製品ごとに10〜25名程度のプロジェクトがあり、合計7プロジェクトが存在する。製品間の相互関係はない。

このため、次期開発では中央集権的な1つの運用ではなく、以下の形を目指す。

- 共通テンプレートと共通拡張は横断で提供する。
- 各プロジェクトの `.bob/` 配下に、プロジェクト固有のチェックリスト、ワークフロー、レビュー規約を持たせる。
- 7プロジェクトへ同時強制導入せず、パイロット2プロジェクトから開始する。
- 各プロジェクトリーダーが効果測定と運用判断をできるよう、成果物と指標を標準化する。

---

## 4. 次期開発の基本方針

### 4.1 方針1: `workflow-register` を先に製品品質へ引き上げる

`workflow-register` は、今後のすべての Bob 活用ワークフローの土台になる。よって、機能追加よりも先に以下を整える。

- command 実行の guardrail 強化
- 実行履歴と task snapshot の機密情報対策
- workflow 定義検証の強化
- run state の診断性向上
- 失敗時の再開・再試行・人間承認フローの安定化
- `.bob/workflows/*/WORKFLOW.md` の標準テンプレート整備
- VSIX 配布、バージョン管理、互換性ポリシー整備

`workflow-register` が安定しない状態で工程別ワークフローを増やすと、各プロジェクトで障害原因が Bob なのか、ワークフローなのか、個別拡張なのか切り分けにくくなる。次期開発の最初の投資対象はここである。

### 4.2 方針2: 実績作成は Bazaar レビューから始める

当初の目的である `bob-bazaar-review` の実績作成は、次期開発でも最初の可視成果にする。

理由は以下である。

- Bazaar プロジェクトは既に専用拡張がある。
- 差分、規約、レビュー結果 JSON、Markdown 成果物という実績を残しやすい。
- レビューという工程は品質向上の説明がしやすい。
- Bob 出力を人間が確認・保存する運用に向いている。

まずは Bazaar プロジェクトで「1件の変更に対し、Bob レビューを行い、結果 JSON と Markdown を保存し、人間が採用・棄却を判断する」流れを固める。

### 4.3 方針3: AI の出力は必ず構造化・検証・人間確認を通す

Bob は開発効率化に有効だが、最終判断者ではない。次期開発では以下をルール化する。

- Bob には、可能な限り JSON / YAML schema に沿った出力を求める。
- 拡張機能側で schema validation を行う。
- evidence ID、対象ファイル、revision、規約 ID などの根拠参照を検証する。
- `pass` / `fail` / `unknown` / `blocked` などの状態を明確化する。
- 正式な指摘採用、修正要否、リリース判定は人間が行う。

### 4.4 方針4: プロジェクト固有ルールは `.bob/` に置く

7プロジェクトは製品間の相互関係がないため、共通ルールだけでは運用できない。各プロジェクトの特性は `.bob/` 配下に置く。

```text
.bob/
  workflows/
    <workflow-name>/
      WORKFLOW.md
  review/
    checklist.json
    review-result.schema.json
    review-prompt-template.md
  skills/
    <skill-name>/
      SKILL.md
  custom_modes.yaml
  mcp.json
```

共通拡張は `.bob/` の読み込みと検証を担い、実際のレビュー観点や規約はプロジェクトごとに調整する。

### 4.5 方針5: 「工程全部」ではなく「品質ゲート」から導入する

Bob 接続可能工程は多いが、最初から全工程へ導入すると、利用ログは増えても品質改善の因果が見えにくい。次期開発では、工程の中でも以下の品質ゲートに絞る。

- 差分レビュー前ゲート
- 設計完了前ゲート
- コーディング完了前ゲート
- 単体テスト設計完了前ゲート
- 正式レビュー前ゲート

---

## 5. 次期開発ロードマップ

### 5.1 全体フェーズ

| Phase | 期間目安 | 目的 | 主な成果物 |
|---|---:|---|---|
| Phase 0 | 1か月 | 基盤安定化・運用設計 | セキュリティ修正、運用ガイド、VSIX 配布手順、CI、標準テンプレート |
| Phase 1 | 1〜2か月 | Bazaar レビュー実績作成 | Bazaar 規約レビュー workflow、review-result 保存、実績レポート、パイロット結果 |
| Phase 2 | 2〜3か月 | Git / 複数言語の整合プレレビュー | Git 差分対応、言語別テンプレート、review-package 拡張、traceability 運用 |
| Phase 3 | 3〜4か月 | 工程別 Bob ワークフロー整備 | 調査、設計、単体テスト設計、レビュー向け workflow catalog |
| Phase 4 | 継続 | 7プロジェクト展開・効果測定 | 横断 KPI dashboard、改善 backlog、標準運用化 |

期間は重複可能である。Phase 0 は必ず先行させるが、Phase 1 の運用設計は Phase 0 の後半から並行できる。

---

## 6. Phase 0: 基盤安定化・運用設計

### 6.1 ゴール

`workflow-register` を、7プロジェクトで利用できる共通基盤として安定化する。急遽追加された機能を、次期開発の土台として正式化する。

### 6.2 開発項目

#### WR-0.1 command guardrail 強化

現状の command step は、`vscode.executeCommand` を使う場合に実コマンド ID の管理が重要になる。次期開発では以下を実装する。

- `guardrails.allowedCommandIds` を追加する。
- `vscode.executeCommand` の `args[0]` を実 command ID として検証する。
- allowlist 未定義の場合は、危険な command 実行を拒否または明示承認にする。
- command ID と provider ID の両方を run log に記録する。

#### WR-0.2 task snapshot の機密情報対策

Bob chat messages、metadata、assistant output には、ソースコード、設計書、顧客情報、認証情報が含まれる可能性がある。

対応方針:

- `workflowRegister.taskSnapshots.includeMessages` の既定値を `false` に変更する。
- snapshot 保存前に redaction hook を通す。
- `.bob/workflows/runs/**` を `.gitignore` へ追加するテンプレートを提供する。
- snapshot の保存有無を workflow 単位で明示できるようにする。
- 運用ガイドに、snapshot の扱いと削除手順を明記する。

#### WR-0.3 workflow validator 強化

以下の検証を追加する。

- command step の command ID allowlist 検証
- artifact path の workspace 外参照防止
- `resultKey`、`includeState`、`artifact.producedBy` の参照整合
- `requires.files` の存在確認と表示改善
- workflow folder name と `name` の不一致 warning
- Windows 予約名、末尾 dot / space などのファイル名不備検出

#### WR-0.4 run state / diagnostics 強化

- run state に workflow version、extension version、input hash、artifact path を記録する。
- 失敗ステップ、失敗 command、Bob 出力未取得、schema validation failure を分類する。
- `Bob ワークフロー: 診断を確認` の Markdown 出力を標準化する。
- サポート時に添付可能な診断 bundle を生成する。ただし機密情報は除去する。

#### WR-0.5 CI / package / release 整備

- `npm ci`
- `npm run compile`
- `npm test`
- `vsce package`
- `npm audit` または社内許可された依存監査
- VSIX サイズ確認
- `out/**/*.map` の同梱方針明確化
- 変更履歴 `CHANGELOG.md`

### 6.3 完了条件

- 主要 command step の危険実行を allowlist で制御できる。
- snapshot の既定保存が安全側になっている。
- workflow 定義ミスを実行前に検知できる。
- 失敗時にプロジェクト側で一次切り分けできる診断が出る。
- VSIX を再現可能な手順で作成できる。

---

## 7. Phase 1: Bazaar レビュー実績作成

### 7.1 ゴール

`bob-bazaar-review` を使い、Bazaar プロジェクトでレビュー実績を安定して作成できるようにする。

### 7.2 標準利用フロー

```text
Bazaar workspace を開く
  -> .bob 初期化
  -> revision / range / working tree 差分を選択
  -> review packet 生成
  -> Bob context へ追加
  -> bazaar-project-rule-review workflow 実行
  -> Bob が review-result JSON を出力
  -> JSON 検証
  -> Markdown 変換
  -> 人間が採用・棄却・追加調査を判断
  -> 実績として保存
```

### 7.3 開発項目

#### BBR-1.1 Bazaar レビュー workflow の標準化

`bazaar-project-rule-review` を標準 workflow として整備する。

標準 step:

1. `select-target`: 対象 revision / range を確認する。
2. `collect-context`: Bazaar 差分と変更ファイルを収集する。
3. `load-rules`: `.bob/review/checklist.json` と `review-result.schema.json` を読み込む。
4. `analyze`: Bob が規約に照らしてレビューする。
5. `capture-result`: review-result JSON を取り込む。
6. `validate-result`: schema と checklist 整合を検証する。
7. `human-review`: 人間が確認する。
8. `store-evidence`: JSON / Markdown を実績として保存する。

#### BBR-1.2 project rules テンプレート整備

各プロジェクトで `.bob/review/checklist.json` を調整できるよう、初期テンプレートを増やす。

- C/C++ 保守向け
- C# / .NET / ASP 向け
- Java 向け
- SQL 変更向け
- UI / UX 改善向け
- 不具合修正向け
- メジャーアップデート向け

各 rule には以下を含める。

- `id`
- `category`
- `title`
- `description`
- `severity_on_fail`
- `applies_when`
- `evidence_required`
- `review_hint`

#### BBR-1.3 review-result の実績化

保存成果物を標準化する。

```text
.bob/review/results/
  <review_id>.json
  <review_id>.md
  <review_id>.triage.md
```

追加したい情報:

- 対象 repository
- VCS 種別
- revision / range
- 実行日時
- workflow version
- checklist version
- Bob 出力検証結果
- 人間 triage 結果
- 正式レビューへの引き継ぎ要否

#### BBR-1.4 MCP server の workspace 境界強化

読み取り専用 Bazaar MCP は有効だが、server 側でも workspace root を制限する。

- `.bob/mcp.json` に allowed root を渡す。
- MCP server 起動時に allowed root 外の `cwd` を拒否する。
- `project_rules_init` の書き込み先を workspace 内に限定する。
- Bazaar 操作は引き続き `--no-aliases` を必須にする。

#### BBR-1.5 パイロット運用

パイロットは2プロジェクトで実施する。

| パイロット | 条件 | 目的 |
|---|---|---|
| Pilot A | Bazaar + C/C++ 保守開発 | 当初目的である Bazaar レビュー実績作成を確認する。 |
| Pilot B | Bazaar + 画面 / UX 改善または不具合修正 | 変更種別が異なるケースで checklist の有効性を確認する。 |

### 7.4 完了条件

- パイロット2プロジェクトで合計20件以上の Bazaar レビュー実績を保存できる。
- review-result JSON の schema validation 成功率が90%以上である。
- Bob 指摘に対して人間 triage が残っている。
- checklist の不足・過剰が改善 backlog として整理されている。

---

## 8. Phase 2: Git / 複数言語の整合プレレビュー

### 8.1 ゴール

`bob-code-consistency-review` を、Git / Bazaar 両方のプロジェクトで使える整合プレレビュー基盤へ拡張する。

### 8.2 対象ユースケース

- 要求書にある変更がコードに反映されているか。
- 詳細設計にない意図しない変更が入っていないか。
- コード変更に対してテスト仕様が不足していないか。
- API、DB、画面、帳票、設定ファイルへの影響が設計書に反映されているか。
- 不具合修正で、再発防止テストが追加されているか。
- メジャーアップデートで、旧仕様との差分が文書化されているか。

### 8.3 開発項目

#### CCR-2.1 Git / Bazaar 差分抽出の共通化

共通 interface を定義する。

```ts
type VcsDiffProvider = {
  kind: "git" | "bazaar";
  resolveRange(input: DiffRangeInput): Promise<ResolvedDiffRange>;
  collectChangedFiles(range: ResolvedDiffRange): Promise<ChangedFile[]>;
  collectUnifiedDiff(range: ResolvedDiffRange): Promise<string>;
};
```

対応:

- Git revision は `rev-parse --verify --end-of-options` 相当で検証する。
- Bazaar revision は既存の revision validation を共通利用する。
- CLI option injection を避ける。
- diff size、file count、binary file、generated file の扱いを標準化する。

#### CCR-2.2 言語別解析の段階拡張

| 優先度 | 言語 | 初期対応 | 将来対応 |
|---:|---|---|---|
| 1 | C/C++ | 変更関数候補、ヘッダ影響、global / struct / define、単体テスト観点 | call graph、静的解析連携 |
| 2 | SQL | DDL / DML 変更、テーブル・カラム・index・stored procedure 変更 | DB 影響マップ、移行 SQL 検証 |
| 3 | Java | class / method / interface 変更、JUnit 観点 | Maven / Gradle 連携、OpenRewrite 等との連携 |
| 4 | C# / .NET / ASP | class / method / controller / view / config 変更 | .NET test、ASP 画面影響、API contract 連携 |

#### CCR-2.3 document extraction の安定化

対象文書:

- Markdown
- Word `.docx`
- Excel `.xlsx`
- 将来: PDF は原則対象外、必要時は手動 Markdown 化または別パイプラインにする。

追加する制御:

- ファイルサイズ上限
- Excel sheet 数 / row 数上限
- 抜粋 byte 上限
- Bob prompt へ入れる情報量の上限
- truncation warning
- 機密語・秘密情報の検出 hook

#### CCR-2.4 traceability sidecar の運用化

`traceability-catalog.json` は、元文書を変更せず工程間リンクを保持できる点が重要である。

標準運用:

```text
文書候補収集
  -> AI draft prompt 生成
  -> AI は proposed-only JSON を返す
  -> catalog へ merge
  -> 人間が accepted / rejected / deprecated を判断
  -> gate report 生成
  -> accepted item から review-input.yaml 生成
```

ルール:

- AI は `accepted` にできない。
- 人間承認前の traceability は正式な根拠にしない。
- stale link、missing test、unresolved finding を gate で検出する。

#### CCR-2.5 Bob output validation / human triage 強化

Bob 出力は YAML として保存し、以下を検証する。

- schema validation
- evidence ID の存在
- 存在しない文書 path 参照の禁止
- 存在しない変更ファイル参照の禁止
- severity と category の enum 制約
- 重複指摘の検出
- 人間 triage 状態の付与

triage 状態:

| 状態 | 意味 |
|---|---|
| `accepted` | 正式レビューまたは修正対象へ回す。 |
| `rejected` | 誤検出または対象外。理由を残す。 |
| `needs-investigation` | 追加調査が必要。 |
| `deferred` | 今回対象外だが backlog 化する。 |

### 8.4 完了条件

- Git と Bazaar の両方で review-package を生成できる。
- C/C++ と SQL の初期テンプレートが使える。
- 1プロジェクトあたり5件以上の整合プレレビューを実施できる。
- Bob 出力 validation と人間 triage が保存されている。

---

## 9. Phase 3: 工程別 Bob ワークフロー整備

### 9.1 ゴール

対象部門で Bob に接続できる工程に対し、標準 workflow catalog を提供する。

### 9.2 workflow catalog 案

| workflow 名 | 対象工程 | 目的 | 優先度 |
|---|---|---|---:|
| `bazaar-project-rule-review` | レビュー | Bazaar 差分をプロジェクト規約に照らしてレビューする。 | 最高 |
| `code-consistency-review` | 正式レビュー前 | コード変更と要求・設計・テスト仕様の整合を確認する。 | 最高 |
| `change-impact-investigation` | 調査 / 内部仕様設計 | 変更ファイル、関連文書、影響候補を整理する。 | 高 |
| `unit-test-viewpoint-extraction` | 単体テスト設計 | 変更内容から単体テスト観点を抽出する。 | 高 |
| `bugfix-regression-review` | 保守開発 / QA | 不具合修正に対して再発防止観点と回帰影響を確認する。 | 高 |
| `external-spec-review` | 外部仕様設計 | 要求と外部仕様の不足・矛盾を確認する。 | 中 |
| `internal-spec-review` | 内部仕様設計 | 詳細設計、データ構造、例外処理、インターフェース整合を確認する。 | 中 |
| `functional-test-design-review` | 機能テスト設計 | 仕様から機能テスト観点を抽出し、漏れを確認する。 | 中 |
| `integration-test-design-review` | 結合テスト設計 | API、DB、外部連携、バッチ、画面遷移の結合観点を整理する。 | 中 |
| `qa-investigation-summary` | QA | 問い合わせ、障害、調査ログを整理し、根拠付き回答を作る。 | 中 |

### 9.3 workflow 設計標準

各 workflow は以下を持つ。

```yaml
schemaVersion: workflow-register/v1
name: <stable-name>
description: <purpose>
title: <display-title>
workspaceRequired: true
inputs: {}
requires: {}
guardrails: {}
stepExecution:
  mode: engineSteps
  allowOutOfOrder: false
  showInBob: true
stepReview:
  enabled: true
  pauseAfter: agentAndCommand
  requireAcceptBeforeNext: true
  allowRetry: true
  preserveAttempts: true
artifacts: []
completion: {}
steps: []
```

設計原則:

- 3〜8 step 程度に分ける。
- command step で根拠を集め、agent step で判断させる。
- result step で成果物を保存する。
- 人間確認を必ず挟む。
- Bob が参照した根拠を保存する。
- workflow 内で破壊的操作はしない。

---

## 10. Phase 4: 7プロジェクト展開・効果測定

### 10.1 展開方針

7プロジェクトに一斉導入せず、段階展開する。

| Wave | 対象 | 目的 |
|---|---|---|
| Wave 1 | 2プロジェクト | Bazaar レビューと workflow 基盤の実運用確認。 |
| Wave 2 | 2プロジェクト | Git / Bazaar 混在、複数言語、整合プレレビュー確認。 |
| Wave 3 | 3プロジェクト | 標準 workflow catalog の横展開、効果測定。 |

### 10.2 役割分担

| 役割 | 担当 |
|---|---|
| 横断オーナー | Bob 拡張機能の roadmap、VSIX 配布、共通ルール、効果測定を管理する。 |
| プロジェクトリーダー | 各プロジェクトで対象工程、利用タイミング、レビュー結果の扱いを決める。 |
| SE | 仕様・設計・レビュー観点、traceability、Bob 出力の妥当性を確認する。 |
| プログラマ | 差分レビュー、修正、単体テスト観点確認に利用する。 |
| テスタ | テスト仕様、機能テスト・結合テスト観点、障害調査に利用する。 |

### 10.3 KPI

| KPI | 測定方法 | 目標例 |
|---|---|---:|
| Bob レビュー実施件数 | review-result JSON / run state 件数 | パイロット月20件以上 |
| schema validation 成功率 | Bob 出力の検証結果 | 90%以上 |
| 人間 triage 完了率 | triage file の状態 | 95%以上 |
| 採用指摘率 | Bob 指摘のうち accepted 率 | 20〜50%を目安に観察 |
| 誤検出率 | rejected 率 | 高すぎる場合は prompt / checklist 改善 |
| テスト観点追加件数 | Bob 提案から追加されたテスト観点 | プロジェクトごとに月次集計 |
| 文書更新漏れ検出件数 | document-update-gap 指摘 | 月次集計 |
| 正式レビュー前の修正件数 | Bob プレレビュー後の修正 PR / commit | 月次集計 |
| 手戻り削減 | 後工程指摘の減少 | 四半期比較 |
| 利用者満足度 | PL / SE / PG / テスタへの簡易アンケート | 5段階で平均3.5以上 |

### 10.4 実績レポート

横断集計用に、以下の Markdown レポートを生成する。

```text
.bob/reports/
  monthly-bob-review-summary-YYYY-MM.md
```

レポート項目:

- 対象プロジェクト
- 実行 workflow
- VCS 種別
- 言語
- 変更種別
- Bob レビュー件数
- validation 成功 / 失敗
- accepted / rejected / needs-investigation 件数
- 主な改善例
- checklist / prompt の改善候補

---

## 11. 拡張機能別 backlog

### 11.1 `workflow-register`

| ID | 優先度 | 内容 | Phase |
|---|---:|---|---|
| WR-01 | 高 | command ID allowlist / denylist | 0 |
| WR-02 | 高 | task snapshot の安全側既定値、redaction、`.gitignore` テンプレート | 0 |
| WR-03 | 高 | workflow validator 強化 | 0 |
| WR-04 | 中 | run diagnostics bundle | 0 |
| WR-05 | 中 | workflow catalog 管理機能 | 3 |
| WR-06 | 中 | GUI Builder の工程別テンプレート対応 | 3 |
| WR-07 | 中 | run state から KPI 集計用 export | 4 |

### 11.2 `bob-bazaar-review`

| ID | 優先度 | 内容 | Phase |
|---|---:|---|---|
| BBR-01 | 高 | Bazaar 規約レビュー workflow 標準化 | 1 |
| BBR-02 | 高 | project rules テンプレート拡充 | 1 |
| BBR-03 | 高 | review-result 実績保存形式の標準化 | 1 |
| BBR-04 | 高 | MCP server allowed root 制限 | 1 |
| BBR-05 | 中 | GUI から workflow run / review_id を明示連携 | 1 |
| BBR-06 | 中 | checklist 改善 report | 4 |
| BBR-07 | 中 | Bazaar から Git 移行時の差分レビュー比較支援 | 2 |

### 11.3 `bob-code-consistency-review`

| ID | 優先度 | 内容 | Phase |
|---|---:|---|---|
| CCR-01 | 高 | Git / Bazaar diff provider 共通化 | 2 |
| CCR-02 | 高 | revision / path validation 強化 | 2 |
| CCR-03 | 高 | C/C++ 初期解析の安定化 | 2 |
| CCR-04 | 高 | SQL 変更テンプレート追加 | 2 |
| CCR-05 | 中 | Java / C# テンプレート追加 | 2〜3 |
| CCR-06 | 高 | document extraction size limit / truncation warning | 2 |
| CCR-07 | 高 | Bob output validation と human triage 強化 | 2 |
| CCR-08 | 中 | traceability gate の横断 KPI 化 | 4 |

---

## 12. セキュリティ・ガバナンス方針

### 12.1 基本原則

- Bob / AI はローカル workspace の情報を扱うため、入力・出力・ログをすべて機密情報候補として扱う。
- workflow は単なる prompt ではなく、ローカル command を実行できる自動化定義として扱う。
- 破壊的な VCS 操作やファイル変更は、原則 workflow から実行しない。
- AI 出力は schema validation と人間確認を通過するまで正式成果物にしない。
- 各プロジェクトの `.bob/` はレビュー対象に含める。

### 12.2 禁止・制限事項

| 項目 | 方針 |
|---|---|
| VCS 破壊操作 | `commit`、`push`、`pull`、`merge`、`revert`、`resolve` 等は MCP / workflow から実行しない。 |
| workspace 外書き込み | 原則禁止。必要な場合は明示 opt-in と監査ログを必須にする。 |
| 任意 VS Code command | allowlist なしでは実行不可にする。 |
| AI による正式承認 | 禁止。AI は proposed / draft / candidate まで。 |
| 機密情報入り snapshot | 既定では保存しない。保存時は redaction と `.gitignore` を必須にする。 |

### 12.3 監査対象

- `.bob/workflows/*/WORKFLOW.md`
- `.bob/review/checklist.json`
- `.bob/review/review-result.schema.json`
- `.bob/mcp.json`
- `.bob-trace/traceability-catalog.json`
- `.bob-review/bob-output/*`
- `.bob-review/human-triage/*`

---

## 13. 成果物一覧

### 13.1 開発成果物

- VSIX package
- CHANGELOG
- workflow templates
- project rules templates
- JSON / YAML schemas
- prompt templates
- automated tests
- integration sandbox
- release notes

### 13.2 運用成果物

- 導入手順書
- パイロット運用手順
- workflow 作成ガイド
- Bob レビュー実施手順
- review-result / triage 記録手順
- トラブルシュート集
- KPI 集計レポート

### 13.3 プロジェクト成果物

- `.bob/workflows/*/WORKFLOW.md`
- `.bob/review/checklist.json`
- `.bob/review/results/*.json`
- `.bob/review/results/*.md`
- `.bob-review/review-package/*`
- `.bob-review/bob-output/*`
- `.bob-review/human-triage/*`
- `.bob-trace/traceability-catalog.json`
- `.bob-trace/gate-report.md`

---

## 14. リスクと対策

| リスク | 影響 | 対策 |
|---|---|---|
| Bob 出力の誤りを正式指摘として扱う | 誤修正、レビュー混乱 | schema validation、人間 triage、accepted 以外は正式指摘にしない。 |
| workflow が危険な command を実行する | ローカル環境破壊、情報漏えい | command ID allowlist、trusted workspace 前提、破壊操作禁止。 |
| snapshot / review-package に機密情報が残る | 誤コミット、情報漏えい | `.gitignore`、redaction、保存既定値見直し、削除手順。 |
| checklist がプロジェクトに合わない | 誤検出・見逃し | パイロットで rule 改善、プロジェクト別 checklist 管理。 |
| 文書抽出が大きすぎる | 処理遅延、Bob 入力過多 | サイズ上限、抜粋、truncation warning。 |
| 7プロジェクト展開時に運用がばらつく | 効果測定不能 | workflow catalog、成果物命名、KPI、運用ガイド統一。 |
| Git / Bazaar 差異により実装が複雑化 | 保守性低下 | VCS provider interface に分離。 |
| 言語別対応が広がりすぎる | 開発遅延 | 共通層を先に固め、言語別は優先順位で段階追加。 |

---

## 15. 推奨される次の意思決定

次期開発を開始する前に、以下を決める。

1. Phase 0 を最優先開発として承認するか。
2. Bazaar パイロット対象の2プロジェクトをどれにするか。
3. 実績として保存する review-result / triage の標準形式を採用するか。
4. `.bob/`、`.bob-review/`、`.bob-trace/` をリポジトリ管理対象にする範囲をどうするか。
5. snapshot や Bob 入力成果物の機密情報管理ルールをどうするか。
6. Git 対応と言語別対応の優先順位を、実プロジェクトの計画に合わせて確定するか。
7. KPI 集計を月次で行うか、パイロット完了時のみ行うか。

---

## 16. 初期アクションプラン

### 16.1 最初の2週間

- `workflow-register` の guardrail / snapshot / validator 改修チケットを切る。
- Bazaar パイロット対象を2プロジェクト選定する。
- パイロット用 `.bob/review/checklist.json` を作成する。
- `bazaar-project-rule-review` の標準 workflow を確定する。
- `.gitignore` テンプレートを整備する。

### 16.2 1か月以内

- Phase 0 のセキュリティ・運用安定化を完了する。
- Bazaar レビューを5〜10件実施し、review-result JSON / Markdown を保存する。
- Bob 出力 validation 失敗パターンを収集する。
- checklist と prompt を改善する。
- パイロット中間レポートを作成する。

### 16.3 2〜3か月以内

- Bazaar レビュー実績を20件以上作る。
- Git diff provider の初期実装を行う。
- C/C++ と SQL の整合プレレビューを試行する。
- traceability sidecar の人間承認フローを試行する。
- KPI の初回横断集計を行う。

---

## 17. まとめ

次期開発では、`bob-bazaar-review` の実績作成を起点にしつつ、急遽追加された `workflow-register` を正式な共通基盤へ昇格させることが最重要である。

`workflow-register` が安定すれば、Bob 活用は単発チャットから、再現可能な工程別 workflow へ移行できる。`bob-bazaar-review` は Bazaar プロジェクトで最初の定量実績を作る役割を担い、`bob-code-consistency-review` は要求・設計・コード・テストの整合性という、品質向上効果を示しやすい領域を担う。

7プロジェクトは互いに独立しているため、共通拡張と共通テンプレートを提供しつつ、プロジェクト固有ルールは `.bob/` に置く構成が適している。導入はパイロットから始め、Bob 出力を構造化・検証・人間確認する運用を徹底する。

最終的には、Bob を「質問に答える AI」ではなく、「工程ごとの作業・レビュー・成果物作成を支える開発運営基盤」として位置づける。そのための次期開発は、基盤安定化、レビュー実績化、整合プレレビュー、工程別 workflow、組織展開の順で進めるべきである。

---

## 18. 参照した主なリポジトリ内資料

- `extensions/README.md`
- `extensions/workflow-register/README.md`
- `extensions/bob-bazaar-review/README.md`
- `extensions/bob-code-consistency-review/README.md`
- `docs/workflow-authoring-guide-ja.md`
- `docs/workflows/code-consistency-review/README.md`
- `docs/extensions-review-2026-07-04-14afe83c.md`
- `docs/extensions-maintainability-review-2026-07-04-14afe83c.md`
