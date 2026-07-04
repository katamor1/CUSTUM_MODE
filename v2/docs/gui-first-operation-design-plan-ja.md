# GUIファースト操作設計 企画書

- 対象リポジトリ: `katamor1/bob_builtin_analyze`
- 対象ディレクトリ: `extensions/`, `.bob/`, `docs/`
- 対象拡張機能: `workflow-register`, `bob-bazaar-review`, `bob-code-consistency-review`
- 関連計画: Phase 0〜3 の Bob 活用計画
- 作成日: 2026-07-04
- 想定読者: プロジェクトリーダ、SE、プログラマ、テスタ、UAT 担当、拡張機能開発者、CODEX 実装エージェント

## 1. 背景

今回のプロジェクト全般で、プロジェクトメンバー全員が VS Code Command Palette や CLI 操作に慣れているわけではないことが分かった。さらに、IBM Bob 活用を 7 プロジェクトへ広げるには、導入初期の学習コストを下げ、操作を迷わせないことが重要である。

現状の拡張機能には、すでに GUI 化の種がある。`workflow-register` は workflow の作成、検証、実行、再開、診断、AI 補助、GUI Builder を提供する基盤拡張であり、`bob-bazaar-review` は Bazaar レビュー用 GUI を持ち、`bob-code-consistency-review` は review-input を直接手書きするだけでなく、対話式 wizard、AI draft、Traceability Prep Webview を提供している。

一方で、実運用手順はまだ Command Palette の起動や YAML / JSON の手作業、clipboard 経由の capture に依存している箇所が多い。普及速度を上げるには、Command Palette を「上級者向けの裏口」とし、日常操作はボタン、選択肢、入力欄、一覧、進捗表示、確認ダイアログで進められるようにする必要がある。

## 2. 企画の目的

本企画の目的は、Bob 活用プロジェクト全体を GUI ファーストに再設計し、非コマンドユーザーでも迷わずレビュー、整合プレレビュー、工程別 workflow を実行できる操作体験を作ることである。

目標は次の 5 点である。

1. Command Palette を覚えなくても主要操作を開始できる。
2. YAML / JSON を直接編集しなくても標準ケースを実行できる。
3. 「次に何をすればよいか」が画面上に常に表示される。
4. Bob が出した結果を人間が確認・採否判断しやすい。
5. 7 プロジェクトへ横展開しても、同じ画面構成と用語で教育できる。

## 3. 基本方針

### 3.1 GUI ファースト、コマンドは裏側へ

主要操作は、Command Palette ではなく Webview / Tree View / Sidebar のボタンから実行する。既存 command ID は互換性のため残すが、ユーザーには極力 command ID を意識させない。

### 3.2 ウィザード形式で迷いを減らす

入力が多い操作は、1 画面に全項目を詰め込まず、以下のようなステップ式にする。

```text
対象選択 -> 前提チェック -> 入力確認 -> Bob 実行 -> 結果確認 -> 人間 triage -> 保存 / handoff
```

### 3.3 既定値と候補提示を優先する

Git / Bazaar revision、関連文書、review focus、言語 profile、workflow は、可能な限り自動検出し、ユーザーは候補から選ぶだけにする。

### 3.4 人間 gate を画面化する

Bob の出力は最終判断ではない。`承認`, `差戻し`, `再試行`, `追加調査`, `保留`, `正式レビューへ送る` を明示ボタンとして表示する。

### 3.5 エラーは修正導線付きで表示する

YAML schema error、必須ファイル不足、MCP 未設定、review-result invalid などは、エラー文だけでなく `修正する`, `初期化する`, `再検証する`, `詳細を見る` のボタンを出す。

### 3.6 段階的開示

初心者には `かんたんモード`、SE / PL には `詳細モード`、拡張機能開発者には `開発者モード` を提供する。最初からすべての設定を見せない。

## 4. 想定ユーザーと操作ニーズ

| ユーザー | 主な関心 | GUI で必要なこと |
|---|---|---|
| プロジェクトリーダ | 実績、進捗、品質指標、横展開 | ダッシュボード、summary、実績 record、UAT 結果を見たい。 |
| SE | 調査、設計、レビュー、triage | 証跡を見ながら Bob 結果を採否判断したい。 |
| プログラマ | 変更差分、実装前後の確認、単体テスト観点 | revision / branch を選ぶだけで precheck やテスト観点を作りたい。 |
| テスタ | テスト設計、実施結果、証跡整理 | 仕様や変更点からテストケース候補を作り、実施結果を保存したい。 |
| UAT 担当 | 手順どおりに実績作成 | 画面上の checklist に沿って迷わず実行し、記録を残したい。 |
| 拡張機能開発者 | 保守、検証、トラブルシュート | 実行状態、ログ、diagnostics、生成物 path を確認したい。 |

