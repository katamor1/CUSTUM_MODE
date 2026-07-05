# bob-code-consistency-review 単体テスト仕様書

## 1. 目的

本書は `extensions/bob-code-consistency-review` の単体テスト仕様を定義する。対象は workspace 初期化、review-input 作成、AI draft、traceability sidecar、前処理 pipeline、文書抽出、C / C++ 軽量解析、複数言語の汎用コード根拠生成、review-package 生成、Bob 出力 capture / validation、triage、workflow-register provider である。

## 2. テスト実行方式

| 項目 | 内容 |
| --- | --- |
| 実行コマンド | `npm run compile && node --test test/*.test.js` |
| 対象成果物 | `out/` 配下へ compile された JavaScript |
| テストランナー | Node.js built-in test runner |
| 外部依存 | VS Code API、workflow-register、Git / Bazaar CLI は mock / stub 化する |
| ファイル I/O | `fs.mkdtemp()` で一時 workspace を作成し、`.bob-review` / `.bob-trace` / `.bob` を検証する |

## 3. 共通テストデータ

| データ | 内容 |
| --- | --- |
| `workspaceFixture` | `docs/`、`src/`、`.bob/` を持つ一時 workspace。 |
| `reviewInputValid` | requirements / basic_design / detailed_design / test_spec を含む valid YAML。 |
| `reviewInputInvalid` | required field 不足または artifact path 不正を含む YAML。 |
| `traceabilityCatalogEmpty` | schema_version 1、空 arrays の catalog。 |
| `traceabilityCatalogAccepted` | accepted requirement / design / test item と link を含む catalog。 |
| `traceabilityDraftJson` | catalog に追加する AI draft JSON。 |
| `gitDiffFixture` | name-status、numstat、unified diff を含む fixture。 |
| `bazaarDiffFixture` | Bazaar mode 用の unified diff fixture。 |
| `multiLanguageGitDiffFixture` | TypeScript、Python、Java、rename、空白入り path、binary numstat を含む Git fixture。 |
| `markdownDoc` | REQ / BD / DD / TC ID を含む Markdown。 |
| `docxDoc` | heading / paragraph / table を含む docx fixture。 |
| `xlsxDoc` | sheet / row ID を含む xlsx fixture。 |
| `cppSource` | 変更関数、callee、global、RT 禁止候補を含む C / C++ source。 |
| `genericSource` | TypeScript、Python、Java など、hunk 単位 evidence を確認する source。 |
| `bobOutputValid` | schema と evidence index に合う YAML。 |
| `bobOutputInvalidEvidence` | 存在しない evidence_id を参照する YAML。 |

## 4. テスト項目

### CCR-UT-001 WorkspaceInitializer: workflow template を新規作成する

- 入力: `.bob/workflows/code-consistency-review/WORKFLOW.md` が存在しない workspace。
- 期待結果: workflow file が作成され、result status は `created`。

### CCR-UT-002 WorkspaceInitializer: workflow template を backup して更新する

- 入力: 既存 workflow が template と異なる workspace。
- 期待結果: `.bak-<timestamp>` が作成され、workflow file が template に更新される。

### CCR-UT-003 WorkspaceInitializer: workflow template が同一なら unchanged

- 入力: 既存 workflow が template と同一。
- 期待結果: status は `unchanged`、backup は作成されない。

### CCR-UT-004 WorkspaceInitializer: review-input 雛形と placeholder document を作成する

- 入力: `review-input.yaml` が存在しない workspace。
- 期待結果: `review-input.yaml` と `docs/review-input-placeholder.md` が作成される。

### CCR-UT-005 WorkspaceInitializer: 既存 review-input は上書きしない

- 入力: 独自内容の `review-input.yaml`。
- 期待結果: 内容は変わらず、backup path が返る。

### CCR-UT-006 ReviewInputDiscovery: docs 配下の Markdown ID を抽出する

- 入力: `docs/requirements.md` に `REQ-001` を含む workspace。
- 期待結果: kind `requirements`、sections `REQ-001` を持つ candidate が返る。

### CCR-UT-007 ReviewInputDiscovery: path 名から artifact kind を推定する

