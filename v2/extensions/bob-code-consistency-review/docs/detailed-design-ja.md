# bob-code-consistency-review 詳細設計書

## 1. 文書の位置づけ

本書は `extensions/bob-code-consistency-review` 拡張機能の詳細設計を定義する。基本設計で示した目的とスコープを、実装モジュール、主要データ、処理シーケンス、エラー処理、workflow 初期化、テスト観点へ展開する。

## 2. 実装構成

```text
extensions/bob-code-consistency-review/
  package.json
  src/
    extension.ts
    workflowOptions.ts
    workspaceInitializer.ts
    workspaceResolver.ts
    analyzers/
      cCppChangeAnalyzer.ts
      documentExtractor.ts
      traceabilityBuilder.ts
    core/
      bobOutputCapture.ts
      bobOutputValidator.ts
      fileSystem.ts
      gitDiffCollector.ts
      pipeline.ts
      reviewInputValidator.ts
      reviewPackageBuilder.ts
      schemaLoader.ts
      textEncoding.ts
      types.ts
    schemas/
      bob-output.schema.json
      review-input.schema.json
    templates/
      bob-input.md
      output-format.md
      system.md
      task.md
      templateLoader.ts
    triage/
      humanTriageHelper.ts
  templates/
    .bob/
      workflows/
        code-consistency-review/
          WORKFLOW.md
  test/
    *.test.js
```

## 3. 起動設計

`package.json` の `main` は `./out/extension.js` である。activation event は次の通りである。

- `onStartupFinished`
- `onCommand:bobCodeConsistency.initializeWorkspace`
- `onCommand:bobCodeConsistency.preprocess`
- `onCommand:bobCodeConsistency.captureBobOutput`
- `onCommand:bobCodeConsistency.validateOutput`
- `onCommand:bobCodeConsistency.triage`

`activate(context)` は VS Code command を登録し、続けて `workflow-register` の `registerActionProvider` API を使って action provider を登録する。

## 4. Command entry

| Command ID | 実装関数 | 概要 |
| --- | --- | --- |
| `bobCodeConsistency.initializeWorkspace` | `runInitializeWorkspace` | `.bob/workflows/code-consistency-review/WORKFLOW.md` を作成・更新する。 |
| `bobCodeConsistency.preprocess` | `runPreprocess` | `review-input.yaml` から review-package を生成する。 |
| `bobCodeConsistency.captureBobOutput` | `runCaptureBobOutput` | Bob 出力 YAML を抽出・正規化して保存する。 |
| `bobCodeConsistency.validateOutput` | `runValidateOutput` | Bob 出力 YAML を schema と evidence index で検証する。 |
| `bobCodeConsistency.triage` | `runTriage` | 人間確認用 triage 成果物を生成する。 |

## 5. 設定設計

| 設定キー | 既定値 | 用途 |
| --- | --- | --- |
| `bobCodeConsistency.reviewInputPath` | `review-input.yaml` | 入力 YAML の workspace 相対パス。 |
| `bobCodeConsistency.reviewPackagePath` | `.bob-review/review-package` | review-package 出力先。 |
| `bobCodeConsistency.bobOutputPath` | `.bob-review/bob-output/bob-output.yaml` | Bob 出力 YAML 保存先。 |
| `bobCodeConsistency.triagePath` | `.bob-review/human-triage` | 人間 triage 出力先。 |
| `bobCodeConsistency.bzrPath` | `bzr` | review input が Bazaar / bzr の場合に使う Bazaar 実行ファイル。 |
| `bobCodeConsistency.textEncoding` | `auto` | 入力文書、C/C++ ソース、Git/Bazaar 差分 stdout、fixture の読み取り文字コード。 |

workflow や他拡張から呼ぶ場合は、同名 option を `args` / `inputs` / workflow context で渡せる。明示 option は設定値より優先する。

## 6. Workspace 解決設計

`requireBobWorkspaceRoot()` は `resolveBobWorkspaceRoot()` を使って root を解決する。

