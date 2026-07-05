# bob-code-consistency-review 詳細設計書

## 1. 文書の位置づけ

本書は `extensions/bob-code-consistency-review` 拡張機能の詳細設計を定義する。基本設計で示した目的とスコープを、実装モジュール、command、workflow provider、review-input 生成、traceability sidecar、前処理 pipeline、Bob 出力検証、triage、テスト観点へ展開する。

## 2. 実装構成

```text
extensions/bob-code-consistency-review/
  package.json
  src/
    extension.ts
    extensionCommandOptions.ts
    reviewExecutionCommands.ts
    reviewInputWizard.ts
    traceabilityCommands.ts
    workflowProviderRegistration.ts
    workspaceInitializer.ts
    workspaceResolver.ts
    analyzers/
      codeChangeAnalyzer.ts
      cCppChangeAnalyzer.ts
      documentExtractor.ts
      genericCodeEvidenceAnalyzer.ts
      traceabilityBuilder.ts
    core/
      bobOutputCapture.ts
      bobOutputValidator.ts
      fileSystem.ts
      gitDiffCollector.ts
      languageClassifier.ts
      pipeline.ts
      reviewInputAiDraftProvider.ts
      reviewInputBuilder.ts
      reviewInputDiagnostics.ts
      reviewInputDiscovery.ts
      reviewInputValidator.ts
      reviewPackageBuilder.ts
      schemaLoader.ts
      textEncoding.ts
      traceabilityAiDraftProvider.ts
      traceabilityCatalog.ts
      traceabilityCatalogStore.ts
      traceabilityIds.ts
      traceabilityPrepController.ts
      traceabilityTypes.ts
      traceabilityValidation.ts
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
    webview/
      traceabilityPrepWebview.ts
      traceabilityPrepWebviewAssets.ts
  templates/
    .bob/
      workflows/
        code-consistency-review/
          WORKFLOW.md
  test/
    *.test.js
```

## 3. 起動設計

`package.json` の `main` は `./out/extension.js` である。activation event は `onStartupFinished` と各 `bobCodeConsistency.*` command である。

`activate(context)` は VS Code command を登録し、続けて `workflowProviderRegistration.registerWorkflowProviders()` を呼ぶ。`workflow-register` 取得や provider 登録に失敗した場合は warning log に留め、通常 command 利用は継続する。

## 4. Command entry

| Command ID | 実装関数 | 概要 |
| --- | --- | --- |
| `bobCodeConsistency.initializeWorkspace` | `runInitializeWorkspace` | workflow template、review-input 雛形、placeholder document を初期化する。 |
| `bobCodeConsistency.createReviewInput` | `runCreateReviewInput` | 対話式に `review-input.yaml` を作成する。 |
| `bobCodeConsistency.prepareAiReviewInputDraft` | `runPrepareAiReviewInputDraft` | AI draft 用 prompt を作成する。 |
| `bobCodeConsistency.applyAiReviewInputDraft` | `runApplyAiReviewInputDraft` | AI draft JSON から `review-input.yaml` を生成する。 |
| `bobCodeConsistency.prepareAiTraceabilityDraft` | `runPrepareAiTraceabilityDraft` | traceability AI draft 用 prompt を作成する。 |
| `bobCodeConsistency.applyAiTraceabilityDraft` | `runApplyAiTraceabilityDraft` | traceability AI draft JSON を catalog に反映する。 |
| `bobCodeConsistency.openTraceabilityPrep` | `runOpenTraceabilityPrep` | traceability prep Webview を開く。 |
| `bobCodeConsistency.validateTraceabilityCatalog` | `runValidateTraceabilityCatalog` | catalog を検証し gate report を生成する。 |
| `bobCodeConsistency.createReviewInputFromTraceability` | `runCreateReviewInputFromTraceability` | accepted traceability item から `review-input.yaml` を生成する。 |
| `bobCodeConsistency.repairReviewInput` | `runRepairReviewInput` | legacy / 不完全な `review-input.yaml` の修復を試みる。 |
| `bobCodeConsistency.explainReviewInputDiagnostics` | `runExplainReviewInputDiagnostics` | `review-input.yaml` 診断を説明する。 |
| `bobCodeConsistency.preprocess` | `runPreprocess` | `review-input.yaml` から review-package を生成する。 |
| `bobCodeConsistency.captureBobOutput` | `runCaptureBobOutput` | Bob 出力 YAML を抽出・正規化して保存する。 |
| `bobCodeConsistency.validateOutput` | `runValidateOutput` | Bob 出力 YAML を schema と evidence index で検証する。 |
| `bobCodeConsistency.triage` | `runTriage` | 人間確認用 triage 成果物を生成する。 |