## 5. 現状の操作課題

### 5.1 Command Palette 依存

既存 README の手順では、`Bob Workflow: GUI で作成`、`Bob Bazaar Review: GUI を開く`、`Bob Code Consistency Review: 入力を前処理して Bob 用パッケージを作成` など、Command Palette 起動が多い。慣れていないユーザーは、コマンド名を覚える、検索する、実行順を理解する、という負担を負う。

### 5.2 ファイル編集依存

workflow 定義、review-input.yaml、campaign.yaml、triage.yaml などは柔軟だが、初心者には直接編集が難しい。手入力ミス、schema error、path 間違いが普及の妨げになる。

### 5.3 結果の取り込みが分かりづらい

Bob 出力を clipboard / selection / active editor から取り込む操作は、実装上は有効だが、初心者には「どの JSON / YAML をコピーすべきか」「保存できたか」が分かりにくい。

### 5.4 状態が複数箇所に分散

`.bob`, `.bob-review`, `.bob-trace`, `.bob-review-records`, `.bob-process-runs` など成果物が増えるため、画面上で状態を集約しないと、ユーザーはどのファイルを見ればよいか分からなくなる。

## 6. GUI 全体構想

### 6.1 Bob Operation Hub

新しい中心画面として `Bob Operation Hub` を設ける。これは VS Code / Bob IDE の Sidebar または Webview Panel として表示し、以下の入口を提供する。

```text
Bob Operation Hub
  ├─ はじめる
  ├─ レビューする
  ├─ 整合プレレビューする
  ├─ 工程別ワークフロー
  ├─ 実績・レポート
  ├─ 設定・初期化
  └─ トラブルシュート
```

ユーザーは Command Palette ではなく、この Hub から主要操作を開始する。

### 6.2 画面構成

| 画面 | 目的 | 主な操作 |
|---|---|---|
| Home | 現在の workspace 状態と推奨アクションを表示 | `初期化する`, `レビュー開始`, `前回の続き`, `診断を見る` |
| Setup Checklist | `.bob`、MCP、workflow、schema、VSIX、Bob 拡張の状態確認 | `不足を作成`, `再確認`, `詳細` |
| Workflow Catalog | 利用可能 workflow の一覧 | `開始`, `説明を見る`, `テンプレート作成`, `お気に入り` |
| Review Launcher | Bazaar / Git / 整合レビューの入口 | VCS、revision、target、review type 選択 |
| Evidence Picker | コード、文書、ticket、test spec の選択 | checkbox、filter、preview |
| Run Monitor | workflow 実行状態 | step 進捗、承認、再試行、ログ、成果物 |
| Result Capture | Bob 出力の検証・保存 | `Bob出力を取り込む`, `検証`, `保存`, `修正ガイド` |
| Human Triage | finding の採否判断 | `採用`, `棄却`, `追加調査`, `保留`, `担当者`, `理由` |
| Report Center | 実績・summary 確認 | campaign summary、metrics、export |
| Troubleshooter | エラー・診断 | guardrail, MCP, schema, path, snapshot, VCS 診断 |

## 7. 既存機能との統合方針

### 7.1 `workflow-register`

`workflow-register` は GUI 操作の実行基盤として扱う。既存の GUI Builder、run history、diagnostics を、Bob Operation Hub の以下に統合する。

| 既存機能 | GUI 改善方針 |
|---|---|
| `Bob Workflow: GUI で作成` | Hub の `ワークフローを作る` ボタンから起動。 |
| `Bob Workflow: 現在の定義を検証` | 保存時・画面遷移時に自動検証し、問題をカード表示。 |
| `Bob Workflow: 実行` | Workflow Catalog の `開始` ボタンから起動。 |
| `Bob Workflow: 実行を再開` | Home の `前回の続き` に表示。 |
| `Bob Workflow: 診断を確認` | Troubleshooter に統合。 |
| step review | Run Monitor に `承認`, `再試行`, `編集して再試行` ボタンとして表示。 |

### 7.2 `bob-bazaar-review`

Bazaar Review GUI は、最初に GUI 化されている領域として発展させる。Phase 1 の実績作成とつなげ、以下を追加する。

