# bob-bazaar-review 詳細設計書

## 1. 文書の位置づけ

本書は `extensions/bob-bazaar-review` 拡張機能の詳細設計を定義する。基本設計で示した責務を、実装モジュール、主要データ、処理シーケンス、エラー処理、安全制約、MCP tools、テスト観点へ展開する。

## 2. 実装構成

```text
extensions/bob-bazaar-review/
  package.json
  src/
    extension.ts
    bazaar.ts
    bazaarReviewCommands.ts
    bobCodeExtension.ts
    bobContext.ts
    bobWorkspaceInit.ts
    mcpConfig.ts
    reviewGui.ts
    reviewGuiTypes.ts
    reviewPacket.ts
    reviewResultValidationCommand.ts
    revisionInfo.ts
    textEncoding.ts
    workflowBridge.ts
    workflowRegisterBridge.ts
    workflowStepCompletion.ts
    workspaceResolver.ts
    workspaceRoots.ts
    mcp/
      server.ts
    projectRules/
      defaults.ts
      io.ts
      markdown.ts
      packet.ts
      resultCapture.ts
      resultCaptureCore.ts
      reviewResultsStore.ts
      schema.ts
      types.ts
      validator.ts
  templates/
    .bob/
      custom_modes.yaml
      mcp.json.template
      review/
      skills/
      workflows/
  test/
    *.test.js
```

`extension.ts` は command 登録と workflow provider mapping に集中し、workflow action input 解釈は `workflowRegisterBridge.ts`、直接レビュー command は `bazaarReviewCommands.ts`、review-result active editor 検証は `reviewResultValidationCommand.ts` に分離している。

## 3. 起動設計

`package.json` の `main` は `./out/extension.js` である。activation event は `onStartupFinished` と各 `bobBazaar.*` command である。

`activate(context)` は次を行う。

1. VS Code command を登録する。
2. `registerWorkflowProviders(context)` を呼び、`workflow-register` が利用可能な場合だけ action provider を登録する。
3. provider 登録失敗時は warning log に留める。

拡張は extension host 内に background process を保持しない。MCP server は Bob が必要時に別 process として起動する。

## 4. VS Code commands

| Command ID | 実装入口 | 用途 |
| --- | --- | --- |
| `bobBazaar.openReviewGui` | `openBazaarReviewGui` | Webview GUI を開く。 |
| `bobBazaar.collectReviewContext` | `collectReviewContext` | review packet から workflow context を作る。 |
| `bobBazaar.loadReviewRules` | `loadReviewRules` | checklist / schema を読み込む。 |
| `bobBazaar.captureReviewResult` | `captureReviewResult` | review-result JSON を検証・保存する。 |
| `bobBazaar.saveReviewResultFromClipboard` | `saveReviewResultFromClipboard` | clipboard だけを入力として保存する。 |
| `bobBazaar.configureMcp` | `configureMcp` | `.bob/mcp.json` に MCP server を登録する。 |
| `bobBazaar.initProjectRules` | `initProjectRules` | `.bob/review` 規約ファイルを初期化する。 |
| `bobBazaar.reviewRevision` | `reviewRevision(false)` | 単一 revision packet を作る。 |
| `bobBazaar.reviewRange` | `reviewRange(false)` | revision range packet を作る。 |
| `bobBazaar.reviewRevisionWithProjectRules` | `reviewRevision(true)` | 単一 revision packet に規約 section を追加する。 |
| `bobBazaar.reviewRangeWithProjectRules` | `reviewRange(true)` | range packet に規約 section を追加する。 |
| `bobBazaar.validateReviewResultJson` | `validateActiveReviewResultJson` | active editor の JSON を検証し、必要に応じて Markdown summary を表示する。 |

## 5. Workspace 解決詳細

`workspaceResolver.ts` は marker ごとの workspace folder 解決を提供する。

```ts
resolveBazaarWorkspaceFolder(options): Promise<vscode.WorkspaceFolder | undefined>
resolveBobWorkspaceFolder(options): Promise<vscode.WorkspaceFolder | undefined>
```

解決順序は、explicit root、workflow root、marker root candidates、active editor 所属 candidate、single candidate、QuickPick、single workspace fallback の順である。

GUI controller は Bazaar workspace と Bob workspace を別々に保持する。workflow action 実行時は `workflowRoot` を Bob workspace root として優先する。

## 6. BazaarClient 詳細

`BazaarClient` は Bazaar CLI 実行を一元化する。

