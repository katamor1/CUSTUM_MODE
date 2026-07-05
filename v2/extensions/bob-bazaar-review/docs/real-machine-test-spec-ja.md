# bob-bazaar-review 実機テスト仕様書

## 1. 目的

本書は `extensions/bob-bazaar-review` の実機テスト仕様を定義する。単体テストでは mock 化する VS Code Extension Host、IBM Bob、workflow-register、Bob Workflow UI、Webview、Bazaar CLI、MCP server、multi-root workspace、実ファイル I/O を含めて確認する。

## 2. テスト対象

| 区分 | 対象 |
| --- | --- |
| VS Code 拡張 | `bob-bazaar-review` |
| 依存拡張 | `IBM.bob-code`, `local.workflow-register` |
| Bazaar | `bzr root`, `bzr log`, `bzr diff`, `bzr cat`, `bzr status`, `bzr revno` |
| Bob workspace | `.bob/mcp.json`, `.bob/review/*`, `.bob/skills/*`, `.bob/workflows/bazaar-project-rule-review/WORKFLOW.md` |
| 成果物 | `.bob/review/results/<review_id>.json`, `.bob/review/results/<review_id>.md`, `.bob-review-records/campaigns/<campaign_id>/...` |
| UI | Command Palette、Bazaar Review GUI Webview、Bob Workflow UI、active editor validation report |
| MCP | stdio JSON-RPC server、Bazaar readonly tools、project rules tools、review result tools |

## 3. 前提環境

| 項目 | 条件 |
| --- | --- |
| OS | Windows 11 を主対象。可能であれば macOS / Linux でも代表ケースを確認する。 |
| VS Code / Bob IDE | `package.json` の `engines.vscode` を満たすバージョン。 |
| IBM Bob 拡張 | `IBM.bob-code` が導入済みで、有効化できること。 |
| workflow-register | `local.workflow-register` が導入済みで、有効化できること。 |
| Bazaar CLI | `bzr` が PATH にある、または `bobBazaar.bzrPath` で指定できること。 |
| Node.js / npm | extension build / MCP server 起動が可能なバージョン。 |
| テスト workspace | `.bob` を持つ Bob workspace と `.bzr` を持つ Bazaar repository。 |

## 4. 事前準備

### 4.1 拡張機能ビルド

```powershell
cd extensions\bob-bazaar-review
npm install
npm run compile
```

必要に応じて VSIX を作成する。

```powershell
npm run package
```

### 4.2 推奨 workspace 構成

single-root の場合:

```text
<workspace>/
  .bob/
  .bzr/
  src/
    sample.c
```

multi-root の場合:

```json
{
  "folders": [
    { "path": "./workspace" },
    { "path": "./bazaar_test/branch2" }
  ]
}
```

```text
workspace/
  .bob/

bazaar_test/branch2/
  .bzr/
  src/
    sample.c
```

### 4.3 review-result JSON 例

```json
{
  "review_id": "bazaar-review-smoke",
  "target": {
    "repository": "sample",
    "revision": "1"
  },
  "summary": "重大な問題はありません。",
  "findings": [],
  "questions": [],
  "overall_severity": "info"
}
```

実際の schema に合わせて必須 field はプロジェクトの `.bob/review/review-result.schema.json` を参照する。

## 5. 共通確認項目

各テストでは可能な範囲で次を確認する。

- VS Code Developer Tools Console に未処理例外が出ていない。
- `bzr` 実行に alias が影響せず、`--no-aliases` 経路で動作する。
- `.bob` と `.bzr` が別 root の場合も、保存先と差分取得先が分離される。
- `IBM.bob-code` 未導入時または無効時は Markdown document 作成で安全に停止する。
- `workflow-register` 未導入時でも通常 command が利用できる。
- `.bob/review/results` への JSON / Markdown 保存が UTF-8 で行われる。
- MCP tools は読み取り専用で、破壊的 Bazaar 操作を提供しない。

## 6. 実機テスト項目