| 改善項目 | 内容 |
|---|---|
| Review Wizard | `対象選択 -> 規約確認 -> Bob投入 -> 結果取込 -> triage -> summary` の流れにする。 |
| Campaign UI | campaign / target / record / summary を画面で作成・確認する。 |
| Result Capture UI | clipboard を意識せず、Bob 出力候補を検出して `取り込む` ボタンを出す。 |
| Triage UI | review-result の finding と checklist result を表で採否判断する。 |
| Safety UI | `--no-aliases`, MCP readonly, allowed root を状態表示する。 |

### 7.3 `bob-code-consistency-review`

整合プレレビューは、最も GUI 化の効果が大きい。`review-input.yaml` 手書きや多数の command 実行を、ウィザードとカード式入力へ置き換える。

| 既存機能 | GUI 改善方針 |
|---|---|
| review-input wizard | Hub の `整合プレレビューを開始` から起動し、VCS / 言語 / 文書を画面選択。 |
| AI draft prompt | `AIに候補作成を依頼` ボタン化し、JSON 貼り付けを隠す。 |
| Traceability Prep Webview | Evidence Picker と統合し、承認待ち件数を Home に表示。 |
| preprocess | `Bob用パッケージを作成` ボタン化し、生成ファイルを画面で preview。 |
| capture / validate / triage | Bob 出力検出、schema validation、finding triage を一つの画面に集約。 |

## 8. 操作フロー案

### 8.1 初回セットアップ

```text
Home
  -> セットアップを開始
  -> workspace 診断
  -> 不足ファイルを一覧表示
  -> .bob / workflow / schema / MCP を作成
  -> サンプル workflow を表示
  -> 完了: “レビューを開始できます”
```

画面上のボタン:

- `不足をまとめて作成`
- `個別に確認して作成`
- `再診断`
- `管理者向け詳細を開く`

### 8.2 Bazaar レビュー実績作成

```text
Review Launcher
  -> Bazaar を選択
  -> campaign を選択 / 新規作成
  -> レビュー対象 mode を選択
  -> revision / range を入力
  -> 取得ボタン
  -> 変更ファイルと diff summary を確認
  -> Bobにレビュー依頼
  -> Bob出力を取り込む
  -> schema 検証
  -> 人間 triage
  -> summary 生成
```

主な UI 部品:

- mode select: `1リビジョン`, `範囲`, `未コミット差分`
- revision input
- changed file list
- checklist status panel
- `BobにADD`, `Workflowで実行`, `結果を取り込む`, `triageへ進む`

### 8.3 Git / 複数言語 整合プレレビュー

```text
Review Launcher
  -> 整合プレレビューを選択
  -> Git / Bazaar を選択
  -> base / head / working tree を選択
  -> 変更ファイルを自動分類
  -> 関連文書候補を選択
  -> review focus を選択
  -> traceability 候補を承認
  -> review-input を生成
  -> review-package を生成
  -> Bob 実行
  -> output 検証
  -> human triage
```

主な UI 部品:

- branch / revision picker
- language chips: `C/C++`, `C#`, `Java`, `SQL`
- document candidate cards
- review focus checkbox
- traceability approval table
- evidence preview
- validation status badge

### 8.4 工程別 workflow 実行

```text
Workflow Catalog
  -> 工程を選択
  -> workflow を選択
  -> process-input を wizard で作成
  -> preflight 結果確認
  -> workflow 開始
  -> step ごとの承認 / 再試行
  -> 成果物 preview
  -> 次工程 handoff 作成
```

工程選択例:

- `調査`
- `QA`
- `外部仕様設計`
- `内部仕様設計`
- `コーディング`
- `単体テスト設計`
- `機能テスト設計`
- `結合テスト設計`
- `レビュー`

## 9. 画面詳細設計

### 9.1 Home 画面

目的: ユーザーが最初に迷わない状態を作る。

表示項目:

- workspace 名
- Bob 拡張導入状態
- workflow-register 状態
- `.bob` 初期化状態
- Git / Bazaar 検出状態
- 未完了 run
- 直近の review / triage / summary
- 推奨アクション

ボタン:

- `レビューを開始`
- `整合プレレビューを開始`
- `工程別ワークフローを開く`
- `前回の続きを再開`
- `セットアップを確認`
- `トラブルシュート`

### 9.2 Setup Checklist 画面

目的: 初期化や設定不足を自動で発見し、ボタンで解消する。

チェック項目:

| チェック | OK 条件 | NG 時のボタン |
|---|---|---|
| IBM Bob 拡張 | `IBM.bob-code` が有効 | `導入手順を見る` |
| workflow-register | 有効化済み | `再読み込み` |
| `.bob/workflows` | workflow が存在 | `標準workflowを作成` |
| Bazaar MCP | `.bob/mcp.json` 設定済み | `MCPを設定` |
| review schema | `.bob/review/review-result.schema.json` 存在 | `規約を初期化` |
| traceability | `.bob-trace` 状態 | `Traceabilityを準備` |
| Git / Bazaar | repo 検出 | `対象フォルダを選択` |

### 9.3 Workflow Catalog 画面

目的: 工程別 workflow を一覧から開始できるようにする。

表示項目:

- 工程カテゴリ
- workflow 名
- 難易度
- 所要時間目安
- 必須入力
- 最終更新
- 利用回数
- 成果物

操作:

- `開始`
- `説明`
- `テンプレートを見る`
- `お気に入りに追加`
- `このworkflowを複製して編集`

### 9.4 Run Monitor 画面

目的: 実行中の workflow を、進捗・承認・再試行込みで見える化する。

表示:

```text
[1] 入力確認          完了
[2] evidence収集      完了
[3] Bob分析           実行中
[4] 人間確認          待機中
[5] レポート保存      未実行
```

ボタン:

- `次へ`
- `承認して次へ`
- `再試行`
- `入力を修正`
- `一時停止`
- `成果物を開く`
- `ログを見る`

### 9.5 Evidence Picker 画面

目的: 関連文書やコード evidence をファイルツリーではなく候補カードで選べるようにする。

機能:

- 文書種別 filter: requirements / basic design / detailed design / test spec / tickets / ledgers
- VCS changed files filter
- language filter
- evidence preview
- `選択済み` カウンタ
- `AI候補を提案` ボタン
- `選択を review-input に反映` ボタン

### 9.6 Result Capture 画面

目的: Bob 出力の取り込みを clipboard 操作から画面操作へ寄せる。

機能:

- Bob 出力候補の自動検出
- fenced JSON / YAML block の抽出 preview
- schema validation 結果
- evidence ref validation 結果
- 保存先 preview
- `取り込む`
- `検証のみ`
- `修正候補を見る`
- `triageへ進む`

### 9.7 Human Triage 画面

目的: Bob finding を人間が採否判断しやすくする。

表示項目:

| 項目 | UI |
|---|---|
| finding | カード / table |
| severity | badge |
| rule_id | link |
| evidence_refs | clickable chip |
| decision | segmented button: 採用 / 棄却 / 追加調査 / 保留 |
| owner | dropdown / text input |
| reason | textarea |
| next_action | dropdown |

ボタン:

- `すべて保存`
- `未判断だけ表示`
- `採用だけ表示`
- `summary生成`
- `正式レビューへ引き継ぐ`

## 10. Command Palette から GUI への移行マッピング

| 現在の操作 | GUI での入口 | 備考 |
|---|---|---|
| `Bob Workflow: GUI で作成` | Hub > ワークフローを作る | 既存 GUI Builder を再利用。 |
| `Bob Workflow: 現在の定義を検証` | Workflow Editor > 自動検証 | 保存時・画面遷移時に実行。 |
| `Bob Workflow: 実行` | Workflow Catalog > 開始 | workflow 選択をカード化。 |
| `Bob Bazaar Review: GUI を開く` | Hub > レビューする > Bazaar | 既存 GUI を主導線に昇格。 |
| `Bob Bazaar Review: Bob MCP を設定` | Setup Checklist > MCPを設定 | 不足時だけ表示。 |
| `Bob Bazaar Review: レビュー結果を取り込む` | Result Capture > 取り込む | active editor / clipboard を裏側で利用。 |
| `Bob Code Consistency Review: 対話式に review-input.yaml を作成` | 整合プレレビュー Wizard | review-input を画面生成。 |
| `Bob Code Consistency Review: traceability prep を開く` | Evidence Picker > Traceability | 承認待ち件数を表示。 |
| `Bob Code Consistency Review: 入力を前処理して Bob 用パッケージを作成` | 整合プレレビュー > パッケージ作成 | 成果物 preview 付き。 |
| `Bob Code Consistency Review: Bob 出力 YAML を検証` | Result Capture > 検証 | 保存前に自動実行。 |
| `Bob Code Consistency Review: 人間確認用 triage を生成` | Human Triage > triage作成 | findings table へ直接遷移。 |

## 11. 実装アーキテクチャ案

### 11.1 画面構成