## 5. 設定設計

| 設定キー | 既定値 | 用途 |
| --- | --- | --- |
| `bobCodeConsistency.reviewInputPath` | `review-input.yaml` | 入力 YAML の workspace 相対パス。 |
| `bobCodeConsistency.reviewPackagePath` | `.bob-review/review-package` | review-package 出力先。 |
| `bobCodeConsistency.traceabilityCatalogPath` | `.bob-trace/traceability-catalog.json` | sidecar traceability catalog の保存先。 |
| `bobCodeConsistency.traceabilityGateReportPath` | `.bob-trace/gate-report.md` | traceability gate report の保存先。 |
| `bobCodeConsistency.bobOutputPath` | `.bob-review/bob-output/bob-output.yaml` | Bob 出力 YAML 保存先。 |
| `bobCodeConsistency.triagePath` | `.bob-review/human-triage` | 人間 triage 出力先。 |
| `bobCodeConsistency.bzrPath` | `bzr` | review input が Bazaar / bzr の場合に使う Bazaar 実行ファイル。 |
| `bobCodeConsistency.textEncoding` | `auto` | 入力文書、C/C++ ソース、Git/Bazaar 差分 stdout、fixture の読み取り文字コード。 |
| `bobCodeConsistency.maxDocumentBytes` | `5242880` | 1 文書あたりの読み取り上限。Markdown は上限まで読み、docx / xlsx は上限超過時に抽出を中止する。 |
| `bobCodeConsistency.maxWorkbookSheets` | `20` | xlsx 抽出で処理する最大 sheet 数。 |
| `bobCodeConsistency.maxRowsPerSheet` | `500` | xlsx 抽出で 1 sheet あたり処理する最大 data row 数。 |
| `bobCodeConsistency.maxExcerptBytesPerDocument` | `65536` | 1 evidence excerpt あたりの最大 UTF-8 bytes。超過時は warning とともに切り詰める。 |
| `bobCodeConsistency.maxRawDiffBytes` | `1048576` | review-package と Bob input に含める raw unified diff の最大 UTF-8 bytes。 |
| `bobCodeConsistency.maxBobInputBytes` | `2097152` | 生成する `bob-input.md` の最大 UTF-8 bytes。 |

workflow や他拡張から呼ぶ場合は、同名 option を `args` / `inputs` / workflow context で渡せる。明示 option は設定値より優先する。

## 6. Workspace 解決設計

`requireBobWorkspaceRoot()` は `resolveBobWorkspaceRoot()` を使って root を解決する。優先順位は `bobRoot`、`workspaceRoot`、`workflowRoot`、VS Code workspace folder、QuickPick である。

`absolute(root, value)` は absolute path ならそのまま、relative path なら workspace root に結合する。review-input builder や traceability draft path では workspace containment check を行い、artifact path escape や draft JSON path escape を拒否する。

## 7. Workspace 初期化詳細

`workspaceInitializer.ts` は同梱 workflow template を Bob workspace へ配置し、必要に応じて `review-input.yaml` 雛形と placeholder document も作成する。

入力:

```ts
interface InitializeCodeConsistencyWorkspaceOptions {
  context: vscode.ExtensionContext
  workspaceRoot: string
  reviewInputPath?: string
}
```

出力:

```ts
interface InitializeCodeConsistencyWorkspaceResult {
  status: "created" | "updated" | "unchanged"
  workspaceRoot: string
  workflowPath: string
  reviewInputPath: string
  placeholderDocumentPath?: string
  backupPath?: string
  reviewInputBackupPath?: string
  message: string
}
```

配置先:

```text
<workspaceRoot>/.bob/workflows/code-consistency-review/WORKFLOW.md
<workspaceRoot>/review-input.yaml
<workspaceRoot>/docs/review-input-placeholder.md
```

workflow template が既存 file と異なる場合は `.bak-<timestamp>` を作成して上書きする。`review-input.yaml` が存在しない場合は雛形を作成する。既存 `review-input.yaml` が雛形と異なる場合は上書きせず、backup のみ作成する。

## 8. Workflow-register 連携設計

