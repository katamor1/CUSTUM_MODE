# bob-bazaar-review 基本設計書

## 1. 目的

`bob-bazaar-review` は、Bazaar リポジトリの変更レビューを IBM Bob / VS Code 上で実施しやすくするための拡張機能である。

主な目的は次のとおりである。

- Bazaar の revision / revision range / working tree 差分を安全に取得する。
- Bob に渡すレビュー用 Markdown packet を生成する。
- `.bob` 配下にプロジェクト固有レビュー規約、Skill、Workflow、MCP 設定を初期化する。
- `workflow-register` の action provider として、GUI、context 収集、rules 読み込み、review-result 保存を提供する。
- Bob が生成した review-result JSON を検証し、JSON と Markdown の成果物として保存する。
- 読み取り専用 MCP server として Bazaar / project rules / 保存済み review-result 操作を Bob へ公開する。
- Phase 1 の review packet、review-result、human triage、campaign summary を `.bob-review-records` に分離保存する。

## 2. 背景と課題

Bazaar を用いる既存プロジェクトでは、差分レビュー時に次の課題がある。

- `bzr diff` や `bzr log` の出力を Bob へ渡す作業が手動になりやすい。
- Bazaar alias により `diff` や `log` が GUI ツールへ置き換わると、stdout が取得できない。
- 日本語や Shift-JIS / CP932 系の Bazaar 出力が文字化けする可能性がある。
- `.bob` workspace と Bazaar repository が multi-root workspace で別フォルダになる場合がある。
- プロジェクト固有規約に沿ったレビュー結果を JSON と Markdown で保存したい。
- Bob workflow が途中で中断した場合、生成済み JSON を再利用して保存・Markdown 生成だけ再開したい。
- 過去に保存した review-result を Bob / MCP tool から参照したい。

## 3. スコープ

### 3.1 対象範囲

- Bazaar CLI の読み取り系操作。
- `bzr --no-aliases` の強制。
- Bazaar 出力の UTF-8 / Shift-JIS 系 decode。
- Bazaar review packet の生成。
- `IBM.bob-code` 導入時の Bob context への packet 追加。
- `IBM.bob-code` 未導入時の Markdown document 作成。
- `.bob` 初期化、MCP 設定、project review rules 初期化。
- project review checklist / schema / prompt template / packet section の読み込み。
- review-result JSON の抽出、検証、正規化、保存、Markdown 生成。
- 保存済み review-result の取得。
- active editor の review-result JSON 検証と Markdown summary 表示。
- `workflow-register` action provider 登録。
- Bazaar / project rules / review-result MCP tools の提供。
- Phase 1 review record / triage / campaign summary の作成と検証。
- multi-root workspace での `.bob` root と `.bzr` root の分離解決。

### 3.2 対象外

- Bazaar の書き込み操作。
- commit / push / pull / update / revert / merge / resolve などの破壊的操作。
- IBM Bob 本体の UI 改修。
- OS コマンドの自由実行。
- review-result JSON の内容を AI なしで自動判定すること。
- 複数ユーザー間での review result 同期。

## 4. 利用者と利用シーン

| 利用者 | 主な用途 |
| --- | --- |
| 開発者 | Bazaar revision を指定し、Bob へレビュー packet を渡す。 |
| レビュー担当者 | GUI で変更ファイルと revision 情報を確認し、プロジェクト規約レビューを開始する。 |
| ワークフロー設計者 | `bazaar-project-rule-review` workflow を利用・調整する。 |
| 拡張機能連携者 | MCP tools や workflow action provider を通じて Bazaar 情報を取得する。 |
| 保守担当者 | `.bob` template、MCP 設定、保存済み review-result の状態を確認する。 |

## 5. 全体構成

```text
VS Code Extension Host
      └─ bob-bazaar-review
       ├─ extension.ts
       ├─ bazaar/
       ├─ bob/
       ├─ mcp/
       ├─ projectRules/
       ├─ records/
       ├─ ui/
       ├─ workflow/
       └─ workspace/

Bob / workflow-register
  ├─ bobBazaar.openReviewGui
  ├─ bobBazaar.collectReviewContext
  ├─ bobBazaar.loadReviewRules
  └─ bobBazaar.captureReviewResult
```