優先順位は次の通り。

1. `bobRoot`
2. `workspaceRoot`
3. `workflowRoot`
4. VS Code workspace folder
5. QuickPick

`absolute(root, value)` は absolute path ならそのまま、relative path なら workspace root に結合する。現時点では absolute path の完全拒否は行っていないため、今後の安全強化候補である。

## 7. Workspace 初期化詳細

`workspaceInitializer.ts` は同梱 workflow template を Bob workspace へ配置する。

入力:

```ts
interface InitializeCodeConsistencyWorkspaceOptions {
  context: vscode.ExtensionContext
  workspaceRoot: string
}
```

出力:

```ts
interface InitializeCodeConsistencyWorkspaceResult {
  status: "created" | "updated" | "unchanged"
  workspaceRoot: string
  workflowPath: string
  backupPath?: string
  message: string
}
```

配置先:

```text
<workspaceRoot>/.bob/workflows/code-consistency-review/WORKFLOW.md
```

既存ファイルが template と一致する場合は `unchanged` を返す。既存ファイルがあり内容が異なる場合は `.bak-<timestamp>` を作成してから上書きする。

## 8. Workflow-register 連携設計

`registerWorkflowProviders()` は `local.workflow-register` を取得し、次の action provider を登録する。

| Provider ID | 実行内容 |
| --- | --- |
| `bobCodeConsistency.initializeWorkspace` | `runInitializeWorkspace(context, mergeWorkflowOptions(input))` |
| `bobCodeConsistency.preprocess` | `runPreprocess(mergeWorkflowOptions(input))` |
| `bobCodeConsistency.captureBobOutput` | `runCaptureBobOutput(...)` |
| `bobCodeConsistency.validateOutput` | `runValidateOutput(mergeWorkflowOptions(input))` |
| `bobCodeConsistency.triage` | `runTriage(mergeWorkflowOptions(input))` |

workflow 実行時は、次の情報を統合する。

- `input.inputs`
- `input.args`
- `workflowRoot`
- `workflowFile`
- `workflowFolderName`
- `bobRoot`
- `workspaceRoot`

`captureBobOutput` は `buildCaptureWorkflowOptions()` を使い、workflow state / inputs / args から取り込み option を組み立てる。

## 9. Preprocess pipeline 詳細

`preprocessReview()` は次の順で処理する。

```mermaid
sequenceDiagram
  participant P as preprocessReview
  participant I as validateReviewInput
  participant G as collectGitDiff / collect Bazaar diff
  participant D as extractDocuments
  participant C as analyzeCppChanges
  participant T as buildTraceability
  participant B as buildReviewPackage

  P->>I: inputPath, workspaceRoot
  I-->>P: ReviewInput
  P->>G: ReviewInput, workspaceRoot
  G-->>P: DiffSummary
  P->>D: ReviewInput, workspaceRoot
  D-->>P: DocumentExtractionResult
  P->>C: DiffSummary, ReviewInput, workspaceRoot
  C-->>P: CodeAnalysisResult
  P->>T: ReviewInput, documents, codeAnalysis, diff
  T-->>P: TraceabilityResult
  P->>B: build package files
  B-->>P: written
```

`PreprocessResult` は status、reviewId、packageDir、changedFiles、documentEvidence、codeEvidence、warnings、summary を返す。

## 10. Review Input Validation 詳細

`validateReviewInput(inputPath, workspaceRoot)` は次を行う。

1. `readTextFile()` で YAML text を読む。
2. `YAML.parse()` で object 化する。
3. `review-input` schema を `loadSchemaValidator()` で読み込む。
4. schema validation を行う。
5. `artifacts` に指定された文書 path の存在確認を行う。
6. `ReviewInput` を返す。

`artifacts` の値が array の場合、各 item の `path` を workspace root から解決し、存在しない場合は error にする。

## 11. VCS Diff Collector 詳細

### 11.1 Git

通常時に次を実行する。