`workflowProviderRegistration.ts` は `local.workflow-register` を取得し、次の action provider を登録する。

| Provider ID | 実行内容 |
| --- | --- |
| `bobCodeConsistency.initializeWorkspace` | `initializeWorkspace(mergeWorkflowOptions(input))` |
| `bobCodeConsistency.createReviewInput` | `createReviewInput(mergeWorkflowOptions(input))` |
| `bobCodeConsistency.prepareAiReviewInputDraft` | `prepareAiReviewInputDraft(mergeWorkflowOptions(input))` |
| `bobCodeConsistency.applyAiReviewInputDraft` | `applyAiReviewInputDraft(mergeWorkflowOptions(input))` |
| `bobCodeConsistency.prepareAiTraceabilityDraft` | `prepareAiTraceabilityDraft(mergeWorkflowOptions(input))` |
| `bobCodeConsistency.applyAiTraceabilityDraft` | `applyAiTraceabilityDraft(buildApplyTraceabilityDraftOptions(input))` |
| `bobCodeConsistency.openTraceabilityPrep` | `openTraceabilityPrep(mergeWorkflowOptions(input))` |
| `bobCodeConsistency.validateTraceabilityCatalog` | `validateTraceabilityCatalog(mergeWorkflowOptions(input))` |
| `bobCodeConsistency.createReviewInputFromTraceability` | `createReviewInputFromTraceability(mergeWorkflowOptions(input))` |
| `bobCodeConsistency.repairReviewInput` | `repairReviewInput(mergeWorkflowOptions(input))` |
| `bobCodeConsistency.explainReviewInputDiagnostics` | `explainReviewInputDiagnostics(mergeWorkflowOptions(input))` |
| `bobCodeConsistency.preprocess` | `preprocess(mergeWorkflowOptions(input))` |
| `bobCodeConsistency.captureBobOutput` | `captureBobOutput(buildCaptureBobOutputOptions(input))` |
| `bobCodeConsistency.validateOutput` | `validateOutput(mergeWorkflowOptions(input))` |
| `bobCodeConsistency.triage` | `triage(mergeWorkflowOptions(input))` |

workflow 実行時は、`input.inputs`、`input.args`、`workflowRoot`、`workflowFile`、`workflowFolderName`、`bobRoot`、`workspaceRoot` を統合する。`captureBobOutput` は `buildCaptureWorkflowOptions()` を使い、workflow state / inputs / args から text 候補を組み立てる。`applyAiTraceabilityDraft` は option text が無い場合に `state.traceabilityDraftJson` を利用する。

## 9. Review Input Discovery / Wizard / Builder

`reviewInputDiscovery.ts` は既定で `<workspaceRoot>/docs` を走査し、`.md`、`.markdown`、`.docx`、`.xlsx` を候補とする。Markdown と Excel では `REQ`、`BD`、`DD`、`TC`、`QA`、`RV`、`ERR`、`ISSUE`、`TICKET`、`LEDGER` などの ID 候補を抽出する。path 名から artifact kind を推定する。

`reviewInputWizard.ts` は discovery result を人間に選択させ、`ReviewInputDraft` を作る。

`reviewInputBuilder.ts` は draft を最終 `ReviewInput` に変換する。

- `review.change_type`、`review.vcs`、`artifact.kind`、`review_focus` を enum 検証する。
- `focus_preset` から review focus を補完する。
- artifact path が workspace 外へ逃げる場合は error にする。
- `strictPaths` が true の場合、存在しない artifact path を error にする。
- `analysis_options` と `bob_options` の既定値を補完する。
- schema validation 後に YAML を出力する。
- 既存 file は backup して上書きする。

## 10. Review Input AI Draft / Diagnostics

`reviewInputAiDraftProvider.ts` は `prepareAiReviewInputDraftPrompt()` と `applyAiReviewInputDraft()` を提供する。

`prepareAiReviewInputDraftPrompt()` は次を収集し、`.bob-review/review-input-draft/ai-draft-prompt.md` を生成する。

- document candidates
- 既存 `review-input.yaml` diagnostics
- Git / Bazaar diff summary
- allowed enum
- required JSON shape
- discovery warnings

AI への出力制約は、Markdown や YAML ではなく `ReviewInputDraft` JSON object のみとする。

`applyAiReviewInputDraft()` は raw JSON、fenced JSON、clipboard text から JSON を抽出し、builder を通して `review-input.yaml` を生成する。