- 入力: `docs/基本設計.md`、`docs/詳細設計.md`、`docs/テスト仕様.md`。
- 期待結果: それぞれ `basic_design`、`detailed_design`、`test_spec` と推定される。

### CCR-UT-008 ReviewInputDiscovery: docs root 不在時は warning を返す

- 入力: `docs/` が無い workspace。
- 期待結果: documents は空、warnings に docs root 不在が含まれる。

### CCR-UT-009 ReviewInputBuilder: draft から valid review-input を生成する

- 入力: valid `ReviewInputDraft`。
- 期待結果: schema_version 1、review、artifacts、review_focus、analysis_options、bob_options を持つ YAML が生成される。

### CCR-UT-010 ReviewInputBuilder: focus preset を展開する

- 入力: `focus_preset: "interface"`、`review_focus` なし。
- 期待結果: `interface-impact` と `unintended-change` が review_focus に入る。

### CCR-UT-011 ReviewInputBuilder: enum 不正を error にする

- 入力: 不正な `review.change_type`、`review.vcs`、`artifact.kind`。
- 期待結果: `status: "error"` と enum error が返る。

### CCR-UT-012 ReviewInputBuilder: workspace 外 artifact path を拒否する

- 入力: `../outside.md` を含む artifact candidate。
- 期待結果: `artifact path escapes workspace` error が返る。

### CCR-UT-013 ReviewInputBuilder: strictPaths=true で missing artifact を拒否する

- 入力: 存在しない artifact path。
- 期待結果: missing path error が返る。

### CCR-UT-014 ReviewInputAiDraftProvider: prompt を生成する

- 入力: workspace、base/head/vcs、document candidates、diff fixture。
- 期待結果: `.bob-review/review-input-draft/ai-draft-prompt.md` が作成され、allowed enum、diff summary、candidate JSON を含む。

### CCR-UT-015 ReviewInputAiDraftProvider: fenced JSON を適用する

- 入力: fenced JSON の `ReviewInputDraft`。
- 期待結果: `review-input.yaml` が生成され、既存 file がある場合は backup される。

### CCR-UT-016 ReviewInputDiagnostics: invalid input を診断する

- 入力: schema 不一致または missing artifact を含む `review-input.yaml`。
- 期待結果: diagnostics に schema / missing artifact が含まれる。

### CCR-UT-017 ReviewInputDiagnostics: legacy repair を実行する

- 入力: legacy 形式の input。
- 期待結果: 修復可能な場合は backup 付きで normalized input が保存される。不可の場合は error。

### CCR-UT-018 TraceabilityCatalogStore: catalog が無い場合は empty catalog を返す

- 入力: `.bob-trace/traceability-catalog.json` が無い workspace。
- 期待結果: `created: true`、schema_version 1、空 arrays が返る。

### CCR-UT-019 TraceabilityCatalogStore: catalog を backup 付きで保存する

- 入力: 既存 catalog と更新 catalog。
- 期待結果: `.bak-<timestamp>` が作成され、新 catalog が保存される。

### CCR-UT-020 TraceabilityValidation: required field 不足を error にする

- 入力: item の `source_document_id` または domain が不正な catalog。
- 期待結果: validation report status は `error`。

### CCR-UT-021 TraceabilityValidation: gate report Markdown を生成する

- 入力: errors / warnings を含む report。
- 期待結果: Markdown に status、error、warning、subject が含まれる。

### CCR-UT-022 TraceabilityCatalog: accepted item だけ review-input draft に変換する

- 入力: accepted / proposed / rejected item が混在する catalog。
- 期待結果: accepted item だけが artifact candidate に含まれる。

### CCR-UT-023 TraceabilityCatalog: item type を artifact kind に mapping する

- 入力: requirement、basic_design、detailed_design、test_spec、qa_item、review_finding。
- 期待結果: requirements、basic_design、detailed_design、test_spec、ledgers、tickets へ mapping される。

### CCR-UT-024 TraceabilityCommands: AI draft prompt を生成する

- 入力: catalog、docsRoot、base/head/vcs。
- 期待結果: `.bob-trace/ai-traceability-draft/ai-draft-prompt.md` が生成され、clipboard へコピーされる。

### CCR-UT-025 TraceabilityCommands: inline JSON draft を catalog に反映する