| Method | Bazaar 操作 |
| --- | --- |
| `root(cwd)` | `bzr --no-aliases root` |
| `revno(cwd)` | `bzr --no-aliases revno` |
| `log(cwd, revision?)` | `bzr --no-aliases log` / `log -r REV` |
| `diffRevision(cwd, revision)` | `bzr --no-aliases diff -c REV` |
| `diffRange(cwd, base, target)` | `bzr --no-aliases diff -r BASE..TARGET` |
| `diffWorkingTree(cwd, base?)` | `bzr --no-aliases diff` / `diff -r BASE` |
| `cat(cwd, revision, path)` | `bzr --no-aliases cat -r REV PATH` |
| `status(cwd)` | `bzr --no-aliases status` |

CLI 実行は Buffer で受け取り、`textEncoding.ts` で decode する。diff 系 method は Bazaar の差分あり exit code `1` を成功扱いに含める。

## 7. Text Encoding 詳細

`textEncoding.ts` は Bazaar 出力 Buffer を string 化する。`auto` は UTF-8 を優先し、文字化けが疑われる場合に Shift-JIS 系へ fallback する。

対応値は `auto`、`utf8`、`shift_jis`、`cp932`、`windows-31j` である。

## 8. Review GUI 詳細

`BazaarReviewGuiController` は Webview と extension host の bridge である。

| Message | 処理 |
| --- | --- |
| `ready` | workspace state と `.bob` status を返す。 |
| `selectWorkspace` | Bazaar workspace を選択する。 |
| `initializeBobWorkspace` | `.bob` template 初期化を行う。 |
| `loadTarget` | Bazaar target metadata を取得する。 |
| `reviewTarget` | packet を生成し、`IBM.bob-code` 導入時のみ Bob context へ追加する。 |

`bob-code.addToContext` が失敗した場合、review packet を clipboard へコピーし、ユーザーに警告する。workflow 実行中の場合は `workflowStepCompletion.ts` が `workflowRegister.completeCurrentStep` を best effort で呼ぶ。

## 9. Direct Review Commands 詳細

`bazaarReviewCommands.ts` は `reviewRevision()` と `reviewRange()` を提供する。

- Bazaar workspace を選択する。
- Project rules 付きの場合は Bob workspace も選択する。
- revision / baseRevision / targetRevision を input box で取得する。
- `BazaarClient` で log / diff / added file contents を取得する。
- `buildReviewPacket()` で Markdown packet を作る。
- Markdown document を開く。
- `IBM.bob-code` がない場合はそこで停止する。
- `workflow-register` がない場合は Bob context へ追加する。
- `workflow-register` がある場合は Bob context 追加、clipboard copy、file save をユーザーに選択させる。

## 10. Review target 詳細

| Mode | 入力 | Bazaar 操作 |
| --- | --- | --- |
| `singleRevision` | `revision` | `bzr log -r REV`, `bzr diff -c REV` |
| `revisionRange` | `baseRevision`, `targetRevision` | `bzr diff -r BASE..TARGET`, 可能なら target log |
| `workingTreeSinceRevision` | 任意 `baseRevision` | `bzr revno`, `bzr diff -r BASE`, `bzr status` |

単一 revision と revision range では、新規追加ファイル本文を `bobBazaar.maxAddedFileContentBytes` の上限内で packet に含める。

## 11. Review Packet 詳細

review packet はレビュー対象、Bazaar log、diff、追加ファイル本文、project rules をまとめる Markdown である。主な section は次の通り。

- `# Bazaar Revision Review Request`
- repository root
- mode / revision / range
- Bazaar log
- Bazaar diff
- added file contents
- project rules checklist section
- review-result JSON output contract

`bobBazaar.maxDiffBytes` で diff 上限を設け、上限超過時は切り詰めを明示する。

## 12. `.bob` 初期化 / MCP 設定

`bobWorkspaceInit.ts` は `.bob/mcp.json`、`.bob/custom_modes.yaml`、`.bob/review/*`、Skill、workflow template を required file とする。missing file をコピーし、stale workflow template は refresh する。

`configureWorkspaceMcpServer` は `.bob/mcp.json` に server entry を追加・更新する。主な値は Node executable、`out/mcp/server.js`、`env.BZR_PATH`、`env.BZR_TEXT_ENCODING`、`disabled: false` である。

## 13. MCP Server 詳細

`src/mcp/server.ts` は stdio JSON-RPC で動作する。