```text
extensions/
  workflow-register/
    src/gui/
      operationHubProvider.ts
      workflowCatalogView.ts
      runMonitorView.ts
      setupChecklistView.ts
      sharedWebview.ts
  bob-bazaar-review/
    src/gui/
      bazaarReviewWizard.ts
      campaignView.ts
      resultCaptureView.ts
      triageView.ts
  bob-code-consistency-review/
    src/gui/
      consistencyReviewWizard.ts
      evidencePickerView.ts
      packagePreviewView.ts
      outputValidationView.ts
```

### 11.2 共通 UI コンポーネント

再利用する UI 部品を定義する。

| コンポーネント | 用途 |
|---|---|
| `StatusCard` | OK / Warning / Error / Not configured を表示。 |
| `ActionButtonGroup` | 次へ、戻る、保存、再試行など。 |
| `StepProgress` | workflow step の進捗。 |
| `EvidenceTable` | evidence refs と preview。 |
| `ValidationPanel` | schema / path / guardrail / evidence validation 結果。 |
| `TriageTable` | finding の人間判断。 |
| `ArtifactList` | 生成成果物一覧。 |
| `RunSummaryCard` | run / record / campaign summary。 |

### 11.3 状態管理

GUI は既存の workspace ファイルを source of truth とし、独自 DB は持たない。

| 状態 | Source of truth |
|---|---|
| workflow 定義 | `.bob/workflows/*/WORKFLOW.md` |
| workflow run | `.bob/workflows/runs/<runId>/run.json` |
| Bazaar review result | `.bob/review/results/*.json` |
| consistency review package | `.bob-review/review-package/*` |
| traceability | `.bob-trace/traceability-catalog.json` |
| review record | `.bob-review-records/*` |
| process record | `.bob-process-records/*` |

### 11.4 操作ログ

GUI 操作ログは、機密情報を含めず、次の程度に留める。

```json
{
  "event": "gui.review.start",
  "workflow": "bazaar-project-rule-review",
  "timestamp": "2026-07-04T10:00:00+09:00",
  "result": "started"
}
```

コード断片、文書本文、Bob message は telemetry 的なログに含めない。

## 12. GUI 設計の品質基準

### 12.1 学習コスト

| 指標 | 目標 |
|---|---|
| 初回 Bazaar review 開始までの操作 | 5クリック以内を目標。 |
| Command Palette 必須操作 | 標準導線では 0。 |
| YAML / JSON 直接編集 | 標準導線では不要。 |
| UAT 担当者の手順理解 | 画面の文言だけで次操作が分かる。 |

### 12.2 直感性

- 主要ボタンは動詞で表示する: `開始`, `取得`, `検証`, `保存`, `承認`, `再試行`。
- エラーは赤、警告は黄、成功は緑など、VS Code theme に沿う。
- `未初期化`, `検証待ち`, `人間確認待ち`, `保存済み` の状態を badge 表示する。
- technical term は tooltip で補足する。

### 12.3 安全性

- destructive 操作は原則提供しない。
- VCS 書き込みボタンは Phase 0〜3 の範囲では作らない。
- workspace 外 path は選択 UI でも拒否する。
- command allowlist 外の操作はボタン自体を disabled にする。
- Bob 出力は保存前に validation する。

### 12.4 アクセシビリティ

- keyboard 操作可能にする。
- VS Code theme と high contrast に対応する。
- ボタンの意味を icon だけに依存しない。
- table は sort / filter / keyboard focus を持つ。
- 長い diff / document preview は折りたたみ可能にする。

## 13. Work package 一覧

| ID | 対象 | 名称 | 優先度 | 主な成果物 |
|---|---|---|---:|---|
| GUI-00 | docs | GUI設計仕様と用語統一 | 1 | UI用語集、画面遷移、操作原則 |
| GUI-01 | workflow-register | Bob Operation Hub MVP | 1 | Home、Setup Checklist、Workflow Catalog |
| GUI-02 | workflow-register | Run Monitor / Step Review UI | 1 | step進捗、承認、再試行、成果物一覧 |
| GUI-03 | bob-bazaar-review | Bazaar Review Wizard v2 | 1 | campaign、target、packet、capture、triage 統合 |
| GUI-04 | bob-code-consistency-review | Consistency Review Wizard v2 | 1 | VCS、言語、文書、review focus、package 生成 |
| GUI-05 | bob-code-consistency-review | Evidence Picker / Traceability UI 統合 | 2 | 文書候補、code evidence、traceability 承認 |
| GUI-06 | common | Result Capture / Validation UI | 1 | JSON/YAML検出、schema検証、保存、修正導線 |
| GUI-07 | common | Human Triage UI | 1 | finding採否、理由、担当、summary生成 |
| GUI-08 | common | Report Center | 2 | campaign summary、process summary、export |
| GUI-09 | docs/uat | GUI UAT / 操作教育資料 | 1 | click-through UAT、教育手順、FAQ |
| GUI-10 | telemetry-lite | 操作改善用 metrics | 3 | 個人情報なしの画面遷移・失敗種別集計 |