- 入力: inline JSON の traceability draft。
- 期待結果: catalog が更新され、gate report が生成される。

### CCR-UT-026 TraceabilityCommands: draft JSON path は workspace 内のみ許可する

- 入力: workspace 外 path を示す text。
- 期待結果: その path は無視され、workspace 内候補または raw text が使われる。

### CCR-UT-027 TraceabilityCommands: state.traceabilityDraftJson を利用する

- 入力: workflow action input の `state.traceabilityDraftJson`。
- 期待結果: `applyAiTraceabilityDraft` に text として渡される。

### CCR-UT-028 TraceabilityPrepController: action を catalog に適用する

- 入力: domain / item / link / decision を追加・更新・削除する action。
- 期待結果: catalog と Webview model が期待通り更新される。

### CCR-UT-029 TraceabilityPrepWebview: save で catalog と gate report を書く

- 入力: Webview save message。
- 期待結果: `writeTraceabilityCatalog` と `validateAndWriteTraceabilityGateReport` が呼ばれ、saved message が post される。

### CCR-UT-030 ReviewInputValidator: valid input を読み込む

- 入力: artifact path が存在する valid YAML。
- 期待結果: `ReviewInput` object が返る。

### CCR-UT-031 ReviewInputValidator: missing artifact を error にする

- 入力: 存在しない artifact path。
- 期待結果: missing artifact error が throw される。

### CCR-UT-032 GitDiffCollector: name-status / numstat を parse する

- 入力: Git diff stdout fixture。
- 期待結果: path、status、additions、deletions が `DiffSummary.files` に入る。

### CCR-UT-033 GitDiffCollector: fixture 利用時は Git を実行しない

- 入力: `diffFixturePath`。
- 期待結果: child process stub は呼ばれず、fixture の内容が使われる。

### CCR-UT-034 GitDiffCollector: Bazaar mode では `--no-aliases` を付ける

- 入力: `review.vcs: "bazaar"`。
- 期待結果: Bazaar 実行 args に `--no-aliases` が含まれる。

### CCR-UT-034A LanguageClassifier: 拡張子から対応言語へ分類する

- 入力: `.c`、`.hpp`、`.ts`、`.py`、`.cs`、`.java`、`.go`、`.rs`、`.sh`、`.sql`、`.json`、`.yaml`、`.md`、拡張子なし path。
- 期待結果: `c`、`hpp`、`typescript`、`python`、`csharp`、`java`、`go`、`rust`、`shell`、`sql`、`json`、`yaml`、`markdown`、`text` / `unknown` に分類される。

### CCR-UT-034B GitDiffCollector: rename / 空白入り path / binary numstat を扱う

- 入力: `--find-renames` を含む Git stdout fixture。
- 期待結果: renamed status、空白入り path、binary numstat の未確定行数が `DiffSummary` と warning に反映される。

### CCR-UT-035 DocumentExtractor: Markdown heading を evidence 化する

- 入力: ID 付き Markdown。
- 期待結果: selector と prefix に応じた `evidence_id` が生成される。

### CCR-UT-036 DocumentExtractor: docx heading / table を抽出する

- 入力: docx fixture。
- 期待結果: heading、paragraph、table が evidence に変換される。

### CCR-UT-037 DocumentExtractor: xlsx sheet / rows を抽出する

- 入力: xlsx fixture と sheet / row selector。
- 期待結果: 対象 sheet / row が table evidence になる。

### CCR-UT-038 CCppChangeAnalyzer: changed function を検出する

- 入力: unified diff と source file。
- 期待結果: 変更行を含む関数が changed function になる。

### CCR-UT-039 CCppChangeAnalyzer: callee / caller 候補を抽出する

- 入力: 関数呼び出しを含む C source。
- 期待結果: changed function の callees / direct callers が記録される。

### CCR-UT-040 CCppChangeAnalyzer: RT 禁止処理候補を検出する

- 入力: `printf`、`malloc`、`sleep` などを含む source。
- 期待結果: RT 禁止処理候補 warning / evidence が生成される。

### CCR-UT-040A GenericCodeEvidenceAnalyzer: 非 C/C++ diff hunk から evidence を生成する

- 入力: TypeScript、Python、Java などの unified diff。
- 期待結果: hunk 単位の `SRC-*` evidence、file scope symbol、`code-slices/*.md` content が生成される。

