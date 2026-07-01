# Bob Code Consistency Review（コード整合プレレビュー）

`bob-code-consistency-review` は、コード変更と要求書・基本設計書・詳細設計書・テスト仕様書の整合性を、正式レビュー前に IBM Bob でプレレビューするための VS Code 拡張機能です。

この拡張機能は、Bob にコードや文書をそのまま渡すのではなく、事前に差分、文書抜粋、コード解析結果、対応候補、根拠 ID をまとめた `review-package` を生成します。Bob はそのパッケージをもとに意味的な不整合候補を抽出し、人間が最終的に採用・棄却・追加調査を判断します。

この README では、コマンド名、設定キー、JSON / YAML のフィールド名、ファイル名、識別子は実装上の名称として原文のまま記載します。

## できること

- `review-input.yaml` を読み込み、対象レビュー、比較範囲、関連文書、レビュー観点を検証する。
- `ReviewInputDraft` から正式な `review-input.yaml` を生成し、保存前に schema と文書パスを検証する。
- AI には最終 YAML を書かせず、候補文書・diff summary・診断を渡して `ReviewInputDraft` JSON だけを返させる。
- `docs/**/*.md|docx|xlsx` から関連文書候補と `REQ-*`、`BD-*`、`DD-*`、`TC-*`、`TICKET-*` などの ID 候補を抽出する。
- Git / Bazaar、base / head、変更種別、関連文書、レビュー観点を対話式に選択して `review-input.yaml` を作成する。
- Git 差分から変更ファイル、変更行、C / C++ の変更関数候補を抽出する。
- Markdown、Word `.docx`、Excel `.xlsx` から、要求・設計・テスト仕様・台帳などの根拠抜粋を作る。
- 変更コードと文書抜粋を `evidence_id` 付きで `review-package` に整理する。
- Bob 投入用の `bob-input.md` と prompt template 一式を生成する。
- Bob 出力 YAML を clipboard / selection / text から取り込み、正規化して保存する。
- Bob 出力 YAML を schema と `evidence-index.json` に照らして検証する。
- 人間確認用の triage ファイルを生成する。
- `workflow-register` の action provider として、ワークフローステップから実行できる。

## 依存関係

```json
"extensionDependencies": [
  "IBM.bob-code",
  "local.workflow-register"
]
```

導入順は次を推奨します。

1. `IBM.bob-code`
2. `workflow-register`
3. `bob-code-consistency-review`

## 代表的な利用フロー

1. Bob IDE / VS Code で対象ワークスペースを開く。
2. `Bob コード整合: コード整合レビュー: .bob ワークフロー定義と review-input 雛形を初期化` を実行し、`.bob/workflows/.../WORKFLOW.md` と `review-input.yaml` の雛形を作成する。
3. 手書きする代わりに `Bob コード整合: コード整合レビュー: 対話式に review-input.yaml を作成` で、短いドラフトと候補選択から `review-input.yaml` を生成する。
4. AI を使う場合は `Bob コード整合: コード整合レビュー: AI draft 用プロンプトを作成` でプロンプトを作り、AI の JSON 応答を `Bob コード整合: コード整合レビュー: AI draft JSON から review-input.yaml を生成` で取り込む。
5. `review-input.yaml` の `review`、`artifacts`、`review_focus` を必要に応じて確認する。
6. `Bob Code Consistency: Preprocess Code Consistency Review` を実行する。
7. 生成された `.bob-review/review-package/bob-input.md` を Bob に渡し、整合プレレビューを実行する。
8. Bob の YAML 出力をコピーし、`Bob Code Consistency: Capture Code Consistency Bob Output` で保存する。
9. `Bob Code Consistency: Validate Code Consistency Bob Output` で schema と evidence 参照を検証する。
10. `Bob Code Consistency: Generate Code Consistency Human Triage` で人間確認用ファイルを生成する。
11. 人間が triage 結果を確認し、正式レビューや修正作業へ回す指摘を判断する。

## Command Palette のコマンド

