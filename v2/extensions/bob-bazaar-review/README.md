# Bob Bazaar Review（Bob Bazaar レビュー支援）

`bob-bazaar-review` は、Bazaar リポジトリの差分レビューを IBM Bob から扱いやすくするための VS Code 拡張機能です。

`IBM.bob-code` 本体は変更しません。ワークスペースの `.bob/mcp.json` に読み取り専用 Bazaar MCP サーバーを登録し、レビュー対象の収集、プロジェクト規約の読み込み、review-result JSON の検証と保存を支援します。

この README では、コマンド名、設定キー、JSON / YAML のフィールド名、ファイル名、識別子は実装上の名称として原文のまま記載します。

## Bazaar alias 対策

この拡張機能が実行する Bazaar CLI は、必ず `bzr --no-aliases <command>` 形式にします。

理由は、ユーザー環境の Bazaar alias に `diff` や `log` で GUI ツールを起動する設定があると、拡張機能側に stdout として差分やログが返らず、レビュー packet の生成や MCP tool の応答が壊れるためです。

AIチャット、Skill、Workflow、手動調査で Bazaar CLI を直接使う場合も同じです。

- 禁止: `bzr diff ...`、`bzr log ...`、`bzr status`
- 許可: `bzr --no-aliases diff ...`、`bzr --no-aliases log ...`、`bzr --no-aliases status`

## できること

- Bazaar の revision / revision range / working tree 差分を取得する。
- Bob に渡すレビュー用 Markdown パケットを作る。
- `.bob/review/checklist.json` と `.bob/review/review-result.schema.json` を使ったプロジェクト規約レビューを支援する。
- `workflow-register` のワークフローステップから呼び出せるコマンドを提供する。
- Bob が出力した review-result JSON を検証し、JSON と Markdown の成果物として保存する。
- 読み取り専用の Bazaar MCP ツールと、プロジェクト規約支援ツールを提供する。

## 任意連携

`bob-bazaar-review` は VS Code の必須 `extensionDependencies` を持ちません。`IBM.bob-code` や `workflow-register` が未導入でも拡張機能はロードでき、GUI またはレビューコマンドで `# Bazaar Revision Review Request` の Markdown packet を生成できます。

`IBM.bob-code` が導入されている場合は、生成した Markdown packet を Bob chat / context へ追加できます。`IBM.bob-code` が見つからない場合は、Markdown document を作成してそこで停止します。

`workflow-register` は任意です。導入されている場合は同梱ワークフロー `bazaar-project-rule-review` から action provider として呼び出せます。導入されていない場合でも、`IBM.bob-code` があれば生成した Markdown packet を Bob chat / context へ追加できます。

導入順は次を推奨します。

1. `bob-bazaar-review`
2. `IBM.bob-code`（Bob chat / context へ追加する場合のみ）
3. `workflow-register`（ワークフロー連携を使う場合のみ）

## 代表的な利用フロー

1. Bazaar ワークスペースを Bob IDE / VS Code で開く。
2. `Bob Bazaar: Open Bazaar Review GUI` を実行する。
3. `.bob` が未初期化の場合は `.bobを初期化` を押す。
4. レビュー対象を選ぶ。
5. `取得` で revision 情報と変更ファイルを確認する。
6. `レビューしてBobにADD` でレビュー用パケットを作成する。`IBM.bob-code` が導入済みなら Bob context に追加する。
7. Bob のワークフローで `bazaar-project-rule-review` を実行する。
8. Bob が出力した JSON を `Bob Bazaar: Capture Review Result` で検証、保存する。

## Command Palette のコマンド

| コマンド | 用途 |
| --- | --- |
| `Bob Bazaar: Open Bazaar Review GUI` | Bazaar レビュー用 GUI を開く。 |
| `Bob Bazaar: Collect Bazaar Review Context` | ワークフローステップから、現在のレビュー対象メタデータ、変更ファイル、レビュー用パケット概要を取得する。 |
| `Bob Bazaar: Load Project Review Rules` | `.bob/review/checklist.json` と `.bob/review/review-result.schema.json` を読み込む。欠落時はエラーにする。 |
| `Bob Bazaar: Capture Review Result` | active editor、selection、clipboard から review-result JSON を抽出し、検証して保存する。 |
| `Bob Bazaar: Save Review Result from Clipboard` | clipboard だけを入力として review-result JSON を検証して保存する。 |
| `Bob Bazaar: Configure Bazaar MCP for Bob` | `.bob/mcp.json` に Bazaar MCP サーバーを登録する。 |
| `Bob Bazaar: Initialize Project Review Rules` | `.bob/review/checklist.json` と `.bob/review/review-result.schema.json` を未作成時に生成する。 |
| `Bob Bazaar: Review Bazaar Revision with Bob` | `bzr log -r REV` と `bzr diff -c REV` をもとにレビュー用パケットを作る。 |
| `Bob Bazaar: Review Bazaar Revision Range with Bob` | `bzr diff -r BASE..TARGET` をもとにレビュー用パケットを作る。 |
| `Bob Bazaar: Review Bazaar Revision with Project Rules` | 単一 revision レビューにプロジェクト規約と JSON 出力契約を追加する。 |
| `Bob Bazaar: Review Bazaar Revision Range with Project Rules` | revision range レビューにプロジェクト規約と JSON 出力契約を追加する。 |
| `Bob Bazaar: Validate Project Review Result JSON` | active editor / selection の review-result JSON を検証し、Markdown 表示できる。 |