```text
git diff --name-status <base> <head>
git diff --numstat <base> <head>
git diff --unified=80 <base> <head>
```

`diffFixturePath` が指定された場合は、Git を実行せず fixture JSON を読み込む。

### 11.2 Bazaar

review input または option で Bazaar / bzr が指定された場合、`bzrPath` を使い、必ず `--no-aliases` を付けて差分を取得する。

Bazaar 出力も `textEncoding` の decode 対象である。

### 11.3 DiffSummary

`DiffSummary` は base、head、files、unifiedDiff、warnings を持つ。`files` は path、status、additions、deletions、language、test file flag、interface candidate flag を持つ。

## 12. Document Extractor 詳細

`extractDocuments(reviewInput, { workspaceRoot })` は `reviewInput.artifacts` を走査する。

対応 artifact key と evidence prefix:

| artifact key | evidence type | prefix |
| --- | --- | --- |
| `requirements` | `requirement` | `REQ` |
| `basic_design` | `basic_design` | `BD` |
| `detailed_design` | `detailed_design` | `DD` |
| `test_spec` | `test_spec` | `TC` |
| `ledgers` | `ledger` | `LEDGER` |
| `tickets` | `ticket` | `TICKET` |

Markdown は見出しごとに block 化する。`.docx` は `mammoth.convertToHtml()` と `cheerio` で heading、paragraph、table を抽出する。`.xlsx` は `xlsx` で workbook を読み、指定 sheets または全 sheets を走査する。

抽出した chunk ごとに `REQ-0001`、`BD-0001`、`DD-0001`、`TC-0001`、`LEDGER-0001` のような `evidence_id` を付与する。

## 13. C / C++ Change Analyzer 詳細

`c` / `cpp` / `h` / `hpp` の変更ファイルを対象とする。

`analyzeCppChanges()` は次を行う。

1. unified diff から追加・削除行を抽出する。
2. 変更識別子 token を抽出する。
3. 変更ファイルを workspace 内で解決する。
4. source file を読み込む。
5. 正規表現ベースで関数範囲を検出する。
6. 変更行を含む関数を changed function とする。
7. changed function の callees / direct callers を抽出する。
8. `#define` 候補、global 候補を抽出する。
9. RT 禁止処理候補を検出する。
10. code slice と code evidence を生成する。

関数検出は軽量な正規表現ベースであり、`if`、`for`、`while`、`switch`、`return` は関数候補から除外する。

RT 禁止処理候補:

```text
fopen, fread, fwrite, fprintf, printf, scanf, sleep, Sleep, malloc, free, system
```

## 14. Traceability Builder 詳細

`buildTraceability()` は、review input、document evidence、code evidence、diff summary をもとに、要求・設計・コード・テスト仕様の対応候補を作る。

現状は evidence ID、文書種別、変更シンボル、review focus を用いた候補生成であり、AI 判断の代替ではない。Bob が意味的な不整合候補を抽出するための足場である。

## 15. Review Package Builder 詳細

`buildReviewPackage()` は次を行う。

1. output directory を作成する。
2. prompt template を書き出す。
3. code slices を `code-slices/` に書き出す。
4. table evidence を `tables/` に書き出す。
5. JSON index 群を書き出す。
6. Markdown summary 群を書き出す。
7. prompt template を適用し、`bob-input.md` を生成する。

### 15.1 JSON files

| ファイル | 内容 |
| --- | --- |
| `input-normalized.json` | `ReviewInput`。 |
| `changed-files.json` | `DiffSummary.files` と warning。 |
| `changed-symbols.json` | symbols、functions、defines、globals、call graph、RT 候補。 |
| `document-index.json` | documents と warning。 |
| `evidence-index.json` | evidence metadata。本文は除外。 |
| `traceability-map.json` | traceability rows と warning。 |

### 15.2 Markdown files