## 6. 主要コンポーネント

| コンポーネント | 主な責務 | 主なファイル |
| --- | --- | --- |
| Extension Entry | VS Code command 登録、workflow-register action provider 登録 | `src/extension.ts` |
| Workflow Register Bridge | `local.workflow-register` API 取得、workflow action input 解釈、capture option 生成 | `src/workflow/workflowRegisterBridge.ts`, `src/workflow/workflowProviders.ts` |
| Bob Code Extension Helper | `IBM.bob-code` 導入有無の判定 | `src/bob/bobCodeExtension.ts` |
| Bazaar Review Commands | revision / range の直接レビュー command、Bob context 追加、保存 fallback | `src/bazaar/bazaarReviewCommands.ts` |
| Review Result Validation Command | active editor の review-result JSON 検証、Markdown summary 表示 | `src/projectRules/reviewResultValidationCommand.ts` |
| Bazaar Client | Bazaar CLI 実行、引数検証、decode、alias 無効化 | `src/bazaar/bazaar.ts`, `src/bazaar/textEncoding.ts` |
| Review GUI | Webview UI、target 選択、packet 生成、Bob context 追加 | `src/ui/reviewGui.ts`, `src/ui/reviewGuiHtml.ts` |
| Workspace Resolver | `.bob` root と `.bzr` root の分離解決 | `src/workspace/workspaceResolver.ts`, `src/workspace/workspaceRoots.ts` |
| Bob Workspace Init | `.bob` 初期化、template refresh、MCP 設定 | `src/workspace/bobWorkspaceInit.ts`, `src/workspace/templateRefresh.ts` |
| MCP Config | `.bob/mcp.json` 生成・更新 | `src/mcp/mcpConfig.ts` |
| MCP Server | 読み取り専用 Bazaar tools、project rules tools、保存済み result tools | `src/mcp/server.ts` |
| Review Packet | Bob へ渡す Markdown packet の生成 | `src/bazaar/reviewPacket.ts`, `src/bazaar/revisionInfo.ts`, `src/bazaar/reviewTarget.ts` |
| Workflow Bridge | review packet から workflow state 用 context を生成 | `src/workflow/workflowBridge.ts` |
| Workflow Step Completion | GUI 後に workflow-register の current step 完了を試行 | `src/workflow/workflowStepCompletion.ts` |
| Project Rules | checklist / schema / prompt / packet section の読み込み | `src/projectRules/*` |
| Result Capture | review-result JSON 抽出、検証、保存、Markdown 生成 | `src/projectRules/resultCapture*.ts` |
| Review Results Store | 保存済み review-result の読み出し | `src/projectRules/reviewResultsStore.ts` |
| Review Records | review packet、review-result、triage、campaign summary の実績管理 | `src/records/*` |
| Workflow Template | Bob workflow 定義 | `templates/.bob/workflows/bazaar-project-rule-review/WORKFLOW.md` |
| Skill Template | Bob に渡すレビュー観点 Skill | `templates/.bob/skills/project-review-checklist/SKILL.md` |

## 7. 依存関係

| 依存 | 用途 |
| --- | --- |
| `IBM.bob-code` | 任意連携。導入時のみ Bob context 追加、workflow UI、MCP 利用に使う。 |
| `local.workflow-register` | 任意連携。導入時のみ action provider 登録、Bob workflow step 実行に使う。 |
| Bazaar CLI | `bzr root` / `diff` / `log` / `cat` / `status` など。 |
| Node.js | VS Code extension と MCP server の実行。 |

## 8. Workspace モデル

本拡張は次の2種類の root を分離する。

| Root | Marker | 用途 |
| --- | --- | --- |
| Bob workspace root | `.bob` | Skill、Workflow、MCP 設定、review rules、review results の保存先。 |
| Bazaar repository root | `.bzr` | Bazaar diff / log / status / cat の実行対象。 |

multi-root workspace では、差分取得は `.bzr` 側で行い、review result は `.bob/review/results` に保存する。