| コマンド | 内部 command ID | 用途 |
| --- | --- | --- |
| `Bob コード整合: コード整合レビュー: .bob ワークフロー定義と review-input 雛形を初期化` | `bobCodeConsistency.initializeWorkspace` | `.bob/workflows/code-consistency-review/WORKFLOW.md` と `review-input.yaml` の雛形を作成する。既存 `review-input.yaml` は上書きせず、バックアップだけ作成する。 |
| `Bob コード整合: コード整合レビュー: 対話式に review-input.yaml を作成` | `bobCodeConsistency.createReviewInput` | Git / Bazaar、base / head、変更種別、関連文書候補、レビュー観点を選び、`ReviewInputBuilder` 経由で `review-input.yaml` を生成する。 |
| `Bob コード整合: コード整合レビュー: AI draft 用プロンプトを作成` | `bobCodeConsistency.prepareAiReviewInputDraft` | diff summary、関連文書候補、schema enum、既存 YAML 診断をまとめた AI draft 用 Markdown を作成し clipboard にコピーする。 |
| `Bob コード整合: コード整合レビュー: AI draft JSON から review-input.yaml を生成` | `bobCodeConsistency.applyAiReviewInputDraft` | AI が返した `ReviewInputDraft` JSON を clipboard / 引数から読み、`ReviewInputBuilder` と validator を通して `review-input.yaml` に保存する。 |
| `Bob コード整合: コード整合レビュー: review-input.yaml を自動修復` | `bobCodeConsistency.repairReviewInput` | 古い `review_focus` 名を現行 schema enum へ置換し、バックアップ後に保存する。 |
| `Bob コード整合: コード整合レビュー: review-input.yaml 診断を説明` | `bobCodeConsistency.explainReviewInputDiagnostics` | `review-input.yaml` の schema / 文書パス診断を表示する。 |
| `Bob Code Consistency: Preprocess Code Consistency Review` | `bobCodeConsistency.preprocess` | `review-input.yaml`、Git 差分、文書、コード解析結果から `review-package` を生成する。 |
| `Bob Code Consistency: Capture Code Consistency Bob Output` | `bobCodeConsistency.captureBobOutput` | Bob が出力した YAML を clipboard または引数から抽出し、`bob-output.yaml` として保存する。 |
| `Bob Code Consistency: Validate Code Consistency Bob Output` | `bobCodeConsistency.validateOutput` | Bob 出力 YAML を schema と evidence index で検証する。 |
| `Bob Code Consistency: Generate Code Consistency Human Triage` | `bobCodeConsistency.triage` | Bob 出力から人間確認用の triage 成果物を生成する。 |

## 設定

| 設定 | 既定値 | 説明 |
| --- | --- | --- |
| `bobCodeConsistency.reviewInputPath` | `review-input.yaml` | 入力 YAML のワークスペース相対パス。 |
| `bobCodeConsistency.reviewPackagePath` | `.bob-review/review-package` | 生成する review-package のワークスペース相対パス。 |
| `bobCodeConsistency.bobOutputPath` | `.bob-review/bob-output/bob-output.yaml` | 取り込んだ Bob 出力 YAML の保存先。 |
| `bobCodeConsistency.triagePath` | `.bob-review/human-triage` | 人間 triage ファイルの出力先。 |
| `bobCodeConsistency.textEncoding` | `auto` | `review-input.yaml`、Markdown 文書、C/C++ ソース、Git/Bazaar 差分 stdout、diff fixture の読み取り文字コード。`auto` / `utf8` / `shift_jis` / `cp932` / `windows-31j` を指定できます。 |

各コマンドは、ワークフローや他拡張からの呼び出し時に同名オプションを受け取れます。たとえば `reviewInputPath`、`reviewPackagePath`、`textEncoding`、`bobOutputPath`、`triagePath` を入力値や `args` で渡すと、設定値より優先されます。

## ワークスペース初期化

`bobCodeConsistency.initializeWorkspace` は、ワークスペースに次のファイルを作成します。

```text
.bob/
  workflows/
    code-consistency-review/
      WORKFLOW.md
review-input.yaml
docs/
  review-input-placeholder.md
```

