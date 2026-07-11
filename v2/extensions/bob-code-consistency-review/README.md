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
- 元文書を変更せず、`.bob-trace/traceability-catalog.json` に traceability 候補と承認状態を保持する。
- Traceability Prep Webview で人間が `proposed` 候補を `accepted` / `rejected` / `deprecated` に分類する。
- accepted traceability item から `review-input.yaml` を生成する。
- Git / Bazaar 差分から変更ファイル、変更行、C / C++ の変更関数候補を抽出する。
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
2. `Bob Code Consistency Review: .bob ワークフロー定義と review-input 雛形を初期化` を実行し、`.bob/workflows/.../WORKFLOW.md` と `review-input.yaml` の雛形を作成する。
3. 文書 ID や工程間リンクを整理する場合は、traceability 系コマンドで sidecar catalog を作成し、人間が承認する。
4. 手書きする代わりに `Bob Code Consistency Review: 対話式に review-input.yaml を作成` で、短いドラフトと候補選択から `review-input.yaml` を生成する。
5. AI を使う場合は `Bob Code Consistency Review: AI draft 用プロンプトを作成` でプロンプトを作り、AI の JSON 応答を `Bob Code Consistency Review: AI draft JSON から review-input.yaml を生成` で取り込む。
6. `review-input.yaml` の `review`、`artifacts`、`review_focus` を必要に応じて確認する。
7. `Bob Code Consistency Review: 入力を前処理して Bob 用パッケージを作成` を実行する。
8. 生成された `.bob-review/review-package/bob-input.md` を Bob に渡し、整合プレレビューを実行する。
9. Bob の YAML 出力をコピーし、`Bob Code Consistency Review: Bob 出力 YAML を取り込む` で保存する。
10. `Bob Code Consistency Review: Bob 出力 YAML を検証` で schema と evidence 参照を検証する。
11. `Bob Code Consistency Review: 人間確認用 triage を生成` で人間確認用ファイルを生成する。
12. 人間が triage 結果を確認し、正式レビューや修正作業へ回す指摘を判断する。

## Command Palette のコマンド

| コマンド | 内部 command ID | 用途 |
| --- | --- | --- |
| `Bob Code Consistency Review: .bob ワークフロー定義と review-input 雛形を初期化` | `bobCodeConsistency.initializeWorkspace` | `.bob/workflows/code-consistency-review/WORKFLOW.md` と `review-input.yaml` の雛形を作成する。既存 `review-input.yaml` は上書きせず、バックアップだけ作成する。 |
| `Bob Code Consistency Review: 対話式に review-input.yaml を作成` | `bobCodeConsistency.createReviewInput` | Git / Bazaar、base / head、変更種別、関連文書候補、レビュー観点を選び、`ReviewInputBuilder` 経由で `review-input.yaml` を生成する。 |
| `Bob Code Consistency Review: AI draft 用プロンプトを作成` | `bobCodeConsistency.prepareAiReviewInputDraft` | diff summary、関連文書候補、schema enum、既存 YAML 診断をまとめた AI draft 用 Markdown を作成し clipboard にコピーする。 |
| `Bob Code Consistency Review: AI draft JSON から review-input.yaml を生成` | `bobCodeConsistency.applyAiReviewInputDraft` | AI が返した `ReviewInputDraft` JSON を clipboard / 引数から読み、`ReviewInputBuilder` と validator を通して `review-input.yaml` に保存する。 |
| `Bob Code Consistency Review: traceability AI draft 用プロンプトを作成` | `bobCodeConsistency.prepareAiTraceabilityDraft` | 文書候補、差分、既存 catalog をもとに traceability AI draft 用 prompt を作る。 |
| `Bob Code Consistency Review: traceability AI draft JSON を取り込み` | `bobCodeConsistency.captureAiTraceabilityDraft` | `.bob-trace/ai-traceability-draft/ai-draft.json` などの proposed-only JSON を検証し、workflow state へ渡す。 |
| `Bob Code Consistency Review: traceability AI draft JSON を catalog に反映` | `bobCodeConsistency.applyAiTraceabilityDraft` | AI が返した proposed-only JSON を `.bob-trace/traceability-catalog.json` に merge し、gate report を更新する。 |
| `Bob Code Consistency Review: traceability prep を開く` | `bobCodeConsistency.openTraceabilityPrep` | Traceability Prep Webview を開き、人間が proposed item を承認 / 棄却 / 廃止する。 |
| `Bob Code Consistency Review: traceability catalog を検証` | `bobCodeConsistency.validateTraceabilityCatalog` | catalog の gate 検証を行い、`.bob-trace/gate-report.md` を生成する。 |
| `Bob Code Consistency Review: traceability catalog から review-input.yaml を生成` | `bobCodeConsistency.createReviewInputFromTraceability` | accepted catalog item と review metadata から `review-input.yaml` を生成する。 |
| `Bob Code Consistency Review: review-input.yaml を自動修復` | `bobCodeConsistency.repairReviewInput` | 古い `review_focus` 名を現行 schema enum へ置換し、バックアップ後に保存する。 |
| `Bob Code Consistency Review: review-input.yaml 診断を説明` | `bobCodeConsistency.explainReviewInputDiagnostics` | `review-input.yaml` の schema / 文書パス診断を表示する。 |
| `Bob Code Consistency Review: 入力を前処理して Bob 用パッケージを作成` | `bobCodeConsistency.preprocess` | `review-input.yaml`、Git / Bazaar 差分、文書、コード解析結果から `review-package` を生成する。 |
| `Bob Code Consistency Review: Bob 出力 YAML を取り込む` | `bobCodeConsistency.captureBobOutput` | Bob が出力した YAML を clipboard または引数から抽出し、`bob-output.yaml` として保存する。 |
| `Bob Code Consistency Review: Bob 出力 YAML を検証` | `bobCodeConsistency.validateOutput` | Bob 出力 YAML を schema と evidence index で検証する。 |
| `Bob Code Consistency Review: 人間確認用 triage を生成` | `bobCodeConsistency.triage` | Bob 出力から人間確認用の triage 成果物を生成する。 |