## レビュー GUI

`Bob Bazaar: Open Bazaar Review GUI` を実行すると、GUI でレビュー対象を選べます。

GUI は次の `.bob` ファイルを確認します。

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

不足している場合、GUI は `未初期化` と不足ファイルを表示します。`.bobを初期化` を押すと、不足している Skill、Workflow、Mode、review template、MCP 設定を作成します。

### レビュー対象モード

| モード | 入力 | Bazaar 操作 |
| --- | --- | --- |
| `1リビジョン` | `Revision` | `bzr log -r REV` と `bzr diff -c REV` |
| `リビジョン範囲` | `Base revision`, `Target revision` | `bzr diff -r BASE..TARGET`。可能なら target log も取得する。 |
| `TOPリビジョンと未コミット差分` | 任意の `Base revision` | 未入力なら `bzr revno` を使い、`bzr diff -r BASE` と `bzr status` を取得する。 |

単一 revision と revision range では、新規追加ファイルの内容も `bobBazaar.maxAddedFileContentBytes` の上限内でレビュー用パケットに含めます。

## `workflow-register` との連携

この拡張は、`workflow-register` から呼び出されるコマンドを提供します。代表例は同梱ワークフロー `bazaar-project-rule-review` です。

### コンテキスト収集

~~~~md
## Step: collect-context

```workflow-step
command: bobBazaar.collectReviewContext
sendResult: true
resultKey: reviewContext
required: true
completeOnSuccess: false
```
~~~~

`collectReviewContext` は、GUI やコマンドで作成された Bazaar review packet を読み、revision 情報、変更ファイル、byte count、packet 概要を返します。

### 規約読み込み

~~~~md
## Step: load-rules

```workflow-step
command: bobBazaar.loadReviewRules
sendResult: true
resultKey: reviewRules
required: true
completeOnSuccess: false
```
~~~~

`loadReviewRules` は `.bob/review/checklist.json` と `.bob/review/review-result.schema.json` を必須として扱います。欠落している場合、required step は pending のままになり、Bob には command failure が渡されます。

## レビュー結果の保存

Bob が正規化 review-result JSON を出力したら、JSON fenced block をコピーして次のどちらかを実行します。

```text
Bob Bazaar: Capture Review Result
Bob Bazaar: Save Review Result from Clipboard
```

入力は raw JSON と fenced JSON block の両方に対応します。

```json
{
  "review_id": "bazaar-r2-project-rule-review",
  "vcs": {
    "type": "bazaar",
    "repository": "C:/repo/trunk",
    "revision": "2"
  },
  "checklist_results": [],
  "findings": [],
  "summary": {
    "pass": 0,
    "fail": 0,
    "unknown": 0,
    "not_applicable": 0,
    "blocked": 0
  }
}
```

検証に成功すると次のファイルを保存します。

```text
.bob/review/results/<review_id>.json
.bob/review/results/<review_id>.md
```

Markdown は `renderReviewResultMarkdown` で生成され、件数、チェックリスト、evidence、findings を確認できます。検証に失敗した場合は、問題点を Markdown レポートとして表示します。

## MCP ツール

同梱 MCP サーバーは Bazaar 操作を読み取り専用で公開します。

| ツール | Bazaar 操作 |
| --- | --- |
| `bazaar_root` | `bzr root` |
| `bazaar_revno` | `bzr revno` |
| `bazaar_log` | `bzr log` / `bzr log -r REV` |
| `bazaar_diff_revision` | `bzr diff -c REV` |
| `bazaar_diff_range` | `bzr diff -r BASE..TARGET` |
| `bazaar_diff_working_tree` | `bzr diff` / `bzr diff -r BASE` |
| `bazaar_cat_revision` | `bzr cat -r REV PATH` |
| `bazaar_status` | `bzr status` |