| Method | 処理 |
| --- | --- |
| `initialize` | protocol version、capabilities、serverInfo を返す。 |
| `notifications/initialized` | no-op。 |
| `tools/list` | tool definitions を返す。 |
| `tools/call` | tool name と arguments に応じて処理する。 |

### 13.1 Bazaar tools

| Tool | 処理 |
| --- | --- |
| `bazaar_root` | Bazaar root を返す。 |
| `bazaar_revno` | current revno を返す。 |
| `bazaar_log` | log を返す。 |
| `bazaar_diff_revision` | single revision diff を返す。 |
| `bazaar_diff_range` | revision range diff を返す。 |
| `bazaar_diff_working_tree` | working tree diff を返す。 |
| `bazaar_cat_revision` | revision 時点の file content を返す。 |
| `bazaar_status` | status を返す。 |

### 13.2 Project rules / result tools

| Tool | 処理 |
| --- | --- |
| `project_rules_init` | default rules / schema を作成する。 |
| `project_rules_get_checklist` | checklist JSON を返す。 |
| `project_rules_get_schema` | schema JSON を返す。 |
| `project_rules_validate_review_result` | review-result JSON を検証する。 |
| `project_rules_render_markdown` | review-result JSON を Markdown に変換する。 |
| `project_rules_get_latest_review_result` | 最新保存済み review-result を返す。 |
| `project_rules_get_review_result` | 指定 review id の保存済み result を返す。 |

例外は MCP response として `isError: true` の text content に変換する。

## 14. workflow-register 連携詳細

`registerWorkflowProviders()` は `local.workflow-register` を取得できた場合だけ provider を登録する。

```text
bobBazaar.openReviewGui
bobBazaar.collectReviewContext
bobBazaar.loadReviewRules
bobBazaar.captureReviewResult
```

`workflowRegisterBridge.ts` の責務は次の通りである。

| helper | 処理 |
| --- | --- |
| `getWorkflowRegisterApi()` | workflow-register extension を activate し API を取得する。 |
| `isWorkflowRegisterExtensionAvailable()` | 導入有無を判定する。 |
| `firstStringArg()` | result handoff 互換の `args[0]` を読む。 |
| `initialTargetFromWorkflowInputs()` | workflow inputs / roots から GUI 初期 target を作る。 |
| `captureOptionsFromCommandArgs()` | workflow context から capture options を作る。 |

`captureReviewResult` は workflow-register result handoff から `args[0]` または `latestAssistantText` 相当の assistant 成果物 text を受け取る。`input.workflowRoot` は保存先 Bob workspace として使う。

## 15. Workflow template 詳細

同梱 workflow は次である。

```text
templates/.bob/workflows/bazaar-project-rule-review/WORKFLOW.md
```

主な step は次の通り。

| Step | Type | Provider / 処理 |
| --- | --- | --- |
| `review-input` | command | `bobBazaar.openReviewGui` |
| `collect-context` | command | `bobBazaar.collectReviewContext` |
| `load-rules` | command | `bobBazaar.loadReviewRules` |
| `analyze-changes` | agent | Project rules に沿って分析する。 |
| `output-result` | agent / result sink | review-result JSON を生成し、command sink で capture に渡す。 |

現行 template は `schemaVersion: workflow-register/v1`、`requires`、`preflight`、`tools`、`guardrails.requireApproval`、`artifacts`、`completion`、typed `steps` を持つ。

## 16. Project Rules / Capture 詳細

`.bob/review` の主なファイルは `checklist.json`、`review-result.schema.json`、`review-prompt-template.md`、`examples/review-result.example.json` である。

`resultCaptureCore.ts` は raw JSON object、fenced code block、text 中の balanced JSON object を抽出候補とする。`validateReviewResultJson` は schema validation と project rules 由来の条件を検証する。

保存先:

```text
<Bob workspace>/.bob/review/results/<review_id>.json
<Bob workspace>/.bob/review/results/<review_id>.md
```

file basename は `review_id` を sanitize して作る。`review_id` が無い場合は revision 情報から fallback ID を作る。

`reviewResultValidationCommand.ts` は active editor の selection または full text を検証し、error の場合は Markdown report、有効な場合は任意で Markdown summary を表示する。

## 17. 状態と保存先

