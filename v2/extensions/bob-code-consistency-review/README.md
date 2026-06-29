# Bob Code Consistency Review（コード整合プレレビュー）

`bob-code-consistency-review` は、コード変更と要求書・基本設計書・詳細設計書・テスト仕様書の整合性を、正式レビュー前に IBM Bob でプレレビューするための VS Code 拡張機能です。

この拡張機能は、Bob にコードや文書をそのまま渡すのではなく、事前に差分、文書抜粋、コード解析結果、対応候補、根拠 ID をまとめた `review-package` を生成します。Bob はそのパッケージをもとに意味的な不整合候補を抽出し、人間が最終的に採用・棄却・追加調査を判断します。

この README では、コマンド名、設定キー、JSON / YAML のフィールド名、ファイル名、識別子は実装上の名称として原文のまま記載します。

## できること

- `review-input.yaml` を読み込み、対象レビュー、比較範囲、関連文書、レビュー観点を検証する。
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
2. ワークスペースに `review-input.yaml` を作成する。
3. `Bob Code Consistency: Preprocess Code Consistency Review` を実行する。
4. 生成された `.bob-review/review-package/bob-input.md` を Bob に渡し、整合プレレビューを実行する。
5. Bob の YAML 出力をコピーし、`Bob Code Consistency: Capture Code Consistency Bob Output` で保存する。
6. `Bob Code Consistency: Validate Code Consistency Bob Output` で schema と evidence 参照を検証する。
7. `Bob Code Consistency: Generate Code Consistency Human Triage` で人間確認用ファイルを生成する。
8. 人間が triage 結果を確認し、正式レビューや修正作業へ回す指摘を判断する。

## Command Palette のコマンド

| コマンド | 内部 command ID | 用途 |
| --- | --- | --- |
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
  ticket_ids:
    - BUG-1234
artifacts:
  requirements:
    - path: docs/requirements-timeout.md
      sections:
        - REQ-TIMEOUT-001
  basic_design:
    - path: docs/basic-design-timeout.md
  detailed_design:
    - path: docs/detailed-design-timeout.md
  test_spec:
    - path: docs/test-spec-timeout.md
  ledgers:
    - path: docs/error-ledger.xlsx
      sheets:
        - errors
review_focus:
  - requirements_to_code
  - design_to_code
  - code_to_test
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

## C / C++ 変更解析

C / C++ 解析は、Git 差分とワークスペース内の変更ファイルを使って、Bob に渡すコード根拠を作ります。

主な抽出内容は次の通りです。

- 対象言語: `c` / `cpp` / `h` / `hpp`
- 変更関数候補
- 変更関数のコードスライス
- direct callee / caller 候補
- call graph 候補
- `#define` 候補
- global 変数候補
- RT スレッドで問題になりやすい禁止処理候補

現在の解析は、軽量な正規表現ベースの MVP 実装です。clang AST による完全解析や関数ポインタ経由の厳密な追跡は、この拡張機能単体ではまだ行いません。

## Bob 出力の取り込みと検証

Bob 出力は YAML として扱います。`captureBobOutput` は、次の入力形式から YAML オブジェクトを抽出します。

- fenced code block の YAML
- `schema_version:` で始まる YAML
- テキスト中に含まれる `schema_version:` 以降の YAML

保存先の既定値は次の通りです。

```text
.bob-review/bob-output/bob-output.yaml
```

`validateOutput` は、次を確認します。

- YAML として parse できるか。
- `bob-output` schema に合っているか。
- `findings[].evidence[]` と `questions[].evidence[]` が `evidence-index.json` に存在する `evidence_id` を参照しているか。
- `findings` または `questions` が多すぎる場合に warning を出す。

## 人間 triage 出力

`triage` は Bob 出力から、既定では `.bob-review/human-triage` に次のファイルを生成します。

```text
.bob-review/
  human-triage/
    triage-result.yaml
    accepted-findings.md
    questions-to-author.md
    rejected-findings.md
    follow-up-actions.md
```

| ファイル | 用途 |
| --- | --- |
| `triage-result.yaml` | 各 finding / question に対する人間判断、担当、理由、後続対応を記録する。 |
| `accepted-findings.md` | 採用候補のプレレビュー指摘を確認する。 |
| `questions-to-author.md` | 作成者への確認事項を整理する。 |
| `rejected-findings.md` | 棄却したプレレビュー指摘を人間が追記する。 |
| `follow-up-actions.md` | 推奨対応や確認事項を後続アクションとして一覧化する。 |

## `workflow-register` との連携

この拡張機能は、`workflow-register` の `registerActionProvider` API に次の action provider を登録します。