### BZR-RT-001 拡張起動と command 登録

| 項目 | 内容 |
| --- | --- |
| 目的 | 拡張が起動し、Command Palette に主要 command が表示されることを確認する。 |
| 手順 | 1. テスト workspace を開く。<br>2. `Developer: Show Running Extensions` で拡張状態を確認する。<br>3. Command Palette で `Bob Bazaar Review:` を検索する。 |
| 期待結果 | GUI、context 収集、rules 読み込み、capture、MCP 設定、init、revision / range review、JSON 検証、Phase 1 record / triage / summary command が表示される。 |

### BZR-RT-002 workflow-register provider 登録

| 項目 | 内容 |
| --- | --- |
| 目的 | workflow-register に action provider が登録されることを確認する。 |
| 手順 | 1. workflow-register と本拡張を有効化する。<br>2. `.bob/workflows/bazaar-project-rule-review/WORKFLOW.md` を配置または初期化する。<br>3. workflow-register reload / inspect を実行する。 |
| 期待結果 | `bobBazaar.openReviewGui`、`collectReviewContext`、`loadReviewRules`、`captureReviewResult` が provider missing にならない。 |

### BZR-RT-003 `.bob` project rules 初期化

| 項目 | 内容 |
| --- | --- |
| 目的 | `.bob/review` 規約ファイルを初期化できることを確認する。 |
| 手順 | 1. `.bob/review` が無い workspace を開く。<br>2. `Bob Bazaar Review: プロジェクト規約を初期化` を実行する。 |
| 期待結果 | `.bob/review/checklist.json`、`review-result.schema.json`、`review-prompt-template.md`、example が作成される。checklist が editor で開く。 |

### BZR-RT-004 `.bob` workspace / workflow template 初期化

| 項目 | 内容 |
| --- | --- |
| 目的 | GUI または初期化処理で workflow / Skill / MCP template が配置されることを確認する。 |
| 手順 | 1. Bazaar Review GUI を開く。<br>2. `.bob` 未初期化状態を確認する。<br>3. GUI から初期化する。 |
| 期待結果 | `.bob/custom_modes.yaml`、`.bob/skills/project-review-checklist/SKILL.md`、`.bob/workflows/bazaar-project-rule-review/WORKFLOW.md` などが作成または refresh される。 |

### BZR-RT-005 MCP 設定

| 項目 | 内容 |
| --- | --- |
| 目的 | `.bob/mcp.json` に Bazaar MCP server を設定できることを確認する。 |
| 手順 | 1. `Bob Bazaar Review: Bob MCP を設定` を実行する。<br>2. Bob workspace を選択する。<br>3. `.bob/mcp.json` を確認する。 |
| 期待結果 | configured server name、command、args、env.BZR_PATH、disabled false が設定される。 |

### BZR-RT-006 Bazaar Review GUI 起動

| 項目 | 内容 |
| --- | --- |
| 目的 | Webview GUI が開き、workspace state と `.bob` status が表示されることを確認する。 |
| 手順 | 1. `Bob Bazaar Review: GUI を開く` を実行する。<br>2. Webview の初期表示を確認する。 |
| 期待結果 | Bazaar workspace、Bob workspace、初期化状態、target 入力欄が表示される。 |

### BZR-RT-007 GUI singleRevision target 読み込み

| 項目 | 内容 |
| --- | --- |
| 目的 | GUI で単一 revision の metadata と diff を取得できることを確認する。 |
| 手順 | 1. GUI で `singleRevision` を選ぶ。<br>2. revision を入力する。<br>3. target を読み込む。 |
| 期待結果 | log、diff、changed files、target label が表示される。 |

### BZR-RT-008 GUI revisionRange target 読み込み

| 項目 | 内容 |
| --- | --- |
| 目的 | GUI で revision range の diff を取得できることを確認する。 |
| 手順 | 1. GUI で `revisionRange` を選ぶ。<br>2. baseRevision / targetRevision を入力する。<br>3. target を読み込む。 |
| 期待結果 | range diff と changed files が表示される。 |