`reviewInputDiagnostics.ts` は既存 input の schema / path diagnostics、自然言語説明、legacy repair を提供する。

## 11. Traceability Catalog 詳細

Traceability catalog は `.bob-trace/traceability-catalog.json` に保存する。

```ts
interface TraceabilityCatalog {
  schema_version: 1
  documents: TraceabilityDocument[]
  domains: TraceabilityDomain[]
  items: TraceabilityItem[]
  links?: TraceabilityLink[]
  decisions?: TraceabilityDecision[]
}
```

主な enum:

| 種類 | 値 |
| --- | --- |
| status | `proposed`, `accepted`, `rejected`, `deprecated` |
| item type | `requirement`, `basic_design`, `detailed_design`, `test_spec`, `qa_item`, `review_finding` |
| link type | `satisfies`, `elaborates`, `verified_by`, `clarifies`, `reviewed_by`, `references` |
| gate | `basic_design`, `detailed_design`, `test` |

`traceabilityCatalogStore.ts` は catalog 読み込み、空 catalog 作成、backup 付き書き込み、gate report 書き込みを行う。`validateAndWriteTraceabilityGateReport()` は validation 結果を Markdown 化して `.bob-trace/gate-report.md` に保存する。

`buildReviewInputDraftFromTraceability()` は accepted item だけを対象に、item type を artifact kind へ変換して `ReviewInputDraft` を作る。

## 12. Traceability Commands / Webview

`traceabilityCommands.ts` は次を提供する。

| 関数 | 処理 |
| --- | --- |
| `runPrepareAiTraceabilityDraft` | diff summary と catalog を使い、AI draft prompt を `.bob-trace/ai-traceability-draft` に生成する。 |
| `runApplyAiTraceabilityDraft` | inline JSON、clipboard、path、既定 `ai-draft*.json` から draft を読み、catalog に反映する。 |
| `runValidateTraceabilityCatalog` | catalog を検証し gate report を生成する。 |
| `runCreateReviewInputFromTraceability` | accepted item から `review-input.yaml` を生成する。 |
| `runOpenTraceabilityPrep` | Webview を開く。 |

`resolveTraceabilityDraftText()` は inline JSON を優先し、次に Markdown link / quoted path / bare `.json` path / `traceabilityDraftJsonPath` / 既定 `ai-draft*.json` を探す。path は workspace 内に限定する。

`traceabilityPrepWebview.ts` は `Traceability Prep` panel を作成する。タブは Domains、Items、Links、Decisions、Gate Report、Review Input Preview である。Save 時は catalog を backup 付きで保存し、gate report を再生成する。

## 13. Preprocess pipeline 詳細

`preprocessReview()` は次の順で処理する。

1. `validateReviewInput(inputPath, workspaceRoot)` で YAML と artifact path を検証する。
2. `collectGitDiff()` または Bazaar diff 収集を実行する。
3. `extractDocuments()` で文書 evidence を抽出する。
4. `analyzeCodeChanges()` で C / C++ 専用解析と汎用コード evidence 生成を統合実行する。
5. `buildTraceability()` で対応候補を作る。
6. `buildReviewPackage()` で成果物を出力する。

`PreprocessResult` は status、reviewId、packageDir、changedFiles、documentEvidence、codeEvidence、warnings、summary を返す。

## 14. Review Input Validation 詳細

`validateReviewInput(inputPath, workspaceRoot)` は次を行う。

1. `readTextFile()` で YAML text を読む。
2. `YAML.parse()` で object 化する。
3. `review-input` schema を `loadSchemaValidator()` で読み込む。
4. schema validation を行う。
5. `artifacts` に指定された文書 path の存在確認を行う。
6. `ReviewInput` を返す。

## 15. VCS Diff Collector 詳細

Git では次を実行する。

```text
git diff --find-renames --name-status <base> <head>
git diff --find-renames --numstat <base> <head>
git diff --find-renames --unified=80 <base> <head>
```

`diffFixturePath` が指定された場合は Git を実行せず fixture JSON を読み込む。

review input または option で Bazaar / bzr が指定された場合、`bzrPath` を使い、必ず `--no-aliases` を付けて差分を取得する。Bazaar 出力も `textEncoding` の decode 対象である。

