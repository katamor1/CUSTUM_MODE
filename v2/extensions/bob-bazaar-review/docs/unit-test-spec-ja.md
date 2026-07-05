# bob-bazaar-review 単体テスト仕様書

## 1. 目的

本書は `extensions/bob-bazaar-review` の単体テスト仕様を定義する。対象は Bazaar CLI wrapper、文字コード、workspace 解決、review packet、workflow-register bridge、project rules、review-result capture、MCP server、review record / triage / summary、直接レビュー command である。

## 2. テスト実行方式

| 項目 | 内容 |
| --- | --- |
| 実行コマンド | `npm run compile && node --test test/*.test.js` |
| 対象成果物 | `out/` 配下へ compile された JavaScript |
| テストランナー | Node.js built-in test runner |
| 外部依存 | VS Code API、Bob API、Bazaar CLI は mock / stub 化する |
| ファイル I/O | `fs.mkdtemp()` で一時 Bob workspace / Bazaar workspace を作成する |

## 3. 共通テストデータ

| データ | 内容 |
| --- | --- |
| `bazaarRootFixture` | `.bzr` marker を持つ一時 directory。 |
| `bobRootFixture` | `.bob` marker を持つ一時 directory。 |
| `singleRevisionLog` | revision、author、timestamp、message を含む Bazaar log。 |
| `unifiedDiffSmall` | 1 file 変更の unified diff。 |
| `unifiedDiffLarge` | `maxDiffBytes` を超える unified diff。 |
| `addedFileDiff` | added file を含む diff。 |
| `projectChecklist` | `rules[]` と category を持つ checklist JSON。 |
| `reviewResultValid` | schema に合う review-result JSON。 |
| `reviewResultInvalid` | required field または evidence 条件に違反する JSON。 |
| `mcpRequest` | `initialize`、`tools/list`、`tools/call` の JSON-RPC request。 |

## 4. テスト項目

### BZR-UT-001 BazaarClient: `--no-aliases` を必ず付与する

- 入力: `root`、`log`、`diffRevision`、`diffRange`、`status` の各 method 呼び出し。
- 期待結果: stub された `execFile` の args 先頭に `--no-aliases` が含まれる。

### BZR-UT-002 BazaarClient: diff 系は exit code 1 を許可する

- 入力: `diffRevision` 実行時に exit code 1 と stdout diff を返す stub。
- 期待結果: 例外を投げず stdout text を返す。

### BZR-UT-003 BazaarClient: 非 diff 系の exit code 1 はエラーになる

- 入力: `log` 実行時に exit code 1 を返す stub。
- 期待結果: `BazaarError` が throw され、cwd / args / stdout / stderr / code を含む。

### BZR-UT-004 BazaarClient: unsafe revision を拒否する

- 入力: 改行、空文字、不許可文字を含む revision。
- 期待結果: Bazaar CLI を呼ばず validation error を返す。

### BZR-UT-005 BazaarClient: unsafe relative path を拒否する

- 入力: `../secret.txt`、absolute path、空 path。
- 期待結果: Bazaar CLI を呼ばず validation error を返す。

### BZR-UT-006 TextEncoding: UTF-8 を decode できる

- 入力: UTF-8 日本語 Buffer、encoding `utf8`。
- 期待結果: 文字化けなく string が返る。

### BZR-UT-007 TextEncoding: Shift-JIS / CP932 を decode できる

- 入力: Shift-JIS / CP932 日本語 Buffer、encoding `shift_jis` / `cp932` / `windows-31j`。
- 期待結果: 文字化けなく string が返る。

### BZR-UT-008 TextEncoding: auto fallback が働く

- 入力: UTF-8 として不自然な Buffer、encoding `auto`。
- 期待結果: Shift-JIS 系として再 decode される。

### BZR-UT-009 WorkspaceResolver: `.bob` と `.bzr` を分離解決する

- 入力: Bob workspace と Bazaar workspace が別 folder の multi-root。
- 期待結果: `resolveBobWorkspaceFolder()` と `resolveBazaarWorkspaceFolder()` が別 folder を返す。

### BZR-UT-010 WorkspaceResolver: single candidate を自動採用する

- 入力: `.bzr` candidate が1件だけの workspace。
- 期待結果: QuickPick を呼ばず candidate を返す。

### BZR-UT-011 ReviewPacket: 基本 section を生成する

- 入力: repository root、mode、revision、log、diff。
- 期待結果: `# Bazaar Revision Review Request`、repository root、mode、log、diff section を含む。

### BZR-UT-012 ReviewPacket: diff truncation を明示する

- 入力: `maxDiffBytes` を超える diff。
- 期待結果: diff が切り詰められ、truncated message を含む。