| 種類 | 保存先 / 保持場所 |
| --- | --- |
| `.bob` 初期化 assets | `<Bob workspace>/.bob` |
| MCP config | `<Bob workspace>/.bob/mcp.json` |
| checklist | `<Bob workspace>/.bob/review/checklist.json` |
| schema | `<Bob workspace>/.bob/review/review-result.schema.json` |
| workflow template | `<Bob workspace>/.bob/workflows/bazaar-project-rule-review/WORKFLOW.md` |
| review results | `<Bob workspace>/.bob/review/results` |
| review packet | temporary Markdown document / clipboard fallback / explicit save file |
| GUI state | Webview controller memory |
| Bazaar output | memory only |

## 18. Error Handling

| 発生箇所 | 処理 |
| --- | --- |
| BazaarError | CLI failure、unsafe revision、unsafe path、MCP tool error で使う。 |
| GUI error | Webview message handler で例外を捕捉し、`type: "error"` message として UI に返す。 |
| Capture error | `CaptureReviewResultResult.status: "error"` と `issues` で返す。 |
| active editor JSON 検証 error | Markdown validation report を表示する。 |
| MCP error | `isError: true` response に変換する。 |
| workflow step completion failure | warning に留める。 |
| `IBM.bob-code` 不在 | Markdown document 作成で停止する。 |

## 19. セキュリティ詳細

- Bazaar command set は読み取り系に限定する。
- `--no-aliases` を必ず挿入する。
- revision は許可文字 whitelist で検証する。
- file path は repository relative のみ扱う。
- project rules path は workspace root 外を拒否する。
- review result file name は sanitize する。
- diff は `maxDiffBytes`、added file content は `maxAddedFileContentBytes` で制限する。
- MCP tools は破壊的 Bazaar 操作を公開しない。

## 20. Multi-root 動作詳細

期待構成:

```json
{
  "folders": [
    { "path": "./workspace" },
    { "path": "./bazaar_test/branch2" }
  ]
}
```

動作:

1. Bob workflow は `.bob` を持つ `workspace` から読み込まれる。
2. Bazaar GUI は `.bzr` を持つ `bazaar_test/branch2` を Bazaar workspace として解決する。
3. GUI 初期化と review rules は `workspace/.bob` を使う。
4. diff / log は `bazaar_test/branch2/.bzr` 側で取得する。
5. review-result は `workspace/.bob/review/results` に保存する。

## 21. テスト設計

| 対象 | 観点 |
| --- | --- |
| `bazaar.ts` | `--no-aliases` 強制、revision/path validation、allowed exit code。 |
| `textEncoding.ts` | UTF-8 / Shift-JIS / auto decode。 |
| `workspaceResolver.ts` | `.bob` / `.bzr` の分離、single candidate 自動選択。 |
| `bazaarReviewCommands.ts` | direct review command、Bob context 分岐、clipboard / save fallback。 |
| `workflowRegisterBridge.ts` | input / args / state / root の解釈、capture options。 |
| `reviewPacket.ts` | diff truncation、metadata、extra sections。 |
| `revisionInfo.ts` | log parse、changed file parse、added file content section。 |
| `projectRules/io.ts` | required file error、workspace escape rejection。 |
| `validator.ts` | schema validation、evidence / finding 条件。 |
| `resultCaptureCore.ts` | fenced JSON extraction、normalization、save artifacts。 |
| `reviewResultValidationCommand.ts` | active editor selection / full text、report、summary。 |
| `reviewResultsStore.ts` | latest / id 指定の保存済み result 取得。 |
| `workflowBridge.ts` | packet から workflow context 生成。 |
| `workflowStepCompletion.ts` | workflow-register step completion 呼び出しの疎結合。 |
| `mcp/server.ts` | tool list、readonly tool definitions、argument validation、result tools。 |
| 実機 | VS Code / IBM Bob / workflow-register / Bazaar CLI / Webview / MCP の結合動作。 |

詳細な単体テスト仕様は `unit-test-spec-ja.md`、実機テスト仕様は `real-machine-test-spec-ja.md` に定義する。

## 25. 変更時の注意点

- Bazaar command を追加する場合は、読み取り専用かを確認し、`--no-aliases` 強制経路を通す。
- MCP tool を追加する場合は、input schema と README / 設計書 / tests を更新する。
- workflow template を変更する場合は、template refresh 判定と workflow template tests を確認する。
- review-result schema を変更する場合は validator、example、prompt、workflow output contract を同期する。
- workspace resolver を変更する場合は multi-root の `.bob` / `.bzr` 分離動作を確認する。
- result capture を変更する場合は workflow-register result handoff 互換、`args[0]` 入力、`workflowRoot` 保存先を確認する。
