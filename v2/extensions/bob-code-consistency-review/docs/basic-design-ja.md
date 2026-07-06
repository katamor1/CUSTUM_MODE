# bob-code-consistency-review 基本設計書

## 1. 目的

`bob-code-consistency-review` は、コード変更と要求書・基本設計書・詳細設計書・テスト仕様書の整合性を、正式レビュー前に IBM Bob でプレレビューするための VS Code 拡張機能である。

本拡張は、Bob にコードや文書をそのまま大量投入するのではなく、事前処理で差分、文書抜粋、コード解析結果、対応候補、根拠 ID をまとめた `review-package` を生成する。Bob はこの固定済みパッケージだけを根拠として、不整合候補、確認事項、推奨対応を抽出する。最終判断は人間が行う。

## 2. 背景と課題

コード変更と仕様書類の整合レビューでは、次の課題がある。

- コード差分、要求、設計、テスト仕様が別ファイルに分散している。
- Word、Excel、Markdown など文書形式が混在する。
- Git / Bazaar など VCS 差分の取得方法が環境により異なる。
- Bob に全量投入すると、対象外情報の混入、根拠不明な断定、トークン過多が起きやすい。
- C / C++ の変更箇所、変更関数、関連 caller / callee、グローバル変数候補などを事前に整理したい。
- Bob の指摘が、どの文書・コード根拠に基づくかを `evidence_id` で追跡したい。
- 上流仕様に直接 ID を書き込めない場合でも、sidecar catalog で traceability ID と承認状態を管理したい。
- `review-input.yaml` の初期作成、AI draft、診断、修復を補助したい。
- Bob 出力を schema と evidence index で検証し、人間 triage へつなげたい。
- workflow として配布できる初期 `WORKFLOW.md`、`review-input.yaml` 雛形、仮文書が必要である。

## 3. スコープ

### 3.1 対象範囲

- `.bob/workflows/code-consistency-review/WORKFLOW.md` の初期化・更新・backup。
- `review-input.yaml` 雛形と `docs/review-input-placeholder.md` の初期作成。
- 対話式 `review-input.yaml` 作成 UI。
- `review-input.yaml` の読み込み、schema 検証、診断、legacy repair。
- AI draft 用 prompt の生成、AI draft JSON の適用。
- traceability sidecar catalog の読み込み、編集、検証、gate report 生成。
- traceability AI draft 用 prompt の生成、AI draft JSON の catalog 反映。
- traceability catalog からの `review-input.yaml` 生成。
- Git 差分、rename、空白入り path、binary numstat、変更言語分類の収集。
- review input で `review.vcs` が Bazaar / bzr の場合の Bazaar 差分取得。
- Markdown / Word `.docx` / Excel `.xlsx` からの根拠抜粋。
- C / C++ の軽量変更解析。
- C / C++ 以外の対応言語に対する diff hunk 単位の汎用コード根拠生成。
- traceability map の生成。
- `review-package` の生成。
- Bob 投入用 `bob-input.md` と prompt template の生成。
- Bob 出力 YAML の抽出、正規化、保存。
- Bob 出力 YAML の schema 検証と evidence 参照検証。
- 人間 triage ファイルの生成。
- `workflow-register` action provider としての連携。

### 3.2 対象外

- 正式レビューの承認。
- Bob 出力の自動採用。
- 任意ファイル全探索による根拠の推測。
- commit、push、PR コメント投稿などの副作用。
- clang AST 等による完全な C / C++ 意味解析。
- 関数ポインタ、マクロ展開、include graph を含む完全な静的解析。
- 文書全量の Bob 投入。
- 上流仕様書への traceability ID 直接書き込み。

## 4. 利用者と利用シーン

| 利用者 | 主な用途 |
| --- | --- |
| 開発者 | 変更内容と関連文書を指定し、Bob 用 review-package を生成する。 |
| レビュー担当者 | Bob の不整合候補を確認し、正式レビュー前の観点漏れを減らす。 |
| 設計担当者 | 要求・設計・テスト仕様とコード差分の対応関係を確認する。 |
| traceability 管理者 | sidecar catalog で ID、link、decision、gate report を管理する。 |
| 人間 triage 担当者 | Bob 出力を採用・棄却・追加調査に振り分ける。 |
| ワークフロー設計者 | `workflow-register` の step から本拡張の処理を呼び出す。 |
| 導入担当者 | 初期化コマンドで workflow template と review-input 雛形を配置する。 |