`DiffSummary` は base、head、files、unifiedDiff、warnings を持つ。`files` は path、status、additions、deletions、language、test file flag、interface candidate flag を持つ。Git rename は `renamed` status として扱い、binary numstat は追加削除行数を未確定として警告に残す。

`languageClassifier.ts` は拡張子から `c`、`cpp`、`h`、`hpp`、`typescript`、`javascript`、`python`、`csharp`、`java`、`go`、`rust`、`shell`、`sql`、`json`、`yaml`、`markdown`、`text`、`unknown` に分類する。`analysis_options.language` が未指定の場合は全対応言語を対象にし、指定された場合だけ変更ファイルをその言語集合に絞る。

## 16. Document Extractor 詳細

`extractDocuments(reviewInput, { workspaceRoot })` は `reviewInput.artifacts` を走査する。

| artifact key | evidence type | prefix |
| --- | --- | --- |
| `requirements` | `requirement` | `REQ` |
| `basic_design` | `basic_design` | `BD` |
| `detailed_design` | `detailed_design` | `DD` |
| `test_spec` | `test_spec` | `TC` |
| `ledgers` | `ledger` | `LEDGER` |
| `tickets` | `ticket` | `TICKET` |

Markdown は見出しごとに block 化する。`.docx` は `mammoth.convertToHtml()` と `cheerio` で heading、paragraph、table を抽出する。`.xlsx` は `read-excel-file` で workbook を読み、指定 sheets または全 sheets を走査する。既知脆弱性のある `xlsx` package には依存しない。

## 17. Code Change Analyzer 詳細

`analyzeCodeChanges()` は pipeline から呼ばれる唯一のコード解析入口である。C / C++ 系ファイルは `cCppChangeAnalyzer` へ渡し、その他の対応言語は `genericCodeEvidenceAnalyzer` へ渡す。C / C++ の header / define-only 変更で関数 evidence が生成されない場合も、変更 hunk が残っていれば汎用 fallback evidence を生成し、Bob が参照できる `SRC-*` を失わない。

### 17.1 C / C++ Change Analyzer

`c` / `cpp` / `h` / `hpp` の変更ファイルを対象とする。`analyzeCppChanges()` は unified diff から変更行と token を抽出し、source file を読み込み、正規表現ベースで関数範囲を検出する。変更行を含む関数を changed function とし、callee / direct caller、`#define`、global、RT 禁止処理候補、code slice、code evidence を生成する。

関数検出は軽量な正規表現ベースであり、完全な C / C++ 意味解析ではない。

### 17.2 Generic Code Evidence Analyzer

`genericCodeEvidenceAnalyzer` は TypeScript、JavaScript、Python、C#、Java、Go、Rust、Shell、SQL、JSON、YAML、Markdown、text、unknown を対象に、unified diff の file / hunk 単位で `SRC-xxxx` evidence を生成する。詳細な AST 解析は行わず、path、language、status、hunk header、追加削除行、前後コンテキストを `code-slices/*.md` と `evidence-index.json` に残す。`changed-symbols.json` には file scope の汎用 symbol を出力し、traceability map と Bob 出力検証から参照できるようにする。

## 18. Traceability Builder 詳細

`buildTraceability()` は、review input、document evidence、code evidence、diff summary をもとに、要求・設計・コード・テスト仕様の対応候補を作る。現状は evidence ID、文書種別、変更シンボル、review focus を用いた候補生成であり、AI 判断の代替ではない。

## 19. Review Package Builder 詳細

`buildReviewPackage()` は output directory を作成し、prompt template、code slices、table evidence、JSON index 群、Markdown summary 群、`bob-input.md` を書き出す。

| ファイル | 内容 |
| --- | --- |
| `input-normalized.json` | `ReviewInput`。 |
| `changed-files.json` | `DiffSummary.files` と warning。 |
| `changed-symbols.json` | symbols、functions、defines、globals、call graph、RT 候補。 |
| `document-index.json` | documents と warning。 |
| `evidence-index.json` | evidence metadata。本文は除外。 |
| `traceability-map.json` | traceability rows と warning。 |
| `change-summary.md` | review summary と変更ファイル一覧。 |
| `diff-context.md` | code slices と raw unified diff。 |
| `document-excerpts.md` | 文書根拠抜粋。 |
| `traceability-map.md` | 対応候補。 |
| `deterministic-checks.md` | warning と evidence duplicate check。 |
| `bob-input.md` | Bob 投入用の最終 Markdown。 |