## 設定

| 設定 | 既定値 | 説明 |
| --- | --- | --- |
| `bobCodeConsistency.reviewInputPath` | `review-input.yaml` | 入力 YAML のワークスペース相対パス。 |
| `bobCodeConsistency.reviewPackagePath` | `.bob-review/review-package` | 生成する review-package のワークスペース相対パス。 |
| `bobCodeConsistency.traceabilityCatalogPath` | `.bob-trace/traceability-catalog.json` | 元文書を変更せずに traceability ID、リンク、承認状態を保持する sidecar catalog のパス。 |
| `bobCodeConsistency.traceabilityGateReportPath` | `.bob-trace/gate-report.md` | traceability catalog の gate 検証結果を書き込む Markdown report のパス。 |
| `bobCodeConsistency.bobOutputPath` | `.bob-review/bob-output/bob-output.yaml` | 取り込んだ Bob 出力 YAML の保存先。 |
| `bobCodeConsistency.triagePath` | `.bob-review/human-triage` | 人間 triage ファイルの出力先。 |
| `bobCodeConsistency.bzrPath` | `bzr` | `review.vcs` が `bazaar` / `bzr` の場合に使用する Bazaar 実行ファイルのパス。実行時は必ず `--no-aliases` を付与する。 |
| `bobCodeConsistency.textEncoding` | `auto` | `review-input.yaml`、Markdown 文書、C/C++ ソース、Git/Bazaar 差分 stdout、diff fixture の読み取り文字コード。`auto` / `utf8` / `shift_jis` / `cp932` / `windows-31j` を指定できる。 |

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

## Traceability sidecar catalog

traceability 機能は、元の要求書・設計書・テスト仕様書を書き換えずに、別ファイルへ ID 候補、工程間リンク、承認状態を保持します。

```text
.bob-trace/
  traceability-catalog.json
  gate-report.md
  ai-traceability-draft/
    ai-draft-prompt.md
```

基本の流れは次の通りです。

```text
prepareAiTraceabilityDraft
  -> AI に proposed-only JSON を返させ、.bob-trace/ai-traceability-draft/ai-draft.json に保存する
  -> captureAiTraceabilityDraft
  -> applyAiTraceabilityDraft
  -> Traceability Prep Webview で人間が accepted / rejected / deprecated を判断
  -> validateTraceabilityCatalog
  -> createReviewInputFromTraceability
  -> review-input.yaml
```

AI が作成できるのは `status: proposed` の候補だけです。`accepted`、`rejected`、`deprecated` への遷移は人間が Traceability Prep Webview で実施します。

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
| `manifest.yaml` | review-package の作成情報、対象範囲、テンプレート ID、根拠件数、`artifact_metadata` を記録する。 |
| `input-normalized.json` | 検証済み `review-input.yaml` を正規化して保存する。 |
| `changed-files.json` | Git / Bazaar 差分から得た変更ファイル一覧と warning を保存する。 |
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
| `.xlsx` | `read-excel-file` でシートと行を読み、指定シートや指定行に合う表形式の抜粋を作る。 |

既定の文書種別と evidence ID prefix は次の通りです。

| `artifacts` キー | evidence type | prefix |
| --- | --- | --- |
| `requirements` | `requirement` | `REQ` |
| `basic_design` | `basic_design` | `BD` |
| `detailed_design` | `detailed_design` | `DD` |
| `test_spec` | `test_spec` | `TC` |
| `ledgers` | `ledger` | `LEDGER` |
| `tickets` | `ticket` | `TICKET` |

## 現在の実装分割