### CCR-UT-040B CodeChangeAnalyzer: C/C++ と汎用 evidence を統合する

- 入力: C/C++ header 変更と TypeScript / Python / Java 変更を含む diff。
- 期待結果: C/C++ で関数 evidence があれば維持し、関数 evidence が無い header / define-only 変更や非 C/C++ 変更には汎用 fallback evidence が生成される。

### CCR-UT-041 TraceabilityBuilder: evidence と code symbol の対応候補を生成する

- 入力: document evidence、code evidence、review focus。
- 期待結果: traceability rows と warnings が返る。

### CCR-UT-042 ReviewPackageBuilder: required files を生成する

- 入力: valid preprocess intermediate。
- 期待結果: JSON index、Markdown summary、prompts、code-slices、tables、`bob-input.md` が作成される。

### CCR-UT-043 ReviewPackageBuilder: evidence-index に本文を含めない

- 入力: document / code evidence。
- 期待結果: `evidence-index.json` は metadata のみで、本文は含まれない。

### CCR-UT-044 BobOutputCapture: fenced YAML を抽出する

- 入力: Markdown fenced YAML block。
- 期待結果: YAML が parse され、`bob-output.yaml` に正規化保存される。

### CCR-UT-045 BobOutputCapture: text 中の `schema_version:` 以降を抽出する

- 入力: 説明文の後に YAML が続く text。
- 期待結果: `schema_version:` 以降を YAML として保存する。

### CCR-UT-046 BobOutputCapture: parse error を返す

- 入力: 壊れた YAML。
- 期待結果: `status: "error"` と parse error が返る。

### CCR-UT-047 BobOutputValidator: schema valid かつ evidence valid で ok

- 入力: valid Bob output と evidence index。
- 期待結果: `status: "ok"`、errors 0。

### CCR-UT-048 BobOutputValidator: unknown evidence_id を error にする

- 入力: evidence index に存在しない ID を参照する Bob output。
- 期待結果: validation error が返る。

### CCR-UT-049 BobOutputValidator: findings / questions 30 件超で warning

- 入力: 31 件以上の findings または questions。
- 期待結果: warning が返る。

### CCR-UT-050 HumanTriageHelper: triage files を生成する

- 入力: valid Bob output と package dir。
- 期待結果: `triage-result.yaml`、`accepted-findings.md`、`questions-to-author.md`、`rejected-findings.md`、`follow-up-actions.md` が作成される。

### CCR-UT-051 WorkflowProviderRegistration: 15 provider を登録する

- 入力: mock workflow-register API。
- 期待結果: 15 個の provider ID が登録される。

### CCR-UT-052 WorkflowProviderRegistration: inputs と args を merge する

- 入力: inputs と args の同名 option。
- 期待結果: args が inputs より優先され、workflow context options が付加される。

### CCR-UT-053 WorkflowProviderRegistration: capture options を workflow state から作る

- 入力: workflow state / inputs / args に Bob output text 候補。
- 期待結果: `runCaptureBobOutput` に text / path options が渡る。

### CCR-UT-054 Workflow template: 現行 schema 要素を持つ

- 入力: 同梱 `WORKFLOW.md`。
- 期待結果: `schemaVersion`、`requires`、`guardrails.requireApproval`、`inputs`、`tools`、`artifacts`、`completion`、typed `steps` を含む。

## 5. 非機能観点

- VS Code API は mock し、実 UI を開かない。
- Git / Bazaar CLI は stub し、実 repository に依存しない。
- docx / xlsx fixture は最小サイズにし、抽出ロジックの分岐を網羅する。
- path の比較は Windows / POSIX 差異を吸収する。
- 生成ファイルは UTF-8 として検証する。
- 時刻付き backup path は正規表現で検証する。
- Bob 出力と evidence index の ID は deterministic fixture を使う。

## 6. 完了条件

- `npm run compile` が成功する。
- `node --test test/*.test.js` が成功する。
- review-input 作成、traceability sidecar、preprocess、capture、validate、triage の主要経路が独立した単体テストで検証される。
- Bob、VS Code UI、workflow-register、Git / Bazaar 実体が無くてもテストが完結する。