## 9. Bazaar 実行方針

本拡張が実行する Bazaar CLI は、必ず global option `--no-aliases` を付与する。

```text
bzr --no-aliases diff -c REV
bzr --no-aliases log -r REV
bzr --no-aliases status
```

安全方針は次の通りである。

- `execFile` を使用し、コマンド文字列連結はしない。
- Bazaar arguments は array として渡す。
- revision は `validateRevision` で検証する。
- repository relative path は `validateRelativePath` で検証する。
- `BZR_PROGRESS_BAR=none` を設定する。
- diff 系 command は Bazaar の差分あり exit code `1` を許可する。

## 10. レビュー GUI / 直接コマンド

`bobBazaar.openReviewGui` は Webview を開き、workspace 解決、`.bob` 初期化確認、review target 入力、Bazaar log / diff / status 取得、changed files 表示、review packet 生成、Bob context 追加、workflow step 完了を行う。

直接コマンドとして次を提供する。

| Command | 処理 |
| --- | --- |
| `bobBazaar.reviewRevision` | 単一 revision packet を作る。 |
| `bobBazaar.reviewRange` | revision range packet を作る。 |
| `bobBazaar.reviewRevisionWithProjectRules` | 単一 revision packet に project rules section を追加する。 |
| `bobBazaar.reviewRangeWithProjectRules` | range packet に project rules section を追加する。 |

`IBM.bob-code` が無い場合は Markdown document を作って停止する。`workflow-register` が無く `IBM.bob-code` がある場合は Bob context へ追加する。`workflow-register` がある場合は、Bob context 追加、clipboard copy、file save をユーザーに選択させる。

## 11. `.bob` 初期化設計

`.bob` 初期化では次の template を配布する。

```text
.bob/mcp.json
.bob/custom_modes.yaml
.bob/review/checklist.json
.bob/review/review-result.schema.json
.bob/review/review-prompt-template.md
.bob/review/examples/review-result.example.json
.bob/skills/project-review-checklist/SKILL.md
.bob/workflows/bazaar-project-rule-review/WORKFLOW.md
```

初期化は基本的に missing only でコピーする。ただし workflow template は現行 schema、requires、preflight、guardrails、artifacts、completion を反映するため refresh 対象として上書きする。

## 12. workflow-register 連携

`workflow-register` が導入されている場合だけ次の action provider を登録する。未導入でも通常コマンドは利用できる。

| Provider | 用途 |
| --- | --- |
| `bobBazaar.openReviewGui` | GUI を開き、対象 revision / range / working tree を確定する。 |
| `bobBazaar.collectReviewContext` | 開いている review packet から workflow state 用 context を作る。 |
| `bobBazaar.loadReviewRules` | checklist と review-result schema を読み込む。 |
| `bobBazaar.captureReviewResult` | assistant 出力や clipboard から review-result JSON を検証・保存する。 |

`workflowRegisterBridge.ts` は workflow inputs、args、state、`workflowRoot`、`bazaarRoot`、`repositoryRoot` を解釈し、GUI 初期 target と capture option を生成する。

## 13. MCP Server 概要

MCP server は stdio JSON-RPC で動作し、Bob から tools として呼び出される。

| 系統 | tools |
| --- | --- |
| Bazaar 読み取り tools | `bazaar_root`, `bazaar_revno`, `bazaar_log`, `bazaar_diff_revision`, `bazaar_diff_range`, `bazaar_diff_working_tree`, `bazaar_cat_revision`, `bazaar_status` |
| Project rules tools | `project_rules_get_checklist`, `project_rules_get_schema`, `project_rules_validate_review_result`, `project_rules_render_markdown` |
| Project rules write tool | `project_rules_init` は `BOB_BAZAAR_ENABLE_WRITE_TOOLS=1` のときだけ公開する |
| Review results tools | `project_rules_get_latest_review_result`, `project_rules_get_review_result` |

Bazaar tools は読み取り専用に限定し、破壊的操作は提供しない。MCP server は `BOB_BAZAAR_ALLOWED_ROOTS` の内側だけを受け付ける。allowed roots 未設定時は既定拒否し、手動検証で無制限 cwd を許す場合だけ `BOB_BAZAAR_ALLOW_UNRESTRICTED_CWD=1` を使う。