## 5. 全体構成

```text
VS Code Extension Host
  └─ bob-code-consistency-review
       ├─ extension.ts
       ├─ extensionCommandOptions.ts
       ├─ workflowProviderRegistration.ts
       ├─ workspaceInitializer.ts
       ├─ reviewInputWizard.ts
       ├─ reviewExecutionCommands.ts
       ├─ traceabilityCommands.ts
       ├─ core/
       │    ├─ reviewInputBuilder / Discovery / AiDraft / Diagnostics
       │    ├─ traceabilityCatalog / Store / Validation / PrepController
       │    ├─ languageClassifier / gitDiffCollector / pipeline / reviewPackageBuilder
       │    ├─ bobOutputCapture / bobOutputValidator
       │    └─ textEncoding / fileSystem / schemaLoader
       ├─ analyzers/
       │    ├─ documentExtractor
       │    ├─ codeChangeAnalyzer
       │    ├─ cCppChangeAnalyzer
       │    ├─ genericCodeEvidenceAnalyzer
       │    └─ traceabilityBuilder
       ├─ webview/traceabilityPrepWebview
       └─ triage/humanTriageHelper

workflow-register
  └─ bobCodeConsistency.* action providers
```

## 6. 主要コンポーネント

| コンポーネント | 主な責務 | 主なファイル |
| --- | --- | --- |
| Extension Entry | VS Code command 登録、workflow-register provider mapping | `src/extension.ts` |
| Command Options | option / prompt / path / notification helper | `src/extensionCommandOptions.ts` |
| Workflow Provider Registration | 15 provider の登録、workflow input / args / state の統合 | `src/workflowProviderRegistration.ts` |
| Workspace Initializer | workflow template、review-input 雛形、placeholder document の作成・更新・backup | `src/workspaceInitializer.ts` |
| Workspace Resolver | Bob workspace root の解決 | `src/workspaceResolver.ts` |
| Review Input Wizard | 対話式 `review-input.yaml` 作成 UI | `src/reviewInputWizard.ts` |
| Review Input Builder | AI / wizard draft から validated `review-input.yaml` を生成 | `src/core/reviewInputBuilder.ts` |
| Review Input Discovery | `docs` 配下の Markdown / docx / xlsx 候補と ID を抽出 | `src/core/reviewInputDiscovery.ts` |
| Review Input AI Draft | AI draft prompt 生成と JSON 適用 | `src/core/reviewInputAiDraftProvider.ts` |
| Review Input Diagnostics | 既存 input の診断と legacy repair | `src/core/reviewInputDiagnostics.ts` |
| Traceability Catalog | sidecar catalog model、validation、review-input draft 生成 | `src/core/traceability*.ts` |
| Traceability Commands | AI draft、catalog 検証、Webview、review-input 生成 | `src/traceabilityCommands.ts` |
| Traceability Prep Webview | domains / items / links / decisions / gate / preview 編集 UI | `src/webview/traceabilityPrepWebview.ts` |
| Review Input Validator | `review-input.yaml` の schema 検証と関連文書存在確認 | `src/core/reviewInputValidator.ts` |
| Language Classifier | 拡張子から review 対応言語を分類し、`analysis_options.language` filter と diff collector で共有する | `src/core/languageClassifier.ts` |
| Git / Bazaar Diff Collector | 差分、変更ファイル、numstat、unified diff の収集 | `src/core/gitDiffCollector.ts` |
| Text Encoding | UTF-8 / Shift-JIS / CP932 系 decode | `src/core/textEncoding.ts` |
| Document Extractor | Markdown / docx / xlsx から根拠抜粋を生成 | `src/analyzers/documentExtractor.ts` |
| Code Change Analyzer | C / C++ 深掘り解析と汎用コード根拠生成を統合する orchestrator | `src/analyzers/codeChangeAnalyzer.ts` |
| C/C++ Change Analyzer | 変更関数、call graph 候補、define / global / RT 禁止候補の抽出 | `src/analyzers/cCppChangeAnalyzer.ts` |
| Generic Code Evidence Analyzer | 詳細解析対象外の言語でも diff hunk 単位の `SRC-*` evidence と `code-slices/*.md` を生成 | `src/analyzers/genericCodeEvidenceAnalyzer.ts` |
| Traceability Builder | 文書根拠とコード根拠の対応候補を作る | `src/analyzers/traceabilityBuilder.ts` |
| Review Package Builder | review-package のファイル群と `bob-input.md` を生成 | `src/core/reviewPackageBuilder.ts` |
| Bob Output Capture | Bob 出力 YAML を抽出して保存 | `src/core/bobOutputCapture.ts` |
| Bob Output Validator | YAML schema と evidence 参照を検証 | `src/core/bobOutputValidator.ts` |
| Human Triage Helper | 人間確認用 triage ファイルを生成 | `src/triage/humanTriageHelper.ts` |
| Prompt Templates | Bob 投入用 prompt template | `src/templates/*` |