## 14. GUI-01: Bob Operation Hub MVP

### 14.1 目的

ユーザーが最初に開く統合入口を作る。

### 14.2 MVP 範囲

- workspace 状態表示
- セットアップ不足の表示
- 主要操作ボタン
- workflow catalog の簡易一覧
- 直近 run / record の表示

### 14.3 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| fresh workspace | `.bob` なしで開く。 | `セットアップを開始` が表示される。 |
| initialized workspace | `.bob` ありで開く。 | workflow 一覧と開始ボタンが表示される。 |
| missing Bob | IBM Bob 拡張なし。 | 導入手順と fallback が表示される。 |
| multi-root | 複数 workspace。 | 対象 workspace 選択 UI が出る。 |

## 15. GUI-02: Run Monitor / Step Review UI

### 15.1 目的

workflow 実行中の状態を一覧化し、人間 gate をボタン操作にする。

### 15.2 機能

- step 一覧
- current step highlight
- state / result preview
- `承認して次へ`
- `再試行`
- `一時停止`
- `成果物を開く`
- `失敗理由を見る`

### 15.3 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| reviewing step | stepReview で停止。 | 承認ボタンが表示される。 |
| failed command | command step 失敗。 | 再試行と詳細ボタンが表示される。 |
| manual step | manual step 待ち。 | 完了ボタンが表示される。 |
| artifact | artifact path あり。 | 成果物を開ける。 |

## 16. GUI-03: Bazaar Review Wizard v2

### 16.1 目的

Phase 1 の Bazaar レビュー実績作成を、ウィザードで完結できるようにする。

### 16.2 画面ステップ

1. campaign 選択 / 作成
2. Bazaar workspace 確認
3. review target 選択
4. revision / range 入力
5. diff / changed files preview
6. project rules 確認
7. Bob review 実行
8. result capture / validation
9. human triage
10. summary 生成

### 16.3 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| single revision | revision を入力して取得。 | diff preview が出る。 |
| range | base / target 入力。 | range summary が出る。 |
| missing rules | checklist なし。 | 初期化ボタンが出る。 |
| capture invalid | invalid JSON 取り込み。 | 保存されず修正ガイド表示。 |
| triage complete | findings を採否判断。 | summary 生成可能。 |

## 17. GUI-04: Consistency Review Wizard v2

### 17.1 目的

Phase 2 の Git / 複数言語整合プレレビューを、review-input.yaml 手書きなしで実行できるようにする。

### 17.2 画面ステップ

1. VCS 選択: Git / Bazaar
2. base / head / working tree 選択
3. 変更ファイルと言語の確認
4. 関連文書候補の選択
5. review focus 選択
6. traceability 候補確認
7. review-input 生成
8. review-package 生成
9. Bob 実行
10. output validation
11. human triage

### 17.3 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| Git C# + SQL | 変更ファイルから言語検出。 | C# と SQL が選択済み表示。 |
| docs candidate | docs から requirements / design 候補。 | checkbox で選択可能。 |
| invalid path | workspace 外 path。 | 選択不可。 |
| package preview | preprocess 後。 | review-package file list が表示される。 |
| missing evidence | Bob output が存在しない evidence 参照。 | validation error。 |

## 18. GUI-05: Evidence Picker / Traceability UI 統合

### 18.1 目的

関連文書・コード evidence・traceability を一画面で確認し、人間が承認できるようにする。

### 18.2 機能

- 文書候補一覧
- code evidence preview
- traceability proposed / accepted / rejected / deprecated 切替
- stale warning
- `review-input に反映`
- `未承認だけ表示`

### 18.3 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| proposed items | AI draft 後。 | proposed items が表示される。 |
| accept | item を accepted にする。 | catalog が更新される。 |
| reject | item を rejected にする。 | reason 入力が求められる。 |
| create input | accepted item から review-input。 | YAML が生成される。 |

## 19. GUI-06: Result Capture / Validation UI

### 19.1 目的

Bob 出力の取り込み・検証・保存を、ユーザーが迷わず実行できるようにする。

### 19.2 機能