### BZR-RT-009 GUI workingTreeSinceRevision target 読み込み

| 項目 | 内容 |
| --- | --- |
| 目的 | GUI で working tree diff と status を取得できることを確認する。 |
| 手順 | 1. Bazaar working tree に未コミット変更を作る。<br>2. GUI で `workingTreeSinceRevision` を選ぶ。<br>3. baseRevision を任意で入力し、target を読み込む。 |
| 期待結果 | working tree diff、revno、status が表示される。 |

### BZR-RT-010 GUI review packet 生成と Bob context 追加

| 項目 | 内容 |
| --- | --- |
| 目的 | GUI から review packet を生成し、IBM Bob context へ追加できることを確認する。 |
| 手順 | 1. GUI で target を読み込む。<br>2. review 実行ボタンを押す。<br>3. Bob context / chat を確認する。 |
| 期待結果 | `# Bazaar Revision Review Request` packet が Bob context に追加される。失敗時は clipboard fallback される。 |

### BZR-RT-011 IBM Bob 未導入 / 無効時の GUI fallback

| 項目 | 内容 |
| --- | --- |
| 目的 | IBM Bob が無い場合でも Markdown document 作成で安全に停止することを確認する。 |
| 手順 | 1. IBM Bob 拡張を無効化した環境で GUI review を実行する。 |
| 期待結果 | Bob context 追加を試みず、Markdown document が作成される。 |

### BZR-RT-012 workflow 実行中 GUI step completion

| 項目 | 内容 |
| --- | --- |
| 目的 | workflow action として GUI を開いた後、current step 完了が best effort で実行されることを確認する。 |
| 手順 | 1. Bob Workflow UI から `bazaar-project-rule-review` を開始する。<br>2. `review-input` step で GUI を開く。<br>3. packet を生成する。 |
| 期待結果 | packet 生成後、workflow-register の current step 完了が試行される。失敗しても packet 生成自体は成功扱いになる。 |

### BZR-RT-013 direct reviewRevision command

| 項目 | 内容 |
| --- | --- |
| 目的 | Command Palette から単一 revision packet を生成できることを確認する。 |
| 手順 | 1. `Bob Bazaar Review: 1リビジョンを Bob でレビュー` を実行する。<br>2. Bazaar workspace と revision を入力する。 |
| 期待結果 | review packet Markdown が開き、環境に応じて Bob context 追加または選択ダイアログが表示される。 |

### BZR-RT-014 direct reviewRange command

| 項目 | 内容 |
| --- | --- |
| 目的 | Command Palette から revision range packet を生成できることを確認する。 |
| 手順 | 1. `Bob Bazaar Review: リビジョン範囲を Bob でレビュー` を実行する。<br>2. baseRevision / targetRevision を入力する。 |
| 期待結果 | range packet Markdown が開く。 |

### BZR-RT-015 project rules 付き direct reviewRevision

| 項目 | 内容 |
| --- | --- |
| 目的 | project rules section 付きの単一 revision packet を生成できることを確認する。 |
| 手順 | 1. `.bob/review` を初期化する。<br>2. `Bob Bazaar Review: 1リビジョンをプロジェクト規約付きでレビュー` を実行する。 |
| 期待結果 | packet に checklist と review-result output contract が含まれる。 |

### BZR-RT-016 project rules 付き direct reviewRange

| 項目 | 内容 |
| --- | --- |
| 目的 | project rules section 付きの range packet を生成できることを確認する。 |
| 手順 | 1. `.bob/review` を初期化する。<br>2. `Bob Bazaar Review: リビジョン範囲をプロジェクト規約付きでレビュー` を実行する。 |
| 期待結果 | range packet に project rules section が含まれる。 |

### BZR-RT-017 workflow collectReviewContext