## 7. 入力モデル

### 7.1 `review-input.yaml`

`review-input.yaml` は整合プレレビューの起点である。

| 項目 | 説明 |
| --- | --- |
| `review.id` | レビュー ID。成果物や Bob 出力の紐付けに使う。 |
| `review.title` | レビュー表示名。 |
| `review.change_type` | `bugfix` / `feature` / `spec_change` / `refactor` / `performance` / `maintenance`。 |
| `review.purpose` | 変更目的。 |
| `review.base` / `review.head` | Git / Bazaar diff の比較範囲。 |
| `review.vcs` | `git` / `bazaar` / `bzr`。 |
| `review.vcs_root` | VCS root を workspace root と分ける場合の path。 |
| `artifacts` | 要求、基本設計、詳細設計、テスト仕様、台帳、チケットの関連文書。 |
| `review_focus` | Bob に重点確認させる整合観点。 |
| `analysis_options` | 解析深度、言語、台帳利用などのオプション。 |
| `bob_options` | prompt template、output format、evidence 必須など。 |

`analysis_options.language` は任意である。未指定の場合、C / C++、TypeScript、JavaScript、Python、C#、Java、Go、Rust、Shell、SQL、JSON、YAML、Markdown、text、unknown を含む全対応言語を対象にする。指定した場合だけ、その言語集合に変更ファイルをフィルタする。

### 7.2 ReviewInputDraft

Wizard / AI / traceability からは最終 YAML ではなく `ReviewInputDraft` を作る。builder が enum、path、schema、既定値を検証・補完して `review-input.yaml` を生成する。

主な enum は次の通り。

- `review_focus`: `requirement-code-consistency`、`design-code-consistency`、`test-gap`、`document-update-gap`、`unintended-change`、`interface-impact`、`rt-ts-rule`、`shared-memory-impact`
- `focus_preset`: `standard`、`document_update`、`interface`、`rt_shared_memory`、`test_gap`
- `artifact.kind`: `requirements`、`basic_design`、`detailed_design`、`test_spec`、`ledgers`、`tickets`

## 8. Traceability sidecar モデル

Traceability catalog は `.bob-trace/traceability-catalog.json` に保存する sidecar であり、上流文書を変更せずに ID、link、decision を管理する。

| 要素 | 説明 |
| --- | --- |
| `documents` | `document_id`、`source_path`、`id_source` を持つ。 |
| `domains` | ドメイン code、label、alias、status を持つ。 |
| `items` | requirement / basic_design / detailed_design / test_spec / qa_item / review_finding。 |
| `links` | satisfies / elaborates / verified_by / clarifies / reviewed_by / references。 |
| `decisions` | gate 単位の `n/a` decision と理由。 |

status は `proposed`、`accepted`、`rejected`、`deprecated` である。`accepted` item だけが `review-input.yaml` 生成に使われる。

## 9. 出力モデル

### 9.1 `review-package`

既定の出力先は `.bob-review/review-package` である。