| ファイル | 内容 |
| --- | --- |
| `change-summary.md` | review summary と変更ファイル一覧。 |
| `diff-context.md` | code slices と raw unified diff。 |
| `document-excerpts.md` | 文書根拠抜粋。 |
| `traceability-map.md` | 対応候補。 |
| `deterministic-checks.md` | warning と evidence duplicate check。 |
| `bob-input.md` | Bob 投入用の最終 Markdown。 |

`evidence-index.json` には本文を含めず、metadata だけを保存する。Bob 出力検証ではこの file を参照し、存在しない `evidence_id` を検出する。

## 16. Prompt Template 詳細

`src/templates` は次の prompt を持つ。

| Template | 用途 |
| --- | --- |
| `system.md` | Bob の役割と制約。 |
| `task.md` | 整合プレレビューの作業指示。 |
| `output-format.md` | Bob 出力 YAML schema の説明。 |
| `bob-input.md` | review-package 内容を合成する最終テンプレート。 |

`templateLoader.ts` は template を読み込み、`applyTemplate()` で placeholder を置換する。

## 17. Bob Output Capture 詳細

`runCaptureBobOutput()` は次の順で text を決める。

1. command argument が string の場合。
2. options の `text`。
3. workflow state / inputs / args から組み立てた text。
4. clipboard text。

`extractYamlFromText()` は fenced YAML code block、text 全体が `schema_version:` を含む YAML、text 中の `schema_version:` 以降を試す。

YAML parse に成功した場合、`YAML.stringify(parsed)` で正規化し、`bobOutputPath` に保存する。

## 18. Bob Output Validator 詳細

`validateBobOutput()` は次を行う。

1. `bobOutputPath` を読み込む。
2. YAML parse する。
3. `bob-output` schema を検証する。
4. `packageDir/evidence-index.json` を読み込む。
5. `findings[].evidence[]` と `questions[].evidence[]` の `evidence_id` が存在するか確認する。
6. findings / questions が 30 件超の場合 warning を出す。

VS Code command としては、error が 0 件なら `status: ok`、1 件以上なら `status: error` を付けて返す。

## 19. Human Triage 詳細

入力:

- `packageDir`
- `bobOutputPath`
- `outDir`

生成ファイル:

| ファイル | 詳細 |
| --- | --- |
| `triage-result.yaml` | finding / question ごとに decision、owner、reason、follow_up を記入する雛形。 |
| `accepted-findings.md` | finding の要約と evidence を列挙する。 |
| `questions-to-author.md` | question の要約、理由、owner、action を列挙する。 |
| `rejected-findings.md` | 棄却指摘を人間が追記する雛形。 |
| `follow-up-actions.md` | recommended action / suggested action を一覧化する。 |

triage は最終判断を自動化しない。`triage-result.yaml` の `decision`、`reason`、`owner`、`due` は人間が記入する。

## 20. Schema 詳細

`review-input.schema.json` は `review-input.yaml` の required field、artifact array、review focus、analysis options を検証する。

`bob-output.schema.json` は Bob 出力 YAML の構造を検証する。schema validation だけでは evidence の存在までは確認できないため、`bobOutputValidator` が `evidence-index.json` と照合する。

## 21. File I/O と文字コード

`readTextFile()` は `decodeTextBuffer()` を使って file を読み込む。既定は `auto` である。

想定:

- UTF-8
- Shift-JIS / CP932 系日本語テキスト

生成ファイルは UTF-8 で書き込む。`writeTextFile()` は親 directory を recursive に作成してから書き込む。

## 22. Error Handling 詳細

| 発生箇所 | エラー処理 |
| --- | --- |
| review input parse | YAML parse error または schema error を throw。 |
| missing artifact | missing file 一覧を含む error を throw。 |
| Git / Bazaar command failure | preprocess 失敗。 |
| document extraction failure | warning に追加して続行。 |
| changed function 未検出 | warning に追加して続行。 |
| Bob output YAML 不在 | capture result `status: error`。 |
| Bob output parse error | capture result `status: error` または validation errors。 |
| evidence-index 不在 | validation error。 |
| unknown evidence_id | validation error。 |
| triage output write error | command failure。 |
| initialize workspace | 既存 workflow を backup してから更新。 |