| 項目 | 内容 |
| --- | --- |
| 目的 | 開いている review packet から workflow state 用 context を収集できることを確認する。 |
| 手順 | 1. review packet Markdown を開く。<br>2. `Bob Bazaar Review: レビューコンテキストを収集` を実行する。 |
| 期待結果 | packet の repository、mode、revision、diff summary などが result として返る。workflow 経由の場合は state に保存される。 |

### BZR-RT-018 workflow loadReviewRules

| 項目 | 内容 |
| --- | --- |
| 目的 | checklist / schema を読み込み、workflow action result に反映できることを確認する。 |
| 手順 | 1. `.bob/review` を初期化する。<br>2. `Bob Bazaar Review: プロジェクト規約を読み込む` を実行する。 |
| 期待結果 | checklistItems、categories、schemaTopLevelKeys、summary が返る。 |

### BZR-RT-019 review-result capture: clipboard

| 項目 | 内容 |
| --- | --- |
| 目的 | clipboard の review-result JSON を検証・保存できることを確認する。 |
| 手順 | 1. valid review-result JSON を clipboard にコピーする。<br>2. `Bob Bazaar Review: クリップボードからレビュー結果を保存` を実行する。 |
| 期待結果 | `.bob/review/results/<review_id>.json` と `.md` が保存される。 |

### BZR-RT-020 review-result capture: active editor

| 項目 | 内容 |
| --- | --- |
| 目的 | active editor の selection / full text から review-result JSON を保存できることを確認する。 |
| 手順 | 1. review-result JSON を editor で開く。<br>2. 必要に応じて範囲選択する。<br>3. `Bob Bazaar Review: レビュー結果を取り込む` を実行する。 |
| 期待結果 | JSON と Markdown が `.bob/review/results` に保存される。 |

### BZR-RT-021 review-result capture: workflow handoff

| 項目 | 内容 |
| --- | --- |
| 目的 | workflow-register result handoff から assistant output を保存できることを確認する。 |
| 手順 | 1. Bob Workflow UI で `output-result` step まで実行する。<br>2. `bobBazaar.captureReviewResult` sink が呼ばれることを確認する。 |
| 期待結果 | assistant が生成した JSON が `.bob/review/results` に保存される。 |

### BZR-RT-022 invalid review-result capture

| 項目 | 内容 |
| --- | --- |
| 目的 | schema 不一致の review-result が保存されず error になることを確認する。 |
| 手順 | 1. required field を欠いた JSON を入力する。<br>2. capture command を実行する。 |
| 期待結果 | validation issue が表示され、results directory に不正成果物が保存されない。 |

### BZR-RT-023 active editor JSON validation OK

| 項目 | 内容 |
| --- | --- |
| 目的 | active editor の valid review-result JSON を検証できることを確認する。 |
| 手順 | 1. valid JSON を editor で開く。<br>2. `Bob Bazaar Review: レビュー結果 JSON を検証` を実行する。<br>3. `Markdown サマリを表示` を選ぶ。 |
| 期待結果 | 有効メッセージが表示され、Markdown summary が開く。 |

### BZR-RT-024 active editor JSON validation error

| 項目 | 内容 |
| --- | --- |
| 目的 | invalid JSON の validation report が表示されることを確認する。 |
| 手順 | 1. invalid JSON を editor で開く。<br>2. `Bob Bazaar Review: レビュー結果 JSON を検証` を実行する。 |
| 期待結果 | Markdown validation report が開き、issue path と message が表示される。 |

### BZR-RT-025 MCP initialize / tools/list

| 項目 | 内容 |
| --- | --- |
| 目的 | MCP server が initialize と tools/list に応答することを確認する。 |
| 手順 | 1. `.bob/mcp.json` の command / args で MCP server を起動する。<br>2. stdio JSON-RPC で `initialize` と `tools/list` を送る。 |
| 期待結果 | serverInfo、capabilities、Bazaar readonly tools、project rules tools、review result tools が返る。 |

### BZR-RT-026 MCP Bazaar tools