| action provider | 対応コマンド |
| --- | --- |
| `bobCodeConsistency.preprocess` | `bobCodeConsistency.preprocess` |
| `bobCodeConsistency.captureBobOutput` | `bobCodeConsistency.captureBobOutput` |
| `bobCodeConsistency.validateOutput` | `bobCodeConsistency.validateOutput` |
| `bobCodeConsistency.triage` | `bobCodeConsistency.triage` |

ワークフローから呼び出す例は次の通りです。

```yaml
steps:
  - id: preprocess
    title: 整合レビュー入力の前処理
    type: command
    action:
      provider: bobCodeConsistency.preprocess
      args:
        reviewInputPath: review-input.yaml
        reviewPackagePath: .bob-review/review-package
    resultKey: reviewPackage
    required: true
    sendResult: true
  - id: review-with-bob
    title: Bob 整合プレレビュー
    type: agent
    includeState:
      - reviewPackage
    prompt: |
      reviewPackage の bob-input.md と evidence_id を根拠に、コード変更と要求・設計・テスト仕様の不整合候補を抽出してください。
  - id: capture-output
    title: Bob 出力取り込み
    type: command
    action:
      provider: bobCodeConsistency.captureBobOutput
    resultKey: capturedBobOutput
    required: true
    sendResult: true
  - id: validate-output
    title: Bob 出力検証
    type: command
    action:
      provider: bobCodeConsistency.validateOutput
    resultKey: validationResult
    required: true
    sendResult: true
  - id: triage
    title: 人間 triage 生成
    type: command
    action:
      provider: bobCodeConsistency.triage
    resultKey: triageResult
    required: true
    sendResult: true
```

`captureBobOutput` は、ワークフロー状態、入力値、引数から取り込みオプションを組み立てます。明示的な `text` がない場合は clipboard から読み込みます。

## Bob にさせること / させないこと

| 区分 | 内容 |
| --- | --- |
| 拡張機能が行うこと | 入力検証、差分収集、文書抽出、コード根拠抽出、対応候補作成、Bob 入力生成、Bob 出力検証、triage ファイル生成。 |
| Bob にさせること | `review-package` に含まれる根拠だけを使い、意味的な不整合候補、確認事項、推奨対応を抽出する。 |
| 人間が行うこと | 指摘の採用判断、棄却理由、追加調査、正式レビュー、最終承認。 |
| Bob にさせないこと | 正式承認、根拠なし断定、対象外ファイルの推測、大量ファイル探索、破壊的操作、コミットや PR 更新。 |

## セキュリティと安全設計

- Bob に投入する前に、差分・文書抜粋・コード根拠を `review-package` として固定する。
- Bob の出力は YAML schema と `evidence-index.json` で検証する。
- evidence 参照が存在しない finding / question はエラーにする。
- 解析不能な情報は黙って捨てず、warning として保存する。
- 文書やコードの全量投入ではなく、根拠 ID 付きの抜粋を渡す。
- この拡張機能は正式承認を行わない。承認判断は必ず人間が行う。
- コミット、push、PR コメント投稿などの副作用は、この拡張機能の通常フローには含めない。

## ビルド

```powershell
cd extensions\bob-code-consistency-review
npm install
npm run compile
npm run test
npm run package
```

生成される VSIX 名は次の形式です。

```text
bob-code-consistency-review-0.1.0.vsix
```

## トラブルシュート

| 症状 | 確認ポイント |
| --- | --- |
| `Open a workspace folder first.` | Bob IDE / VS Code でワークスペースフォルダを開いているか確認する。 |
| `Invalid review-input.yaml` | `review-input.yaml` が schema に合っているか、必須フィールドがあるか確認する。 |
| `review-input.yaml references missing artifact file(s)` | `artifacts` に指定した文書パスがワークスペース内に存在するか確認する。 |
| `No changed C/C++ function could be mapped from diff hunks.` | 差分対象ファイルが `c` / `cpp` / `h` / `hpp` として認識されているか、変更後ファイルがワークスペースにあるか確認する。 |
| `No YAML object was found in Bob output.` | Bob 出力に fenced YAML または `schema_version:` で始まる YAML が含まれているか確認する。 |
| `evidence-index.json not found` | `validateOutput` の前に `preprocess` を実行し、同じ `reviewPackagePath` を指定しているか確認する。 |
| `references unknown evidence_id` | Bob 出力の evidence が `evidence-index.json` に存在する ID を参照しているか確認する。 |

## 関連ドキュメント

- `docs/workflows/code-consistency-review/README.md`
- `docs/workflows/code-consistency-review/review-input-schema.md`
- `docs/workflows/code-consistency-review/review-package-spec.md`
- `docs/workflows/code-consistency-review/bob-prompt-template.md`
- `docs/workflows/code-consistency-review/bob-output-schema.md`
- `docs/workflows/code-consistency-review/human-triage-spec.md`
- `extensions/workflow-register/README.md`
- `extensions/README.md`