| ファイル | 用途 |
| --- | --- |
| `manifest.yaml` | package 作成情報、対象範囲、template ID、evidence 件数。 |
| `input-normalized.json` | 検証済み `review-input.yaml` の正規化結果。 |
| `changed-files.json` | VCS 差分から得た変更ファイル一覧。 |
| `changed-symbols.json` | C / C++ の変更関数、define、global、call graph、RT 候補、および汎用言語のファイル単位シンボル。 |
| `document-index.json` | documents と warning。 |
| `evidence-index.json` | Bob 出力検証に使う evidence metadata。本文は含めない。 |
| `traceability-map.json` | traceability rows と warning。 |
| `change-summary.md` | 変更目的、変更ファイル、根拠件数の要約。 |
| `diff-context.md` | コードスライスと raw unified diff。 |
| `document-excerpts.md` | 文書から抽出した根拠抜粋。 |
| `traceability-map.md` | 対応候補の人間向け表示。 |
| `deterministic-checks.md` | warning と決定論的チェック結果。 |
| `bob-input.md` | Bob に投入する最終 Markdown。 |
| `prompts/*.md` | Bob 用 prompt template。 |
| `code-slices/*.md` | コード根拠ごとの Markdown。 |
| `tables/*.md` | 表形式 evidence の個別 Markdown。 |

### 9.2 Bob output / triage

Bob 出力は YAML として扱い、既定では `.bob-review/bob-output/bob-output.yaml` に保存する。人間 triage の既定出力先は `.bob-review/human-triage` である。

| ファイル | 用途 |
| --- | --- |
| `triage-result.yaml` | finding / question ごとの人間判断を記録する。 |
| `accepted-findings.md` | 採用候補の指摘。 |
| `questions-to-author.md` | 作成者への確認事項。 |
| `rejected-findings.md` | 棄却指摘と理由の記録。 |
| `follow-up-actions.md` | 後続対応一覧。 |

### 9.3 `.bob-trace`

| ファイル | 用途 |
| --- | --- |
| `.bob-trace/traceability-catalog.json` | sidecar traceability catalog。 |
| `.bob-trace/gate-report.md` | catalog validation / gate report。 |
| `.bob-trace/ai-traceability-draft/ai-draft-prompt.md` | AI draft 用 prompt。 |
| `.bob-trace/ai-traceability-draft/ai-draft*.json` | AI draft JSON の既定探索先。 |

## 10. 処理フロー

### 10.1 workspace 初期化

`bobCodeConsistency.initializeWorkspace` は次を行う。

1. 同梱 workflow template を `.bob/workflows/code-consistency-review/WORKFLOW.md` へ配置する。
2. 既存 workflow が template と異なる場合は backup を作成して更新する。
3. `review-input.yaml` が無い場合は雛形を作成する。
4. 雛形作成時は `docs/review-input-placeholder.md` を作成する。
5. 既存 `review-input.yaml` が雛形と異なる場合は上書きせず、backup だけ作成する。

### 10.2 review-input 作成 / AI draft

- `createReviewInput` は `docs` 配下の Markdown / docx / xlsx を探索し、Wizard で draft を作り、builder で `review-input.yaml` を生成する。
- `prepareAiReviewInputDraft` は diff summary、既存 diagnostics、document candidates、enum を含む JSON 専用 prompt を `.bob-review/review-input-draft/ai-draft-prompt.md` に生成し、clipboard にコピーして開く。
- `applyAiReviewInputDraft` は inline JSON / fenced JSON / clipboard text を draft として parse し、builder で `review-input.yaml` を生成する。
- `repairReviewInput` は legacy input の修復を試みる。
- `explainReviewInputDiagnostics` は diagnostics を人間向けに説明する。

### 10.3 traceability prep

- `openTraceabilityPrep` は Webview を開き、Domains / Items / Links / Decisions / Gate Report / Review Input Preview を表示する。
- `validateTraceabilityCatalog` は catalog を検証し、gate report を生成する。
- `prepareAiTraceabilityDraft` は catalog、diff summary、docs root、enum を含む prompt を `.bob-trace/ai-traceability-draft` に生成する。
- `captureAiTraceabilityDraft` は proposed-only draft JSON を検証し、workflow state へ渡す。
- `applyAiTraceabilityDraft` は inline JSON、clipboard、path、既定 `ai-draft*.json` から draft を読み、catalog に反映し、gate report を更新する。
- `createReviewInputFromTraceability` は accepted item から artifact candidate を作り、`review-input.yaml` を生成する。