## 23. セキュリティ詳細

- Bob に渡す情報は、前処理で生成した `review-package` に固定する。
- Bob が外部ファイルを追加探索する前提にはしない。
- Bob 出力は `evidence-index.json` に存在する evidence のみを根拠として認める。
- 通常フローでは Git commit、Git push、PR コメント投稿、ソースコード変更、文書更新、正式承認を行わない。
- 現状の path 解決は absolute path を許容するため、将来的には明示許可がない限り workspace root 外への参照を拒否する設計が望ましい。

## 24. 状態と保存先

| 種類 | 既定保存先 |
| --- | --- |
| workflow template | `.bob/workflows/code-consistency-review/WORKFLOW.md` |
| 入力 | `review-input.yaml` |
| review-package | `.bob-review/review-package` |
| Bob output | `.bob-review/bob-output/bob-output.yaml` |
| human triage | `.bob-review/human-triage` |
| prompt template copy | `.bob-review/review-package/prompts` |
| code slices | `.bob-review/review-package/code-slices` |
| table excerpts | `.bob-review/review-package/tables` |

## 25. 同梱 workflow 詳細

同梱 workflow:

```text
templates/.bob/workflows/code-consistency-review/WORKFLOW.md
```

現行 template は `schemaVersion: workflow-register/v1` を使い、次を持つ。

- `requires.bob.minVersion: "2.0.0"`
- `guardrails.allowedCommands`
- `guardrails.requireApproval`
- `inputs`
- `tools`
- `artifacts`
- `completion`
- typed `steps`

主な step:

| Step | Type | 処理 |
| --- | --- | --- |
| `preprocess-review-package` | command | review-package と `bob-input.md` を生成する。 |
| `run-bob-pre-review` | agent | `bob-input.md` を使って不整合候補を抽出する。 |
| `capture-bob-output` | command | Bob YAML 出力を保存する。 |
| `validate-bob-output` | command | schema と evidence-index で検証する。 |
| `human-triage` | command | triage 成果物を生成する。 |
| `handoff-formal-review` | agent | 正式レビューへの引き継ぎ Markdown を作る。 |

## 26. テスト設計

| 対象 | 観点 |
| --- | --- |
| `workspaceInitializer` | workflow 作成、更新、backup、unchanged。 |
| `reviewInputValidator` | schema error、missing artifact。 |
| `gitDiffCollector` | name-status / numstat parse、language 判定、fixture 利用。 |
| `documentExtractor` | Markdown / docx / xlsx 抽出、selector、evidence ID。 |
| `cCppChangeAnalyzer` | function range、changed function、callee / caller、RT 禁止候補。 |
| `traceabilityBuilder` | evidence と code symbol の対応候補。 |
| `reviewPackageBuilder` | 生成ファイル、evidence-index、bob-input。 |
| `bobOutputCapture` | fenced YAML、schema_version 開始、parse error。 |
| `bobOutputValidator` | schema error、unknown evidence_id、warning 上限。 |
| `humanTriageHelper` | triage-result と Markdown 出力。 |
| `extension` | workflow-register provider 登録、option merge。 |
| workflow template | requires、guardrails、artifacts、steps、prompt 制約。 |

## 27. 変更時の注意点

- `review-input.schema.json` を変えた場合は README、設計書、テスト fixture を同期する。
- `bob-output.schema.json` を変えた場合は prompt `output-format.md` と validator test を同期する。
- evidence ID 形式を変えた場合は document extractor、code analyzer、validator、triage を確認する。
- C / C++ 解析を強化する場合は、正規表現ベースの限界と false positive / false negative を docs に明記する。
- workspace path 制約を強化する場合は、絶対 path を使う既存利用との互換性を確認する。
- `workspaceInitializer` を変更する場合は、既存 workflow backup と template refresh の挙動を確認する。
- workflow-register の `ActionExecutionInput` 変更時は `workflowOptions.ts` と provider 登録を確認する。