| ファイル / ディレクトリ | 責務 |
| --- | --- |
| `src/extension.ts` | VS Code command 登録、workflow provider handler mapping、主要 command handler の入口。 |
| `src/extensionCommandOptions.ts` | notification、workspace root 解決、path helper、string / boolean / array option、VCS / change type / review focus helper。 |
| `src/reviewInputWizard.ts` | 対話式 `review-input.yaml` 作成 UI、文書候補選択、review metadata 収集。 |
| `src/commands/reviewInputCommands.ts` | review-input 作成、AI draft 作成 / 反映、repair、診断説明の command handler。 |
| `src/workflowProviderRegistration.ts` | `workflow-register` の action provider 登録と action provider から渡される option record の正規化。 |
| `src/workspaceInitializer.ts` | `.bob/workflows/code-consistency-review/WORKFLOW.md` と `review-input.yaml` 雛形の初期化。 |
| `src/traceabilityCommands.ts` | traceability AI draft 作成 / 反映、Traceability Prep Webview 起動、catalog gate 検証、accepted item からの `review-input.yaml` 生成。 |
| `src/reviewExecutionCommands.ts` | preprocess、Bob output capture、Bob output validate、人間 triage 生成。 |
| `src/core/*` | review-input builder、AI draft provider、traceability catalog、pipeline、Bob output capture / validator。 |
| `src/webview/traceabilityPrepWebview.ts` | traceability item の人間承認 UI。 |
| `src/triage/humanTriageHelper.ts` | 人間確認用 triage 成果物生成。 |

現在の追加分割は `src/commands/reviewInputCommands.ts` まで反映済みです。今後は追加 VSIX 分割ではなく、`docs/workflow-action-contracts-ja.md` と `docs/artifact-metadata-contract-ja.md` の contract、成果物 metadata、drift 防止テストで整合を保ちます。

## ビルド

```powershell
cd extensions\bob-code-consistency-review
npm install
npm run compile
npm run test
npm run package
```

## セキュリティと運用上の注意

- AI には最終 YAML、正式承認、採否判断を直接させません。
- AI draft は JSON object に限定し、builder / validator を必ず通します。
- `artifact.path` はワークスペース上の実在パスとして検証します。
- Bazaar 実行時は `--no-aliases` を付けます。
- Bob 出力は YAML schema と `evidence-index.json` に照らして検証します。
- human triage は正式レビュー前の人間判断用成果物です。

## 保守・配布ポリシー

### 生成物

主な生成物は `.bob-review/review-package`、`.bob-review/bob-output/`、`.bob-review/human-triage/`、`.bob-trace/traceability-catalog.json`、`.bob-trace/gate-report.md` です。review-package には `review-package` の manifest、`artifact_metadata`、document excerpts、diff context、evidence index、Bob 投入用 `bob-input.md` が含まれます。コード、文書抜粋、Bob 出力、triage 判断を含むため、共有前に内容を確認してください。

### VSIX サイズ

`npm run package:policy` は VSIX サイズの上限を `11000000` bytes として確認します。配布前は `npm run package` と `npm run package:policy` を続けて実行してください。`out/**/*.map` と開発用の `docs/**` は VSIX に同梱しません。

### 暗黙依存

`IBM.bob-code` と `workflow-register` は `extensionDependencies` として必要です。Bob への投入、workflow action provider、Bob output capture を使う前に両方が導入済みであることを確認してください。Excel 読み取りは production dependency の `read-excel-file` を使い、既知脆弱性のある `xlsx` には依存しません。

### 必要 CLI

差分取得には git または Bazaar CLI が必要です。Bazaar を使う場合は alias の影響を避けるため `bzr --no-aliases` を前提にします。開発と検証には Node.js と npm が必要です。

```powershell
npm ci
npm run dependency:policy
npm run architecture:policy
npm run unused:report
npm run audit:prod
npm test
npm run package
npm run package:policy
```

### Trusted Workspace

`review-input.yaml`、文書 path、review-package path、Bob output path、triage path、traceability catalog path は workspace 内を基準に検証します。Trusted Workspace でない環境では、外部 path opt-in や VCS command 実行の設定を確認してから前処理を実行してください。

## 関連ドキュメント

以下はソースリポジトリ上の関連ドキュメントです。VSIX には同梱しません。

- `docs/README-ja.md`
- `docs/vcs-bazaar-ja.md`
- `docs/text-encoding-ja.md`
- `../../../docs/workflows/code-consistency-review/README.md`
- `../../../docs/workflows/code-consistency-review/review-input-schema.md`
- `../../../docs/workflows/code-consistency-review/review-package-spec.md`
- `../../../docs/workflows/code-consistency-review/bob-output-schema.md`
- `extensions/workflow-register/README.md`
- `extensions/README.md`

<!-- REMEDIATION-2026-07-11 -->
## Integration and process safety

- Companion extensions are optional unless the command explicitly needs them; provider registration retries after delayed activation.
- Workflow providers are owner-scoped, reject duplicate IDs, and are disposed with the extension lifecycle.
- Git and Bazaar subprocesses have bounded output, hard timeouts, cancellation, and process-tree termination.
- Release validation runs on both Ubuntu and Windows, while IBM Bob UI/MCP checks remain a release-candidate real-machine gate.
