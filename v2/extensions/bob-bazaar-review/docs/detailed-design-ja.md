# bob-bazaar-review 詳細設計書

## 1. 文書の位置づけ

本書は `extensions/bob-bazaar-review` 拡張機能の詳細設計を定義する。基本設計で示した責務を、実装モジュール、主要データ、処理シーケンス、エラー処理、安全制約、MCP tools、テスト観点へ展開する。

## 2. 実装構成

```text
extensions/bob-bazaar-review/
  package.json
  src/
    extension.ts
    bazaar/
      bazaar.ts
      bazaarReviewCommands.ts
      reviewPacket.ts
      reviewTarget.ts
      revisionInfo.ts
      textEncoding.ts
    bob/
      bobCodeExtension.ts
      bobContext.ts
    mcp/
      bazaarTools.ts
      mcpConfig.ts
      projectRulesTools.ts
      server.ts
    projectRules/
      defaults.ts
      io.ts
      markdown.ts
      packet.ts
      resultCapture.ts
      resultCaptureCore.ts
      reviewResultValidationCommand.ts
      reviewResultsStore.ts
      schemaValidator.ts
      types.ts
      validator.ts
    records/
      reviewRecordCommands.ts
      reviewRecordStore.ts
      reviewTriage.ts
    shared/
      extensionMetadata.ts
    ui/
      reviewGui.ts
      reviewGuiHtml.ts
      reviewGuiTypes.ts
    workflow/
      workflowBridge.ts
      workflowProviders.ts
      workflowRegisterBridge.ts
      workflowStepCompletion.ts
    workspace/
      bobWorkspaceInit.ts
      templateRefresh.ts
      workspaceResolver.ts
      workspaceRoots.ts
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

`extension.ts` は command 登録と workflow provider mapping に集中し、workflow action input 解釈は `src/workflow/workflowRegisterBridge.ts`、直接レビュー command は `src/bazaar/bazaarReviewCommands.ts`、review-result active editor 検証は `src/projectRules/reviewResultValidationCommand.ts`、review record command は `src/records/reviewRecordCommands.ts` に分離している。

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
| `bobBazaar.records.initCampaign` | `initializeReviewCampaign` | `.bob-review-records` campaign 雛形を作成する。 |
| `bobBazaar.records.createRecord` | `createReviewRecord` | review packet と review-result を `record.yaml` に紐付ける。 |
| `bobBazaar.records.validateRecord` | `validateReviewRecordCommand` | record の参照 artifact と quality gate を検証する。 |
| `bobBazaar.records.createTriage` | `createReviewTriage` | `triage.yaml` 雛形を生成する。 |
| `bobBazaar.records.validateTriage` | `validateReviewTriage` | triage decision、finding_id、summary を検証する。 |
| `bobBazaar.records.generateSummary` | `generateReviewCampaignSummary` | campaign summary を生成する。 |

## 5. Workspace 解決詳細

`workspaceResolver.ts` は marker ごとの workspace folder 解決を提供する。

```ts
resolveBazaarWorkspaceFolder(options): Promise<vscode.WorkspaceFolder | undefined>
resolveBobWorkspaceFolder(options): Promise<vscode.WorkspaceFolder | undefined>
```

解決順序は、explicit root、workflow root、marker root candidates、active editor 所属 candidate、single candidate、QuickPick、single workspace fallback の順である。explicit root も対象 marker が必要であり、`.bzr` / `.bob` marker 不在の root は採用しない。

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
| `project_rules_init` | default rules / schema を作成する。`BOB_BAZAAR_ENABLE_WRITE_TOOLS=1` のときだけ `tools/list` に出る。 |
| `project_rules_get_checklist` | checklist JSON を返す。 |
| `project_rules_get_schema` | schema JSON を返す。 |
| `project_rules_validate_review_result` | review-result JSON を検証する。 |
| `project_rules_render_markdown` | review-result JSON を Markdown に変換する。 |
| `project_rules_get_latest_review_result` | 最新保存済み review-result を返す。 |
| `project_rules_get_review_result` | 指定 review id の保存済み result を返す。 |

例外は MCP response として `isError: true` の text content に変換する。MCP server は `BOB_BAZAAR_ALLOWED_ROOTS` が空の場合は cwd を既定拒否し、明示的に `BOB_BAZAAR_ALLOW_UNRESTRICTED_CWD=1` が設定された場合だけ無制限 cwd を許す。

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

`schemaValidator.ts` は project default schema に必要な JSON Schema subset を検証する軽量 validator である。対応 keyword は local `$ref`、`enum`、`type`、`minLength`、`minimum`、`properties`、`required`、`additionalProperties`、`items` を中心とする。draft 2020-12 の全 keyword 互換ではないため、project-specific schema を拡張する場合は未対応 keyword を追加実装または別 validator 採用で扱う。

保存先:

```text
<Bob workspace>/.bob/review/results/<review_id>.json
<Bob workspace>/.bob/review/results/<review_id>.md
```

file basename は `review_id` を sanitize して作る。`review_id` が無い場合は revision 情報から fallback ID を作る。

`src/projectRules/reviewResultValidationCommand.ts` は active editor の selection または full text を検証し、error の場合は Markdown report、有効な場合は任意で Markdown summary を表示する。

## 17. Review Records 詳細

`src/records/*` は Phase 1 の review evidence を `.bob-review-records` に保存する。既存の `.bob/review/results/*.json|md|artifact-metadata.json` は source artifact として参照し、record 側では packet、triage、metrics、quality gate、workflow run metadata を管理する。

| Module | 処理 |
| --- | --- |
| `reviewRecordCommands.ts` | VS Code command entry と template copy orchestration。 |
| `reviewRecordCommandCore.ts` | review-result から quality gate を計算する pure helper。 |
| `reviewRecordStore.ts` | record / triage / summary の読み書き、artifact backup、campaign summary。 |
| `reviewRecordPaths.ts` | campaignId / reviewId / artifact path の workspace-safe validation。 |
| `reviewTriage.ts` | triage draft 生成と decision / summary validation。 |

`campaign_id` と `review_id` は path segment として使うため、slash、Windows 予約文字、reserved device name、末尾 dot / space を拒否する。

## 18. 状態と保存先

| 種類 | 保存先 / 保持場所 |
| --- | --- |
| `.bob` 初期化 assets | `<Bob workspace>/.bob` |
| MCP config | `<Bob workspace>/.bob/mcp.json` |
| checklist | `<Bob workspace>/.bob/review/checklist.json` |
| schema | `<Bob workspace>/.bob/review/review-result.schema.json` |
| workflow template | `<Bob workspace>/.bob/workflows/bazaar-project-rule-review/WORKFLOW.md` |
| review results | `<Bob workspace>/.bob/review/results` |
| review records | `<Bob workspace>/.bob-review-records/campaigns/<campaign_id>` |
| review packet | temporary Markdown document / clipboard fallback / explicit save file |
| GUI state | Webview controller memory |
| Bazaar output | memory only |

## 19. Error Handling

| 発生箇所 | 処理 |
| --- | --- |
| BazaarError | CLI failure、unsafe revision、unsafe path、MCP tool error で使う。 |
| GUI error | Webview message handler で例外を捕捉し、`type: "error"` message として UI に返す。 |
| Capture error | `CaptureReviewResultResult.status: "error"` と `issues` で返す。 |
| active editor JSON 検証 error | Markdown validation report を表示する。 |
| MCP error | `isError: true` response に変換する。 |
| workflow step completion failure | warning に留める。 |
| `IBM.bob-code` 不在 | Markdown document 作成で停止する。 |

## 20. セキュリティ詳細

- Bazaar command set は読み取り系に限定する。
- `--no-aliases` を必ず挿入する。
- revision は許可文字 whitelist で検証する。
- file path は repository relative のみ扱う。
- project rules path は workspace root 外を拒否する。
- review result file name は sanitize する。
- review record path segment は Windows 予約文字、device name、末尾 dot / space を拒否する。
- diff は `maxDiffBytes`、added file content は `maxAddedFileContentBytes` で制限する。
- MCP tools は破壊的 Bazaar 操作を公開しない。
- MCP write tools は既定無効にし、allowed roots 未設定 cwd は既定拒否する。

## 21. Multi-root 動作詳細

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

## 22. テスト設計

| 対象 | 観点 |
| --- | --- |
| `src/bazaar/bazaar.ts` | `--no-aliases` 強制、revision/path validation、allowed exit code。 |
| `src/bazaar/textEncoding.ts` | UTF-8 / Shift-JIS / auto decode。 |
| `src/workspace/workspaceResolver.ts` | `.bob` / `.bzr` の分離、single candidate 自動選択、explicit root marker validation。 |
| `src/bazaar/bazaarReviewCommands.ts` | direct review command、Bob context 分岐、clipboard / save fallback。 |
| `src/workflow/workflowRegisterBridge.ts` | input / args / state / root の解釈、capture options。 |
| `src/bazaar/reviewPacket.ts` | diff truncation、metadata、extra sections。 |
| `src/bazaar/revisionInfo.ts` | log parse、changed file parse、added file content section。 |
| `projectRules/io.ts` | required file error、workspace escape rejection。 |
| `projectRules/schemaValidator.ts` | supported JSON Schema subset。 |
| `projectRules/validator.ts` | schema validation、evidence / finding 条件。 |
| `projectRules/resultCaptureCore.ts` | fenced JSON extraction、normalization、save artifacts。 |
| `projectRules/reviewResultValidationCommand.ts` | active editor selection / full text、report、summary。 |
| `projectRules/reviewResultsStore.ts` | latest / id 指定の保存済み result 取得。 |
| `records/*` | record path safety、quality gate、triage、campaign summary。 |
| `workflow/workflowBridge.ts` | packet から workflow context 生成。 |
| `workflow/workflowStepCompletion.ts` | workflow-register step completion 呼び出しの疎結合。 |
| `mcp/server.ts` | tool list、readonly tool definitions、argument validation、result tools。 |
| 実機 | VS Code / IBM Bob / workflow-register / Bazaar CLI / Webview / MCP の結合動作。 |

詳細な単体テスト仕様は `unit-test-spec-ja.md`、実機テスト仕様は `real-machine-test-spec-ja.md` に定義する。

## 23. 変更時の注意点

- Bazaar command を追加する場合は、読み取り専用かを確認し、`--no-aliases` 強制経路を通す。
- MCP tool を追加する場合は、input schema と README / 設計書 / tests を更新する。
- workflow template を変更する場合は、template refresh 判定と workflow template tests を確認する。
- review-result schema を変更する場合は validator、example、prompt、workflow output contract を同期する。
- workspace resolver を変更する場合は multi-root の `.bob` / `.bzr` 分離動作を確認する。
- result capture を変更する場合は workflow-register result handoff 互換、`args[0]` 入力、`workflowRoot` 保存先を確認する。
- dependency を追加・削除する場合は `unused:policy` と `package:metrics` の結果を確認し、VSIX size 差分を release / PR summary に残す。

<!-- REMEDIATION-2026-07-11 -->
## 2026-07-11 横断修正契約

3拡張の横断レビューに基づき、次をリリース契約とする。

- IBM Bob と companion extension は、機能上必須でない場合は soft dependency とし、未導入でも通常 command を起動できること。
- workflow action provider は所有元 source ID を持ち、同一 ID の無警告上書きを禁止する。登録解除用 disposable を返し、extension 停止時に解除する。
- Git / Bazaar 外部プロセスは shell を使わず、hard timeout、出力上限、AbortSignal、子プロセス終了を必須とする。
- Bazaar repository path は POSIX / Windows の絶対 path、drive-relative path、UNC、device path、dot / traversal / control-character segment を拒否する。
- review processing limit は manifest と runtime で同じ最小・既定・最大値を持つ。UTF-8 切り詰め後の suffix を含めても byte 上限を超えないこと。
- repository 内の全 WORKFLOW.md を strict validation し、provider、preflight、nested command ID、template mirror の契約ずれを CI で拒否する。
- Ubuntu と Windows の両方で compile、unit test、VSIX package、package policy を確認する。IBM Bob 実環境の UI / task / MCP は release candidate 実機ゲートで確認する。