| 項目 | 内容 |
| --- | --- |
| 目的 | Bazaar readonly tools が実 repository に対して動作することを確認する。 |
| 手順 | 1. MCP `tools/call` で `bazaar_root`、`bazaar_log`、`bazaar_diff_revision`、`bazaar_status` を呼ぶ。 |
| 期待結果 | 結果 text が返る。commit / push / pull / revert などの tool は存在しない。 |

### BZR-RT-027 MCP project rules tools

| 項目 | 内容 |
| --- | --- |
| 目的 | project rules tools の読み取りと write tool の既定無効を確認する。 |
| 手順 | 1. env 未指定で `tools/list` を呼ぶ。<br>2. `project_rules_init` を直接 call する。<br>3. `project_rules_get_checklist`、`project_rules_get_schema` を呼ぶ。<br>4. 必要な場合だけ `BOB_BAZAAR_ENABLE_WRITE_TOOLS=1` と `BOB_BAZAAR_ALLOWED_ROOTS` を指定して `project_rules_init` を呼ぶ。 |
| 期待結果 | env 未指定では `project_rules_init` は `tools/list` に出ず、直接 call は `isError: true` になる。読み取り tools は allowed root 内で結果を返す。write tools 有効化時だけ default rules / schema が作成される。 |

### BZR-RT-027A MCP allowed roots

| 項目 | 内容 |
| --- | --- |
| 目的 | MCP server が allowed roots 未設定 cwd と allowed root 外 cwd を拒否することを確認する。 |
| 手順 | 1. `BOB_BAZAAR_ALLOWED_ROOTS` 未設定で Bazaar tool を call する。<br>2. allowed root 外の `cwd` を指定する。<br>3. allowed root 内の `cwd` を指定する。 |
| 期待結果 | 未設定または root 外は `isError: true` になり、allowed root 内だけ処理される。手動検証で無制限 cwd を使う場合は `BOB_BAZAAR_ALLOW_UNRESTRICTED_CWD=1` を明示する。 |

### BZR-RT-028 MCP review result tools

| 項目 | 内容 |
| --- | --- |
| 目的 | 保存済み review-result を MCP から取得できることを確認する。 |
| 手順 | 1. review-result を保存する。<br>2. `project_rules_get_latest_review_result` と `project_rules_get_review_result` を呼ぶ。 |
| 期待結果 | 最新または指定 ID の review-result が返る。 |

### BZR-RT-029 multi-root `.bob` / `.bzr` 分離

| 項目 | 内容 |
| --- | --- |
| 目的 | `.bob` workspace と Bazaar repository が別 root の場合に正しく分離されることを確認する。 |
| 手順 | 1. multi-root workspace を開く。<br>2. GUI で Bazaar workspace と Bob workspace を確認する。<br>3. packet 生成と capture を行う。 |
| 期待結果 | diff / log は `.bzr` root、rules / result 保存は `.bob` root を使う。 |

### BZR-RT-030 Shift-JIS / CP932 decode

| 項目 | 内容 |
| --- | --- |
| 目的 | Bazaar 出力や追加ファイル本文の Shift-JIS / CP932 decode を確認する。 |
| 手順 | 1. 日本語を含む Bazaar log / diff / file を用意する。<br>2. `bobBazaar.textEncoding` を `auto` / `cp932` に設定して packet を生成する。 |
| 期待結果 | packet 内の日本語が大きく文字化けしない。 |

### BZR-RT-031 maxDiffBytes truncation

| 項目 | 内容 |
| --- | --- |
| 目的 | 大きい diff が上限で切り詰められることを確認する。 |
| 手順 | 1. 大きい diff を用意する。<br>2. `bobBazaar.maxDiffBytes` を小さく設定する。<br>3. packet を生成する。 |
| 期待結果 | diff section が切り詰められ、truncated 表示が含まれる。 |

### BZR-RT-032 maxAddedFileContentBytes truncation