### 10.4 前処理

`preprocessReview()` は次の順で処理する。

1. `review-input.yaml` を検証する。
2. Git または Bazaar diff を収集し、変更ファイルの言語を分類する。
3. 文書根拠を抽出する。
4. `codeChangeAnalyzer` で C / C++ は軽量解析し、その他の対応言語は diff hunk 単位の汎用コード根拠を生成する。
5. traceability map を作る。
6. review-package を生成する。

### 10.5 Bob 出力取り込み・検証・triage

1. `captureBobOutput` は command argument、options、workflow state / inputs / args、clipboard から YAML text を決める。
2. fenced YAML block、`schema_version:` 開始 text、text 中の `schema_version:` 以降を抽出する。
3. YAML parse に成功したら正規化し、`bobOutputPath` に保存する。
4. `validateOutput` は schema と `evidence-index.json` で検証する。
5. `triage` は人間確認用ファイルを生成する。

## 11. workflow-register 連携

本拡張は次の action provider を `workflow-register` に登録する。

| Provider | 処理 |
| --- | --- |
| `bobCodeConsistency.initializeWorkspace` | workflow template と review-input 雛形を初期化する。 |
| `bobCodeConsistency.createReviewInput` | 対話式に `review-input.yaml` を作成する。 |
| `bobCodeConsistency.prepareAiReviewInputDraft` | review-input AI draft 用 prompt を生成する。 |
| `bobCodeConsistency.applyAiReviewInputDraft` | AI draft JSON から `review-input.yaml` を生成する。 |
| `bobCodeConsistency.prepareAiTraceabilityDraft` | traceability AI draft 用 prompt を生成する。 |
| `bobCodeConsistency.captureAiTraceabilityDraft` | traceability AI draft JSON を取り込む。 |
| `bobCodeConsistency.applyAiTraceabilityDraft` | AI draft JSON を catalog に反映する。 |
| `bobCodeConsistency.openTraceabilityPrep` | traceability prep Webview を開く。 |
| `bobCodeConsistency.validateTraceabilityCatalog` | catalog を検証し gate report を生成する。 |
| `bobCodeConsistency.createReviewInputFromTraceability` | accepted traceability item から `review-input.yaml` を生成する。 |
| `bobCodeConsistency.repairReviewInput` | `review-input.yaml` を修復する。 |
| `bobCodeConsistency.explainReviewInputDiagnostics` | `review-input.yaml` 診断を説明する。 |
| `bobCodeConsistency.preprocess` | review-package を生成する。 |
| `bobCodeConsistency.captureBobOutput` | Bob 出力 YAML を取り込む。 |
| `bobCodeConsistency.validateOutput` | Bob 出力を schema と evidence index で検証する。 |
| `bobCodeConsistency.triage` | 人間 triage 成果物を生成する。 |

workflow 実行時は `input.inputs`、`input.args`、`workflowRoot`、`workflowFile`、`workflowFolderName`、`bobRoot`、`workspaceRoot` を統合する。`captureBobOutput` は workflow state / inputs / args から Bob 出力候補を組み立てる。`applyAiTraceabilityDraft` は `state.traceabilityDraftJson` も入力候補にする。

## 12. 同梱 workflow

同梱 template:

```text
templates/.bob/workflows/code-consistency-review/WORKFLOW.md
```

現行 template は `schemaVersion: workflow-register/v1`、`requires`、`guardrails.requireApproval`、`inputs`、`tools`、`artifacts`、`completion`、typed `steps` を持つ。

主な step:

| Step | Type | Provider / 処理 |
| --- | --- | --- |
| `preprocess-review-package` | command | `bobCodeConsistency.preprocess` |
| `run-bob-pre-review` | agent | `bob-input.md` に基づく整合プレレビュー |
| `capture-bob-output` | command | `bobCodeConsistency.captureBobOutput` |
| `validate-bob-output` | command | `bobCodeConsistency.validateOutput` |
| `human-triage` | command | `bobCodeConsistency.triage` |
| `handoff-formal-review` | agent | 正式レビューへの引き継ぎ Markdown を作る |