## 14. Review result 保存 / 検証

Bob が出力した review-result JSON は、command argument、active editor selection、active editor full text、clipboard、workflow-register result handoff から抽出できる。

保存処理は次を行う。

1. raw JSON または fenced JSON block から JSON object を抽出する。
2. `severity` と `summary` を必要に応じて正規化する。
3. JSON schema と project rules 条件で検証する。
4. `.bob/review/results/<review_id>.json` を保存する。
5. `.bob/review/results/<review_id>.md` を保存する。

`bobBazaar.validateReviewResultJson` は active editor の JSON を検証し、有効な場合は Markdown summary を表示できる。

## 15. Phase 1 review record / triage

Phase 1 の実績管理では、`.bob/review/results` の review-result を変更せず、packet、record、triage、campaign summary を `.bob-review-records/campaigns/<campaign_id>` に保存する。

| Command | 処理 |
| --- | --- |
| `bobBazaar.records.initCampaign` | campaign / target / record / triage template をコピーする。 |
| `bobBazaar.records.createRecord` | review packet と保存済み review-result を `record.yaml` で紐付ける。 |
| `bobBazaar.records.validateRecord` | record の必須 field、参照 artifact、quality gate を検証する。 |
| `bobBazaar.records.createTriage` | Bob finding と失敗 checklist から `triage.yaml` 雛形を生成する。 |
| `bobBazaar.records.validateTriage` | decision enum、finding_id、summary 件数を検証する。 |
| `bobBazaar.records.generateSummary` | record / triage から `summary.json` と `summary.md` を生成する。 |

## 16. セキュリティとエラー処理方針

- Bazaar 操作は読み取り系に限定する。
- `--no-aliases` を必ず付与する。
- revision / path を検証する。
- diff と added file content には byte 上限を設ける。
- MCP tools では commit / push / pull / revert などを公開しない。
- MCP write tool は既定無効にする。
- allowed roots 未設定の MCP cwd は既定拒否する。
- review-result 保存ファイル名は sanitize する。
- review record の campaignId / reviewId は Windows reserved name と予約文字を拒否する。
- project rules の外部 path は明示許可がない限り拒否する。
- Bazaar command failure は `BazaarError` として cwd / args / stdout / stderr / code を保持する。
- `IBM.bob-code` 未導入時は packet Markdown 作成で停止する。
- Bob context 追加失敗時は clipboard fallback を行う。
- current workflow step 完了失敗は warning に留める。

## 17. テスト方針

- BazaarClient の引数検証、`--no-aliases` 強制、allowed exit code を検証する。
- workspace resolver の `.bob` / `.bzr` 分離を検証する。
- review packet 生成と追加ファイル本文上限を検証する。
- direct review command の Bob context / clipboard / save 分岐を検証する。
- workflow-register bridge の input / args / state 解釈を検証する。
- review-result JSON 抽出、正規化、schema validation、Markdown 生成を検証する。
- review result validation command の active editor 検証を検証する。
- review results store と MCP result 取得 tools を検証する。
- record / triage / campaign summary と quality gate を検証する。
- workflow template の UI 表示値、resultKey、artifact、guardrail、requires、preflight を検証する。
- MCP server の tool 定義と readonly 境界を検証する。
- MCP write tool の disabled-by-default と allowed roots を検証する。
- 実機では VS Code / IBM Bob / workflow-register / Bob Workflow UI / Bazaar CLI / Webview / MCP を含む結合動作を確認する。

詳細な単体テスト仕様は `unit-test-spec-ja.md`、実機テスト仕様は `real-machine-test-spec-ja.md` に定義する。

## 18. 今後の拡張方針

- Bob UI 経由の中断再開をさらに強化する。
- review packet の永続保存と再利用 UI を追加する。
- MCP tools に保存済み review-result の検索・比較支援を追加する。
- project rules の version migration を支援する。
- large diff の分割レビューを workflow と連動させる。

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