`evidence-index.json` には本文を含めず metadata だけを保存する。Bob 出力検証ではこの file を参照し、存在しない `evidence_id` を検出する。

## 20. Bob Output Capture / Validator 詳細

`runCaptureBobOutput()` は次の順で text を決める。

1. command argument が string の場合。
2. options の `text`。
3. workflow state / inputs / args から組み立てた text。
4. clipboard text。

`extractYamlFromText()` は fenced YAML code block、text 全体が `schema_version:` を含む YAML、text 中の `schema_version:` 以降を試す。YAML parse に成功した場合、`YAML.stringify(parsed)` で正規化し、`bobOutputPath` に保存する。

`validateBobOutput()` は `bobOutputPath` を読み、schema を検証し、`packageDir/evidence-index.json` と照合する。`findings[].evidence[]` と `questions[].evidence[]` の `evidence_id` が存在しない場合は error とする。findings / questions が 30 件超の場合は warning を出す。

## 21. Human Triage 詳細

`humanTriageHelper.ts` は次のファイルを生成する。

| ファイル | 詳細 |
| --- | --- |
| `triage-result.yaml` | finding / question ごとに decision、owner、reason、follow_up を記入する雛形。 |
| `accepted-findings.md` | finding の要約と evidence を列挙する。 |
| `questions-to-author.md` | question の要約、理由、owner、action を列挙する。 |
| `rejected-findings.md` | 棄却指摘を人間が追記する雛形。 |
| `follow-up-actions.md` | recommended action / suggested action を一覧化する。 |

triage は最終判断を自動化しない。`triage-result.yaml` の `decision`、`reason`、`owner`、`due` は人間が記入する。

## 22. File I/O と文字コード

`readTextFile()` は `decodeTextBuffer()` を使って file を読み込む。既定は `auto` である。UTF-8 と Shift-JIS / CP932 系日本語テキストを想定する。生成ファイルは UTF-8 で書き込む。`writeTextFile()` は親 directory を recursive に作成してから書き込む。

## 23. Error Handling 詳細

| 発生箇所 | エラー処理 |
| --- | --- |
| review input parse | YAML parse error または schema error を throw。 |
| missing artifact | missing file 一覧を含む error を throw。 |
| AI draft parse | result `status: "error"` と errors を返す。 |
| traceability catalog parse | read result `status: "error"` と errors を返す。 |
| traceability gate error | review-input 生成を止め、gate report を更新する。 |
| Git / Bazaar command failure | preprocess 失敗。 |
| document extraction failure | warning に追加して続行。 |
| changed function 未検出 | warning に追加して続行。 |
| Bob output YAML 不在 | capture result `status: "error"`。 |
| Bob output parse error | capture result `status: "error"` または validation errors。 |
| evidence-index 不在 | validation error。 |
| unknown evidence_id | validation error。 |
| triage output write error | command failure。 |
| initialize workspace | workflow は backup 後更新、既存 review-input は上書きしない。 |

## 24. セキュリティ詳細

- Bob に渡す情報は、前処理で生成した `review-package` に固定する。
- Bob が外部ファイルを追加探索する前提にはしない。
- Bob 出力は `evidence-index.json` に存在する evidence のみを根拠として認める。
- 通常フローでは commit、push、PR コメント投稿、ソースコード変更、文書更新、正式承認を行わない。
- `ReviewInputBuilder` は artifact path escape を拒否する。
- traceability draft path は workspace 内だけ許可する。
- catalog path / report path は運用互換のため absolute path も扱うが、既定は workspace 内である。

## 25. 状態と保存先

| 種類 | 既定保存先 |
| --- | --- |
| workflow template | `.bob/workflows/code-consistency-review/WORKFLOW.md` |
| 入力 | `review-input.yaml` |
| 初期 placeholder | `docs/review-input-placeholder.md` |
| review-package | `.bob-review/review-package` |
| review-input AI draft prompt | `.bob-review/review-input-draft/ai-draft-prompt.md` |
| traceability catalog | `.bob-trace/traceability-catalog.json` |
| traceability gate report | `.bob-trace/gate-report.md` |
| traceability AI draft prompt | `.bob-trace/ai-traceability-draft/ai-draft-prompt.md` |
| Bob output | `.bob-review/bob-output/bob-output.yaml` |
| human triage | `.bob-review/human-triage` |
| prompt template copy | `.bob-review/review-package/prompts` |
| code slices | `.bob-review/review-package/code-slices` |
| table excerpts | `.bob-review/review-package/tables` |