- `WORKFLOW.md` は同梱テンプレートと差分があれば、既存ファイルを `.bak-<timestamp>` に退避して更新します。
- `review-input.yaml` が存在しない場合は、schema に沿った最小雛形を作成します。
- `review-input.yaml` が既に存在する場合は、実案件の入力を壊さないため上書きしません。代わりに `.bak-<timestamp>` を作成します。
- 雛形が参照する `docs/review-input-placeholder.md` は仮文書です。実レビューでは実際の要求書・設計書・テスト仕様書に差し替えてください。

## Draft -> Builder -> Validator

`review-input.yaml` を人が直接フル手書きする代わりに、次の流れを使います。

```text
人間 / AI / CLI
  -> ReviewInputDraft
  -> ReviewInputBuilder
  -> schema validator + artifact path validation
  -> review-input.yaml
```

`ReviewInputDraft` は短いドラフトです。正式な YAML と違い、候補選択結果をそのまま持ちます。

```ts
export type ReviewInputDraft = {
  review: {
    id?: string
    title?: string
    change_type?: string
    purpose?: string
    base?: string
    head?: string
    vcs?: string
    ticket_ids?: string[]
    out_of_scope?: string[]
  }
  artifact_candidates: Array<{
    kind: "requirements" | "basic_design" | "detailed_design" | "test_spec" | "ledgers" | "tickets"
    path: string
    sections?: string[]
    sheets?: string[]
    rows?: string[]
    cases?: string[]
  }>
  focus_preset?: "standard" | "document_update" | "interface" | "rt_shared_memory" | "test_gap"
  review_focus?: string[]
}
```

`ReviewInputBuilder` は次を保証します。

- `review_focus`、`change_type`、`vcs`、`artifact.kind` は schema で許可された値だけを受け付ける。
- `artifact.path` は保存前にワークスペース上の実在パスとして検証する。
- `review_focus` が未指定の場合は `focus_preset` から展開する。
- `analysis_options` と `bob_options` は安全な既定値で補完する。
- 既存 `review-input.yaml` へ保存する場合は `.bak-<timestamp>` を作成する。

## AI draft provider

AI 支援は、最終 YAML 生成ではなく `ReviewInputDraft` JSON の補助に限定します。

```text
prepareAiReviewInputDraft
  -> diff summary / artifact candidates / diagnostics / enum constraints を Markdown 化
  -> clipboard と .bob-review/review-input-draft/ai-draft-prompt.md に保存
  -> AI に投入
  -> AI は JSON object だけを返す
applyAiReviewInputDraft
  -> clipboard / 引数から JSON を抽出
  -> JSON parse
  -> ReviewInputBuilder
  -> schema validator + artifact path validation
  -> review-input.yaml
```

AI draft プロンプトには次の制約を含めます。

- 出力は JSON object のみ。Markdown、YAML、説明文は禁止。
- `artifact_candidates[].path` は候補一覧に存在する path のみ許可。
- `artifact_candidates[].kind`、`review.change_type`、`review.vcs`、`review_focus` は schema enum のみ許可。
- AI が存在しない文書パスや enum を返しても、`applyAiReviewInputDraft` 側の builder / validator で保存不可にする。
- 最終承認や人間確認不要などの判断は AI にさせない。

## `review-input.yaml`

`review-input.yaml` は整合プレレビューの入口です。schema 検証に加えて、指定された関連文書ファイルが存在することも確認します。

最小イメージは次の通りです。

```yaml
schema_version: 1
review:
  id: timeout-bugfix-r1
  title: タイムアウト処理修正の整合プレレビュー
  change_type: bugfix
  purpose: タイムアウト時の戻り値を要求仕様どおりに修正する
  base: HEAD~1
  head: HEAD
  vcs: git
  ticket_ids:
    - BUG-1234
artifacts:
  requirements:
    - path: docs/requirements-timeout.md
      sections:
        - REQ-TIMEOUT-001
  basic_design:
    - path: docs/basic-design-timeout.md
      sections:
        - BD-TIMEOUT-001
  detailed_design:
    - path: docs/detailed-design-timeout.md
      sections:
        - DD-TIMEOUT-001
  test_spec:
    - path: docs/test-spec-timeout.md
      cases:
        - TC-TIMEOUT-001
  ledgers:
    - path: docs/error-ledger.xlsx
      sheets:
        - errors
review_focus:
  - requirement-code-consistency
  - design-code-consistency
  - test-gap
analysis_options:
  include_callers: true
  include_callees: true
  include_global_access: true
  include_struct_impact: true
  include_ledgers: true
  max_call_depth: 2
  max_code_context_lines: 80
  language:
    - c
    - h
```