### BZR-UT-013 RevisionInfo: added file contents section を生成する

- 入力: added file を含む revision info、`cat` stub。
- 期待結果: 上限内の追加ファイル本文 section が生成される。

### BZR-UT-014 RevisionInfo: added file contents 上限を守る

- 入力: 複数 added file と小さい `maxAddedFileContentBytes`。
- 期待結果: 上限超過分は省略され、summary に反映される。

### BZR-UT-015 BazaarReviewCommands: Bob 拡張なしでは Markdown document で停止する

- 入力: `IBM.bob-code` 不在の stub 環境。
- 期待結果: Bob context 追加 command を呼ばず、Markdown document を開く。

### BZR-UT-016 BazaarReviewCommands: workflow-register 不在時は Bob context へ追加する

- 入力: `IBM.bob-code` あり、`workflow-register` なし。
- 期待結果: `bob-code.addToContext` 相当の command が呼ばれる。

### BZR-UT-017 BazaarReviewCommands: workflow-register ありでは action を選択する

- 入力: `IBM.bob-code` と `workflow-register` がある stub 環境。
- 期待結果: 情報ダイアログが表示され、選択に応じて Bob context / clipboard / file save が実行される。

### BZR-UT-018 WorkflowRegisterBridge: initial target を inputs から生成する

- 入力: `revisionMode`、`revision`、`baseRevision`、`targetRevision`、`bazaarRoot` を持つ inputs。
- 期待結果: `BazaarReviewInitialTarget` が生成される。

### BZR-UT-019 WorkflowRegisterBridge: root は action input を優先する

- 入力: `input.bazaarRoot`、`input.repositoryRoot`、inputs 側 root が混在する。
- 期待結果: action input 側の root が優先される。

### BZR-UT-020 WorkflowRegisterBridge: capture options を workflow context から生成する

- 入力: `state.reviewRules` に checklistItems を含む workflow context。
- 期待結果: `expectedChecklistItems`、`workspaceRoot`、`workflowState` が設定される。

### BZR-UT-021 WorkflowBridge: review packet から context を作る

- 入力: review packet Markdown。
- 期待結果: repository root、mode、diff summary、target label などが workflow state 用 result に含まれる。

### BZR-UT-022 ProjectRules IO: checklist / schema を読み込む

- 入力: `.bob/review/checklist.json` と schema file。
- 期待結果: parsed object と path metadata が返る。

### BZR-UT-023 ProjectRules IO: workspace 外 path を拒否する

- 入力: `../outside/checklist.json`。
- 期待結果: 読み込みを拒否する。

### BZR-UT-024 ResultCaptureCore: fenced JSON を抽出する

- 入力: Markdown fenced code block 内の JSON。
- 期待結果: JSON object が抽出される。

### BZR-UT-025 ResultCaptureCore: severity / summary を正規化する

- 入力: severity 表記揺れ、summary 欠落を含む JSON。
- 期待結果: schema に合わせて正規化される。

### BZR-UT-026 ResultCaptureCore: JSON と Markdown を保存する

- 入力: valid review-result、Bob workspace。
- 期待結果: `.bob/review/results/<review_id>.json` と `.md` が作成される。

### BZR-UT-027 ResultCaptureCore: invalid JSON は error result になる

- 入力: required field 不足の JSON。
- 期待結果: `status: "error"` と validation issues が返る。

### BZR-UT-028 ReviewResultValidationCommand: active selection を検証する

- 入力: active editor selection に valid JSON。
- 期待結果: 有効メッセージを表示し、summary 選択時に Markdown document を開く。

### BZR-UT-029 ReviewResultValidationCommand: invalid JSON report を表示する

- 入力: active editor full text に invalid JSON。
- 期待結果: Markdown validation report を開く。

### BZR-UT-030 ReviewResultsStore: 最新 result を取得する

- 入力: 複数 result JSON と更新時刻。
- 期待結果: mtime が最新の result を返す。

### BZR-UT-031 ReviewResultsStore: review id 指定で取得する

- 入力: review id。
- 期待結果: 対応する JSON result を返す。存在しない場合は not found 扱い。

### BZR-UT-032 MCP Server: initialize と tools/list を返す

- 入力: JSON-RPC `initialize`、`tools/list`。
- 期待結果: serverInfo、capabilities、tool definitions が返る。

### BZR-UT-033 MCP Server: Bazaar tools は readonly のみ提供する

- 入力: `tools/list`。
- 期待結果: commit / push / pull / revert などの tool が含まれない。

### BZR-UT-034 MCP Server: tools/call エラーを isError に変換する

- 入力: invalid arguments または BazaarError を発生させる tool call。
- 期待結果: `isError: true` と text content を返す。