## 26. 同梱 workflow 詳細

同梱 workflow:

```text
templates/.bob/workflows/code-consistency-review/WORKFLOW.md
```

現行 template は `schemaVersion: workflow-register/v1` を使い、`requires.bob.minVersion`、`guardrails.allowedCommands`、`guardrails.requireApproval`、`inputs`、`tools`、`artifacts`、`completion`、typed `steps` を持つ。

主な step:

| Step | Type | 処理 |
| --- | --- | --- |
| `preprocess-review-package` | command | review-package と `bob-input.md` を生成する。 |
| `run-bob-pre-review` | agent | `bob-input.md` を使って不整合候補を抽出する。 |
| `capture-bob-output` | command | Bob YAML 出力を保存する。 |
| `validate-bob-output` | command | schema と evidence-index で検証する。 |
| `human-triage` | command | triage 成果物を生成する。 |
| `handoff-formal-review` | agent | 正式レビューへの引き継ぎ Markdown を作る。 |

## 27. テスト設計

| 対象 | 観点 |
| --- | --- |
| `workspaceInitializer` | workflow 作成、更新、backup、review-input 雛形、placeholder document、既存 input 非上書き。 |
| `reviewInputDiscovery` | docs 探索、ID 抽出、artifact kind 推定、warning。 |
| `reviewInputBuilder` | enum、focus preset、path containment、strictPaths、schema validation、backup。 |
| `reviewInputAiDraftProvider` | prompt 内容、diff summary、JSON parse、draft 適用。 |
| `reviewInputDiagnostics` | diagnostics、repair、説明。 |
| `traceabilityCatalogStore` | read、empty catalog、backup write、gate report。 |
| `traceabilityValidation` | required field、link 整合、decision、status。 |
| `traceabilityPrepController` | action apply、model build、preview。 |
| `traceabilityCommands` | AI draft prompt、draft text resolution、catalog 反映、review-input 生成。 |
| `reviewInputValidator` | schema error、missing artifact。 |
| `languageClassifier` | 拡張子分類、supported language enum、`analysis_options.language` filter。 |
| `gitDiffCollector` | name-status / numstat parse、rename、binary numstat、language 判定、fixture 利用、Bazaar mode。 |
| `documentExtractor` | Markdown / docx / xlsx 抽出、selector、evidence ID。 |
| `codeChangeAnalyzer` | C / C++ 解析と汎用 evidence fallback の統合。 |
| `cCppChangeAnalyzer` | function range、changed function、callee / caller、RT 禁止候補。 |
| `genericCodeEvidenceAnalyzer` | 非 C/C++ diff hunk、file scope symbol、code slice 生成。 |
| `traceabilityBuilder` | evidence と code symbol の対応候補。 |
| `reviewPackageBuilder` | 生成ファイル、evidence-index、bob-input。 |
| `bobOutputCapture` | fenced YAML、schema_version 開始、parse error。 |
| `bobOutputValidator` | schema error、unknown evidence_id、warning 上限。 |
| `humanTriageHelper` | triage-result と Markdown 出力。 |
| `workflowProviderRegistration` | 15 provider 登録、option merge、state handoff。 |
| workflow template | requires、guardrails、artifacts、steps、prompt 制約。 |
| 実機 | VS Code / IBM Bob / workflow-register / Bob Workflow UI / Webview / 実ファイルでの結合動作。 |

詳細な単体テスト仕様は `unit-test-spec-ja.md`、実機テスト仕様は `real-machine-test-spec-ja.md` に定義する。

## 27. 変更時の注意点

- `review-input.schema.json` を変えた場合は README、設計書、テスト fixture、builder を同期する。
- `bob-output.schema.json` を変えた場合は prompt `output-format.md` と validator test を同期する。
- traceability model を変えた場合は catalog store、validation、Webview、review-input 生成を同期する。
- evidence ID 形式を変えた場合は document extractor、code analyzer、validator、triage を確認する。
- C / C++ 解析を強化する場合は、正規表現ベースの限界と false positive / false negative を docs に明記する。
- workspace path 制約を強化する場合は、absolute path を使う既存利用との互換性を確認する。
- `workspaceInitializer` を変更する場合は、既存 workflow backup、review-input 非上書き、placeholder 作成を確認する。