- active editor / clipboard / latest assistant output の候補検出
- JSON / YAML block 抽出
- schema validation
- evidence validation
- 保存先確認
- invalid 時の issue path 表示

### 19.3 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| valid JSON | Bazaar review-result。 | 保存可能。 |
| valid YAML | consistency bob-output。 | 保存可能。 |
| fenced block | fenced JSON/YAML。 | 正しく抽出。 |
| invalid schema | 必須項目不足。 | 保存不可、修正箇所表示。 |
| no candidate | 出力候補なし。 | 手動貼り付け欄を表示。 |

## 20. GUI-07: Human Triage UI

### 20.1 目的

Bob finding を人間が採否判断し、実績 record / process record へ保存できるようにする。

### 20.2 機能

- finding table
- evidence preview
- decision segmented button
- owner / action / reason 入力
- summary 自動集計
- 未判断 filter
- Markdown / YAML 保存

### 20.3 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| accepted | finding を採用。 | owner / action 入力後に保存。 |
| rejected | finding を棄却。 | reason 必須。 |
| needs investigation | 追加調査。 | next action が記録される。 |
| summary mismatch | 手編集で件数不一致。 | validation error。 |

## 21. GUI-08: Report Center

### 21.1 目的

PL / SE が実績、品質、利用状況を画面で確認できるようにする。

### 21.2 表示項目

- Bazaar review campaign summary
- consistency review summary
- process workflow summary
- accepted / rejected findings
- workflow run count
- failed / blocked count
- human gate wait
- artifact list
- export button

### 21.3 テスト計画

| テスト | 内容 | 期待結果 |
|---|---|---|
| campaign summary | Phase 1 records を表示。 | 件数と採否が出る。 |
| process summary | Phase 3 records を表示。 | 工程別件数が出る。 |
| missing record | record なし。 | 空状態と作成ボタン。 |
| export | Markdown export。 | 報告書が生成される。 |

## 22. GUI UAT 計画

### 22.1 UAT 観点

| 観点 | 目的 |
|---|---|
| 初回導入 | コマンドを知らないユーザーがセットアップできるか。 |
| Bazaar review | GUI だけで実績作成できるか。 |
| 整合プレレビュー | review-input を手書きせず実行できるか。 |
| 工程別 workflow | workflow catalog から対象工程を開始できるか。 |
| triage | Bob finding を採否判断できるか。 |
| error recovery | 不足ファイルや invalid output から復旧できるか。 |

### 22.2 UAT ケース

| ID | ケース | 合格条件 |
|---|---|---|
| GUI-UAT-001 | 初回セットアップ | Command Palette なしで `.bob` 初期化完了。 |
| GUI-UAT-002 | Bazaar 1 revision review | packet 生成、Bob投入、result保存、triage完了。 |
| GUI-UAT-003 | Git 整合プレレビュー | Git range、文書選択、package生成、validation完了。 |
| GUI-UAT-004 | Traceability 承認 | proposed item を accepted にして review-input 生成。 |
| GUI-UAT-005 | 工程別 workflow 開始 | catalog から QA workflow を開始し成果物保存。 |
| GUI-UAT-006 | invalid output | invalid Bob output を取り込み、保存不可と修正表示。 |
| GUI-UAT-007 | run resume | 中断 run を Home から再開。 |
| GUI-UAT-008 | non-command user test | Command Palette を使わず主要導線を完了。 |

### 22.3 成功指標

| 指標 | 目標 |
|---|---|
| Command Palette なしで完了できる主要導線 | 80% 以上。最終的に 95% 以上。 |
| 初回 Bazaar review 開始まで | 5分以内。 |
| review-input 手書き率 | 標準導線では 0%。 |
| invalid output 復旧率 | UAT で 90% 以上。 |
| UAT 担当者の迷いポイント | 1導線あたり 2件以下。 |
| GUI 経由 workflow 実行率 | 普及後 80% 以上。 |

## 23. 段階的実装ロードマップ

### 23.1 Stage 1: 入口統一

- Bob Operation Hub MVP
- Setup Checklist
- Workflow Catalog
- 既存 GUI へのリンク統合

### 23.2 Stage 2: レビュー系 GUI 完結

- Bazaar Review Wizard v2
- Result Capture UI
- Human Triage UI
- Campaign Summary UI

### 23.3 Stage 3: 整合プレレビュー GUI 完結

- Consistency Review Wizard v2
- Evidence Picker
- Traceability UI 統合
- Package Preview
- Output Validation UI

### 23.4 Stage 4: 工程別 workflow GUI