`review_focus` は schema で次の値に制限されています。

| 値 | 用途 |
| --- | --- |
| `requirement-code-consistency` | 要求とコード変更の整合性を見る。 |
| `design-code-consistency` | 基本設計・詳細設計とコード変更の整合性を見る。 |
| `test-gap` | 変更に対するテスト仕様・テスト観点の不足を見る。 |
| `document-update-gap` | コード変更に対して文書更新が不足していないかを見る。 |
| `unintended-change` | 要求・設計に現れない意図しない変更候補を見る。 |
| `interface-impact` | API、DLL export、共有ヘッダなどのインターフェース影響を見る。 |
| `rt-ts-rule` | RT / TS 制約や禁止処理への影響を見る。 |
| `shared-memory-impact` | 共有メモリやグローバルデータ構造への影響を見る。 |

## 前処理で生成する `review-package`

`bobCodeConsistency.preprocess` は、既定では `.bob-review/review-package` に次のファイル群を生成します。

```text
.bob-review/
  review-package/
    manifest.yaml
    input-normalized.json
    changed-files.json
    changed-symbols.json
    document-index.json
    evidence-index.json
    traceability-map.json
    change-summary.md
    diff-context.md
    document-excerpts.md
    traceability-map.md
    deterministic-checks.md
    bob-input.md
    prompts/
      system.md
      task.md
      output-format.md
    code-slices/
      <evidence_id>.md
    tables/
      <evidence_id>.md
```

主な役割は次の通りです。

| ファイル | 用途 |
| --- | --- |
| `manifest.yaml` | review-package の作成情報、対象範囲、テンプレート ID、根拠件数を記録する。 |
| `input-normalized.json` | 検証済み `review-input.yaml` を正規化して保存する。 |
| `changed-files.json` | Git 差分から得た変更ファイル一覧と warning を保存する。 |
| `changed-symbols.json` | 変更関数、define、global 候補、call graph、RT 禁止処理候補を保存する。 |
| `document-index.json` | 抽出対象文書、文書種別、section と evidence の対応を保存する。 |
| `evidence-index.json` | Bob 出力検証で参照する evidence 一覧を保存する。本文は除外する。 |
| `traceability-map.json` / `traceability-map.md` | 要求・設計・コード・テスト仕様の対応候補を保存する。 |
| `change-summary.md` | 変更目的、変更ファイル、文書・コード根拠件数の要約。 |
| `diff-context.md` | 変更関数のコードスライスと raw unified diff。 |
| `document-excerpts.md` | 文書から抽出した根拠抜粋。 |
| `deterministic-checks.md` | 抽出 warning、重複 evidence ID などの決定論的チェック結果。 |
| `bob-input.md` | Bob に投入する最終入力 Markdown。 |

## 文書抽出

関連文書は `review-input.yaml` の `artifacts` から読み込みます。

対応している主な文書形式は次の通りです。

| 拡張子 | 抽出方法 |
| --- | --- |
| `.md` / `.markdown` | Markdown 見出し単位でブロック化し、`sections` / `cases` / `rows` 指定に合う抜粋を抽出する。 |
| `.docx` | `mammoth` で HTML 化し、見出し、段落、表を抽出する。 |
| `.xlsx` | `xlsx` でシートと行を読み、指定シートや指定行に合う表形式の抜粋を作る。 |

既定の文書種別と evidence ID prefix は次の通りです。

| `artifacts` キー | evidence type | prefix |
| --- | --- | --- |
| `requirements` | `requirement` | `REQ` |
| `basic_design` | `basic_design` | `BD` |
| `detailed_design` | `detailed_design` | `DD` |
| `test_spec` | `test_spec` | `TC` |
| `ledgers` | `ledger` | `LEDGER` |
| `tickets` | `ticket` | `TICKET` |