次のような破壊的操作は公開しません。

```text
commit, push, pull, update, revert, merge, resolve
```

プロジェクト規約支援ツールも公開します。

| ツール | 用途 |
| --- | --- |
| `project_rules_init` | 既定の `.bob/review` 規約ファイルを作成する。 |
| `project_rules_get_checklist` | project checklist JSON を返す。 |
| `project_rules_get_schema` | review-result JSON schema を返す。 |
| `project_rules_validate_review_result` | 正規化 review-result JSON を検証する。 |
| `project_rules_render_markdown` | 正規化 review-result JSON を Markdown checklist に変換する。 |

## プロジェクト規約ファイル

既定の構成は次の通りです。

```text
.bob/
  review/
    checklist.json
    review-result.schema.json
```

`checklist.json` はプロジェクト固有のレビュー規約の source of truth です。

```json
{
  "version": "1.0.0",
  "project": "legacy-control",
  "rules": [
    {
      "id": "RT-001",
      "category": "realtime",
      "title": "RTスレッド内でI/Oを行っていない",
      "description": "RT_INPUT, RT_CONTROL, RT_OUTPUTではファイルI/O、標準出力、ログ出力、待ち処理を行わない。",
      "severity_on_fail": "error",
      "applies_when": ["changed_file_matches:src/rt_*.c", "diff_contains:RT_CONTROL"],
      "evidence_required": true,
      "review_hint": "I/O関数、ログ関数、sleep/wait、mutex待ち、動的確保を重点確認する。"
    }
  ]
}
```

Bob には JSON を先に返し、その後に Markdown checklist を出力するよう指示します。正式な成果物は JSON で、Markdown の `[x]` 等は人間向け表示です。

### checklist status

| Status | Markdown mark | 意味 |
| --- | --- | --- |
| `pass` | `[x]` | evidence があり、問題が見つからない。 |
| `fail` | `[ ]` | 規約違反または高リスクが見つかった。 |
| `unknown` | `[?]` | evidence が不足している。 |
| `not_applicable` | `[-]` | その規約が明確に対象外。 |
| `blocked` | `[!]` | 必須 tool、file、revision、rule を取得できない。 |

## 設定

| 設定 | 既定値 | 説明 |
| --- | --- | --- |
| `bobBazaar.bzrPath` | `bzr` | Bazaar 実行ファイルのパス。PATH にない場合は絶対パスを指定する。 |
| `bobBazaar.mcpServerName` | `bazaar` | `.bob/mcp.json` に書き込む MCP サーバー名。 |
| `bobBazaar.maxDiffBytes` | `1048576` | レビュー用パケットに含める diff の最大 byte 数。 |
| `bobBazaar.maxAddedFileContentBytes` | `262144` | 新規追加ファイル本文を含める最大合計 byte 数。`0` で省略する。 |
| `bobBazaar.projectRules.checklistPath` | `.bob/review/checklist.json` | checklist JSON のパス。 |
| `bobBazaar.projectRules.schemaPath` | `.bob/review/review-result.schema.json` | review-result JSON schema のパス。 |

## Bob MCP 設定

Bazaar ワークスペースを開いて次を実行します。

```text
Bob Bazaar: Configure Bazaar MCP for Bob
```

`.bob/mcp.json` には次のような設定が書き込まれます。

```json
{
  "mcpServers": {
    "bazaar": {
      "command": "<node executable>",
      "args": ["<extension>/out/mcp/server.js"],
      "env": {
        "BZR_PATH": "bzr"
      },
      "disabled": false
    }
  }
}
```

`.bob/mcp.json` を変更した後は、Bob の MCP サーバーを再読み込みするか、Bob IDE / VS Code を再起動してください。

## ビルド

```powershell
cd extensions\bob-bazaar-review
npm install
npm run compile
npm run test
npm run package
```

生成された VSIX を Bob IDE / VS Code にインストールします。

```powershell
code --install-extension bob-bazaar-review-0.3.0.vsix
```

## セキュリティ設計

- Bazaar は shell 文字列ではなく `execFile` / argument array で実行します。
- revision 文字列と repository relative path は実行前に検証します。
- MCP サーバーの Bazaar 操作は読み取り専用です。
- diff と追加ファイル本文には byte 上限があります。
- `pass` / `fail` の checklist result には evidence が必要です。
- `fail` の rule には同じ `rule_id` を持つ finding が必要です。

## 関連ドキュメント

- `docs/workflow-authoring-guide-ja.md`
- `extensions/workflow-register/README.md`
- `extensions/README.md`