| 項目 | 内容 |
| --- | --- |
| 目的 | 追加ファイル本文の上限が守られることを確認する。 |
| 手順 | 1. 大きい追加ファイルを含む revision を用意する。<br>2. `bobBazaar.maxAddedFileContentBytes` を小さく設定する。<br>3. single revision packet を生成する。 |
| 期待結果 | added file contents section が上限内に収まり、省略情報が表示される。 |

### BZR-RT-033 unsafe revision / path エラー

| 項目 | 内容 |
| --- | --- |
| 目的 | 不正 revision / path が Bazaar CLI へ渡らないことを確認する。 |
| 手順 | 1. 改行や危険文字を含む revision を入力する。<br>2. GUI または direct command を実行する。 |
| 期待結果 | validation error になり、Bazaar CLI は実行されない。 |

### BZR-RT-034 End-to-End: Bob Workflow UI 経由

| 項目 | 内容 |
| --- | --- |
| 目的 | 同梱 workflow を Bob Workflow UI から実行し、packet 生成、規約読み込み、Bob 分析、result 保存まで確認する。 |
| 手順 | 1. `.bob` を初期化し workflow-register reload を実行する。<br>2. Bob Workflow UI で `bazaar-project-rule-review` を起動する。<br>3. `review-input`、`collect-context`、`load-rules`、agent、`output-result` を順に実行する。 |
| 期待結果 | review packet が Bob context に入り、review-result JSON / Markdown が `.bob/review/results` に保存される。 |

### BZR-RT-035 End-to-End: Command Palette 経由

| 項目 | 内容 |
| --- | --- |
| 目的 | Command Palette だけで packet 作成から result 保存まで実行できることを確認する。 |
| 手順 | 1. `reviewRevisionWithProjectRules` または GUI で packet を作る。<br>2. Bob にレビューさせる。<br>3. Bob 出力 JSON を clipboard または editor から capture する。<br>4. JSON validation を行う。 |
| 期待結果 | packet 生成、Bob context 追加、review-result 保存、validation が完了する。 |

### BZR-RT-036 Phase 1 campaign 初期化

| 項目 | 内容 |
| --- | --- |
| 目的 | Phase 1 実績作成用の `.bob-review-records` campaign 雛形を作成できることを確認する。 |
| 手順 | 1. `Bob Bazaar Review: 実績 campaign を初期化` を実行する。<br>2. workspace root の `.bob-review-records/campaigns/phase1-bazaar-review-uat-001` を確認する。 |
| 期待結果 | `campaign.yaml`、`targets.yaml`、`records/_template/record.yaml`、`records/_template/triage.yaml` が作成される。 |

### BZR-RT-037 review packet artifact 保存

| 項目 | 内容 |
| --- | --- |
| 目的 | Bob に渡した packet を campaign record 配下へ保存できることを確認する。 |
| 手順 | 1. GUI または direct command で review packet を作成する。<br>2. `bobBazaar.records.createRecord` を command 引数付きで呼ぶか、packet を `review-packet.md` として保存する。 |
| 期待結果 | `.bob-review-records/campaigns/<campaign_id>/records/<review_id>/review-packet.md` が存在し、既存 packet 更新時は backup が残る。 |

### BZR-RT-038 review-result から record.yaml 作成

| 項目 | 内容 |
| --- | --- |
| 目的 | capture 済み review-result と packet を `record.yaml` で追跡できることを確認する。 |
| 手順 | 1. review-result JSON / Markdown を `.bob/review/results` に保存する。<br>2. `Bob Bazaar Review: 実績 record を作成` を実行する。 |
| 期待結果 | `record.yaml` に target、packet、review-result JSON/Markdown、triage path、metrics が記録される。 |

### BZR-RT-039 human triage 雛形生成

| 項目 | 内容 |
| --- | --- |
| 目的 | Bob finding を人間判断用 `triage.yaml` に変換できることを確認する。 |
| 手順 | 1. findings を含む review-result を保存する。<br>2. `Bob Bazaar Review: 人間 triage 雛形を生成` を実行する。 |
| 期待結果 | finding ごとに item が作成され、初期 decision は `needs_investigation` になる。fail checklist だが finding がない rule も追加調査 item になる。 |