### BZR-UT-035 WorkflowStepCompletion: best effort で完了 command を呼ぶ

- 入力: workflow step completion stub が成功 / 失敗する2ケース。
- 期待結果: 成功時は完了 command 呼び出し、失敗時は warning のみで packet 生成結果を壊さない。

### BZR-UT-036 Workflow template: 現行 schema 要素を持つ

- 入力: 同梱 `WORKFLOW.md`。
- 期待結果: `schemaVersion`、`requires`、`preflight`、`guardrails.requireApproval`、`artifacts`、`completion`、typed `steps` を含む。

### BZR-UT-037 MCP Server: write tools は既定非公開

- 入力: env 未指定の `tools/list` と `project_rules_init` call。
- 期待結果: `project_rules_init` は `tools/list` に出ず、直接 call は `isError: true` になる。

### BZR-UT-038 MCP Server: allowed roots 未設定 cwd を拒否する

- 入力: `BOB_BAZAAR_ALLOWED_ROOTS` 未設定の Bazaar tool call。
- 期待結果: `BOB_BAZAAR_ALLOWED_ROOTS` または `BOB_BAZAAR_ALLOW_UNRESTRICTED_CWD=1` を要求する error を返す。

### BZR-UT-039 ReviewRecords: record / triage / summary を生成・検証する

- 入力: 保存済み review-result、review packet、campaign template。
- 期待結果: `record.yaml`、`triage.yaml`、`summary.json` / `summary.md` が作成され、invalid decision / missing triage / summary mismatch を検出する。

### BZR-UT-040 ReviewRecords: path segment と artifact path を検証する

- 入力: Windows 予約文字、device name、workspace escape を含む campaignId / reviewId / artifact path。
- 期待結果: record / triage / packet artifact の保存前に拒否する。

### BZR-UT-041 ResultCaptureCore: metadata producer version は package version と一致する

- 入力: valid review-result。
- 期待結果: artifact metadata の `producer_version` が `package.json` の version と一致する。

## 4.1 実テスト対応表

| 観点 | 主な testcase ID | 実テスト file |
| --- | --- | --- |
| Bazaar CLI wrapper / no-aliases / unsafe revision | BZR-UT-001〜005 | `test/bazaarClient.test.js`, `test/bazaarReviewCommandWiring.test.js` |
| 文字コード | BZR-UT-006〜008 | `test/extensionEncoding.test.js` |
| workspace root / explicit root | BZR-UT-009〜010 | `test/workspaceRoots.test.js`, `test/reviewGuiInitialTarget.test.js` |
| review packet / revision info / direct commands | BZR-UT-011〜017 | `test/reviewLimits.test.js`, `test/reviewTarget.test.js`, `test/bazaarReviewCommandWiring.test.js` |
| workflow bridge / provider / step completion | BZR-UT-018〜021、035〜036 | `test/workflowBridge.test.js`, `test/workflowProviderRegistration.test.js`, `test/workflowStepCompletion.test.js`, `test/workflowTemplate.test.js` |
| project rules / capture / validation / result store | BZR-UT-022〜031、041 | `test/projectRulesPath.test.js`, `test/resultCaptureCore.test.js`, `test/reviewResultsStore.test.js`, `test/mcpServerVersion.test.js` |
| MCP server / write tools / allowed roots | BZR-UT-032〜034、037〜038 | `test/mcpWriteTools.test.js`, `test/mcpAllowedRoots.test.js`, `test/mcpRequestLimit.test.js`, `test/mcpSourceLayout.test.js` |
| review record / triage / campaign summary | BZR-UT-039〜040 | `test/reviewRecordsCore.test.js`, `test/reviewRecordCommands.test.js`, `test/phase1RecordTemplates.test.js` |
| docs / source layout contracts | BZR-UT-036 | `test/architectureContracts.test.js`, `test/extensionSourceLayout.test.js` |

## 5. 非機能観点

- Bazaar CLI は実行せず、`execFile` stub で args / cwd / env を検証する。
- VS Code UI は `showInputBox`、`showInformationMessage`、`showQuickPick`、`openTextDocument`、`showTextDocument` を stub 化する。
- Bob extension / workflow-register extension の有無は `vscode.extensions.getExtension` stub で制御する。
- 日本語 fixture は UTF-8 と Shift-JIS / CP932 の両方を持つ。
- file path のテストは Windows / POSIX 差異を吸収する。

## 6. 完了条件

- `npm run compile` が成功する。
- `node --test test/*.test.js` が成功する。
- Bazaar CLI、VS Code、Bob、workflow-register の実体が無くてもテストが完結する。
- readonly 境界、path validation、workspace 分離、result 保存が回帰テストで守られる。