## 13. Bob にさせること / させないこと

| 区分 | 方針 |
| --- | --- |
| 拡張機能が行うこと | 入力検証、差分収集、文書抜粋、コード根拠抽出、対応候補作成、Bob 入力生成、Bob 出力検証、triage 生成。 |
| Bob にさせること | `review-package` に含まれる根拠だけを使い、意味的な不整合候補、確認事項、推奨対応を抽出する。 |
| 人間が行うこと | 指摘の採用判断、棄却理由、追加調査、正式レビュー、最終承認。 |
| Bob にさせないこと | 正式承認、根拠なし断定、対象外ファイル推測、大量ファイル探索、破壊的操作、コミットや PR 更新。 |

## 14. セキュリティと安全設計

- Bob に投入する前に、根拠を `review-package` として固定する。
- Bob 入力は根拠 ID 付き抜粋に限定する。
- 文書やコードの全量投入は避ける。
- Bob 出力は YAML schema と `evidence-index.json` で検証する。
- 存在しない `evidence_id` を参照する finding / question はエラーにする。
- 解析不能な情報は warning として保存する。
- 承認判断は必ず人間が行う。
- 通常フローに commit、push、PR コメント投稿などの副作用を含めない。
- `ReviewInputBuilder` は artifact path escape を拒否する。
- traceability draft JSON path は workspace 内に限定する。

## 15. エラー処理方針

| 場面 | 方針 |
| --- | --- |
| `review-input.yaml` 不正 | schema error として処理を中止する。 |
| 関連文書欠落 | missing artifact として処理を中止する。 |
| Git / Bazaar diff 収集失敗 | preprocess を失敗させる。 |
| 文書抽出失敗 | warning に記録し、可能な範囲で続行する。 |
| 変更関数を特定できない | warning に記録する。 |
| AI draft JSON 不正 | apply result を error にする。 |
| traceability catalog 不正 | gate report に error を出し、review-input 生成を止める。 |
| Bob 出力 YAML 不在 | capture 結果を error とする。 |
| Bob 出力 schema 不一致 | validation error とする。 |
| evidence 参照不一致 | validation error とする。 |
| triage 入力不備 | triage 生成を失敗させる。 |
| workflow template 初期化 | 既存ファイルを backup して更新する。 |
| 既存 review-input | 上書きせず backup のみ作成する。 |

## 16. テスト方針

- workspace initializer の workflow / review-input / placeholder 作成、更新、backup を検証する。
- review-input wizard / discovery / builder / AI draft / diagnostics / repair を検証する。
- traceability catalog、validation、gate report、Webview controller、AI draft 適用、review-input 生成を検証する。
- `review-input.yaml` schema validation を検証する。
- language classifier と Git / Bazaar diff collector の changed files / language 判定を検証する。
- Markdown / docx / xlsx の文書抽出を検証する。
- C / C++ 変更解析の changed function / code evidence 生成を検証する。
- 汎用コード根拠生成の hunk evidence / code-slices 生成を検証する。
- `review-package` の生成ファイル一覧と内容を検証する。
- Bob output capture の fenced YAML 抽出を検証する。
- Bob output validator の schema / evidence 参照検証を検証する。
- triage 生成ファイルを検証する。
- workflow-register provider 登録と option merge を検証する。
- 同梱 workflow template の requires / guardrails / steps を検証する。
- 実機では VS Code / IBM Bob / workflow-register / Bob Workflow UI / traceability Webview / 実文書形式を含む操作を確認する。

詳細な単体テスト仕様は `unit-test-spec-ja.md`、実機テスト仕様は `real-machine-test-spec-ja.md` に定義する。

## 16. 今後の拡張方針

- clang AST 連携による C / C++ 解析強化。
- 関数ポインタ、構造体メンバ、グローバル変数影響の解析強化。
- 文書 ID / section ID のより厳密な対応付け。
- Redmine / ticket system 連携。
- review-package の差分比較と再利用。
- workflow-register の result handoff を使った Bob 出力自動取り込み強化。
- 人間 triage 結果から正式レビュー用コメントを生成する補助機能。