### BZR-RT-040 triage validation error

| 項目 | 内容 |
| --- | --- |
| 目的 | human triage の不正 decision や summary mismatch を検出できることを確認する。 |
| 手順 | 1. `triage.yaml` の decision を不正値に変更する。<br>2. `Bob Bazaar Review: 人間 triage を検証` を実行する。 |
| 期待結果 | invalid decision、unknown finding_id、summary mismatch が warning / error として表示される。 |

### BZR-RT-041 campaign summary 生成

| 項目 | 内容 |
| --- | --- |
| 目的 | 複数 record / triage から Phase 1 実績 summary を生成できることを確認する。 |
| 手順 | 1. 2 件以上の `record.yaml` と `triage.yaml` を用意する。<br>2. `Bob Bazaar Review: 実績 campaign summary を生成` を実行する。 |
| 期待結果 | `summary.json` と `summary.md` に件数、schema valid/invalid、triage decision、所要時間、estimated minutes saved が出る。 |

### BZR-RT-042 workflow run metadata 紐付け

| 項目 | 内容 |
| --- | --- |
| 目的 | workflow-register 実行がある場合に record と run metadata を紐付け、ない場合も実績作成を継続できることを確認する。 |
| 手順 | 1. workflow 経由と direct command 経由の両方で record を作る。<br>2. `record.yaml` の workflow section を確認する。 |
| 期待結果 | workflow 経由では run_id / status が入り、取得できない場合は `unavailable: true` として扱われる。 |

### BZR-RT-043 実績報告 Markdown 作成

| 項目 | 内容 |
| --- | --- |
| 目的 | campaign summary をプロジェクトリーダ向けの報告材料として読めることを確認する。 |
| 手順 | 1. `summary.md` を開く。<br>2. 件数、採用/棄却/追加調査、所要時間、warning を確認する。 |
| 期待結果 | Phase 1 実績報告へ転記でき、triage missing や invalid record が隠れない。 |

## 7. 実機テスト結果記録テンプレート

| 項目 | 記入欄 |
| --- | --- |
| テスト日 |  |
| テスト担当 |  |
| OS / バージョン |  |
| VS Code / Bob IDE バージョン |  |
| IBM Bob 拡張バージョン |  |
| workflow-register commit / VSIX |  |
| bob-bazaar-review commit / VSIX |  |
| Bazaar CLI バージョン |  |
| workspace path |  |
| 実施した testcase ID |  |
| 合格 |  |
| 不合格 |  |
| 保留 |  |
| 主な不具合 / 備考 |  |

## 8. 合格基準

- BZR-RT-001 から BZR-RT-006 までの起動・初期化・GUI 基本導線が合格する。
- Bazaar CLI 読み取り操作が `--no-aliases` 経路で実行され、packet が生成できる。
- review-result JSON / Markdown が `.bob/review/results` に保存できる。
- Phase 1 record / triage / summary が `.bob-review-records` に保存できる。
- active editor validation と MCP result tools が保存済み result を扱える。
- Bob Workflow UI 経由で主要 provider が provider missing にならない。
- multi-root で `.bob` と `.bzr` の責務分離が守られる。
- Developer Tools Console に未処理例外が残らない。

## 9. 回帰確認の優先度

| 優先度 | 対象 |
| --- | --- |
| P0 | 起動、project rules 初期化、GUI packet 生成、direct reviewRevision、capture、validation。 |
| P1 | workflow-register provider、Bob Workflow UI、MCP initialize / tools/list、multi-root、Phase 1 record / triage / summary。 |
| P2 | revisionRange、working tree、Shift-JIS / CP932、diff / added file truncation。 |
| P3 | file save fallback、Bob 拡張なし fallback、unsafe input、OS 差分。 |