- Process Workflow Catalog
- process-input wizard
- Run Monitor 強化
- Report Center

### 23.5 Stage 5: 普及・教育・改善

- 画面ツアー
- サンプル workspace
- 役割別 quick start
- UAT フィードバック反映
- 操作 metrics による改善

## 24. 教育・普及施策

### 24.1 役割別クイックスタート

| 対象 | 1枚ガイド |
|---|---|
| PL | 実績とレポートを見る手順。 |
| SE | review / triage / design workflow の手順。 |
| プログラマ | Git/Bazaar 差分から precheck する手順。 |
| テスタ | テスト観点生成と実施結果整理の手順。 |
| UAT 担当 | campaign と record を作る手順。 |

### 24.2 画面ツアー

初回起動時に以下を案内する。

1. Home の見方
2. セットアップ状態
3. レビュー開始
4. 実行中 workflow
5. 結果取り込み
6. triage
7. レポート

### 24.3 用語統一

| 用語 | 表示方針 |
|---|---|
| workflow | 画面上は `作業フロー` または `ワークフロー`。 |
| run | `実行`。 |
| artifact | `成果物`。 |
| evidence | `根拠`。 |
| triage | `人間確認` または `採否判断`。 |
| capture | `取り込む`。 |
| validation | `検証`。 |

## 25. リスクと対策

| リスク | 内容 | 対策 |
|---|---|---|
| GUI が肥大化する | すべてを 1 画面に入れると逆に分かりにくい。 | Hub + wizard + 詳細モードに分ける。 |
| 既存 command と二重管理 | GUI と Command Palette の処理が分岐する。 | GUI は既存 command / service を呼ぶ薄い層にする。 |
| Webview 保守負荷 | 画面が増え保守が重くなる。 | 共通コンポーネント化、画面仕様書、UAT fixture を作る。 |
| 操作ログの機密混入 | diff や文書本文がログに残る。 | 操作ログはイベント名と結果だけに限定。 |
| 初心者向けにしすぎて上級者が遅い | 詳細設定や直接編集が必要な場合がある。 | 詳細モードと Command Palette を残す。 |
| プロジェクト差異 | 7 プロジェクトで規約や文書構成が違う。 | workflow 本体と project checklist / template を分離。 |

## 26. 実装時の CODEX 作業指示テンプレート

```text
対象: <GUI work package ID>
目的: <1文で目的>
変更対象:
- <path>

制約:
- 既存 command ID / provider ID を壊さない。
- GUI は既存 service / command を呼び、処理本体を重複実装しない。
- workspace 外 path を許可しない。
- Bob 出力は保存前に validation する。
- AI の最終判断をそのまま承認しない。human gate を残す。
- Webview CSP / nonce / message validation を守る。
- README/docs と UAT 手順を同時に更新する。

実装内容:
1. <実装ステップ>
2. <実装ステップ>
3. <実装ステップ>

テスト:
- npm run compile
- npm run test
- 追加 unit test: <list>
- 追加 webview interaction test: <list>
- 追加 UAT testcase: <list>

完了条件:
- <受け入れ条件>
```

## 27. 推奨実装順

1. `GUI-00`: GUI 設計仕様と用語統一
2. `GUI-01`: Bob Operation Hub MVP
3. `GUI-02`: Run Monitor / Step Review UI
4. `GUI-06`: Result Capture / Validation UI
5. `GUI-07`: Human Triage UI
6. `GUI-03`: Bazaar Review Wizard v2
7. `GUI-04`: Consistency Review Wizard v2
8. `GUI-05`: Evidence Picker / Traceability UI 統合
9. `GUI-08`: Report Center
10. `GUI-09`: GUI UAT / 操作教育資料
11. `GUI-10`: 操作改善用 metrics

入口、実行状態、結果取り込み、triage を先に整備する理由は、全フェーズの共通ボトルネックだからである。その後に Bazaar / 整合プレレビュー / 工程別 workflow の専用 wizard を広げる。

## 28. 参照資料

- `extensions/README.md`
- `extensions/workflow-register/README.md`
- `extensions/bob-bazaar-review/README.md`
- `extensions/bob-code-consistency-review/README.md`
- `docs/phase0-foundation-stabilization-codex-plan-ja.md`
- `docs/phase1-bazaar-review-record-codex-plan-ja.md`
- `docs/phase2-git-multilanguage-consistency-prereview-codex-plan-ja.md`
- `docs/phase3-process-bob-workflows-codex-plan-ja.md`

## 29. 推奨コミット

```text
docs: add GUI first operation design plan
```
