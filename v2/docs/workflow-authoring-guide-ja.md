# IBM Bob ワークフロー作成手順書

この手順書は、`workflow-register` を使って IBM Bob 用のワークフローを作成、検証、実行、改善するための日本語ガイドです。

## 目的

Bob workflow は、AI に渡す prompt だけでなく、事前入力、外部 command、手動確認、成果物保存、診断、再開をまとめて扱うための実行単位です。

次のような作業を、毎回チャットで説明し直さずに再利用できます。

- Bazaar 差分レビュー
- プロジェクト規約レビュー
- 設計書レビュー
- テスト観点抽出
- 変更影響調査
- 調査結果レポート生成
- 人間の確認を挟む段階的作業

## 前提

- Bob IDE / VS Code で対象 workspace を開いている。
- `IBM.bob-code` がインストールされている。
- `workflow-register` がインストールされている。
- 必要に応じて `bob-bazaar-review` などの連携拡張がインストールされている。

## 全体の流れ

1. 作りたい作業を 1 文で定義する。
2. workflow 名と配置先を決める。
3. テンプレートまたは手書きで `WORKFLOW.md` を作る。
4. `steps` を設計する。
5. `inputs`、`preflight`、`guardrails`、`artifacts` を必要に応じて追加する。
6. 検証コマンドでエラーを消す。
7. Bob に再登録する。
8. 実行して run diagnostics を確認する。
9. 改善点を README / workflow / checklist に反映する。

## 1. 作業を 1 文で定義する

最初に、workflow の目的を短く書きます。

よい例:

```text
Bazaar の指定 revision range をプロジェクト規約に照らしてレビューし、正規化 JSON と Markdown チェックリストを出す。
```

悪い例:

```text
レビューする。
```

目的文には、次の 3 点を入れると設計しやすくなります。

| 観点 | 例 |
| --- | --- |
| 入力 | revision、対象ファイル、設計書、差分、チケット番号 |
| 処理 | 収集、検証、分析、レビュー、変換、要約 |
| 出力 | JSON、Markdown、チェックリスト、設計メモ、修正案 |

## 2. workflow 名を決める

`name` は安定 ID として扱います。フォルダ名と一致させてください。

```text
.bob/workflows/<name>/WORKFLOW.md
```

命名ルール:

- 英数字、`.`、`_`、`-` を使う。
- 先頭は英数字にする。
- 空白は使わない。
- 後から変えにくいので、機能名を短く明確にする。

例:

| 用途 | name |
| --- | --- |
| Bazaar 規約レビュー | `bazaar-project-rule-review` |
| 設計書レビュー | `design-doc-review` |
| テスト観点抽出 | `test-viewpoint-extraction` |
| workflow 自体の検証 | `workflow-self-review` |

## 3. 作成方法を選ぶ

### 方法 A: テンプレートから作る

Command Palette で次を実行します。

```text
Bob Workflow: テンプレートから作成
```

選ぶ目安:

| やりたいこと | テンプレート |
| --- | --- |
| AI に 1 回依頼すればよい | `simple-agent` |
| command で情報収集してから AI に渡す | `command-then-agent` |
| 人間の確認を段階的に挟む | `manual-checklist` |
| 実行前にユーザー入力が必要 | `input-driven-agent` |
| 必須ファイルがある | `preflight-files` |
| レポート等をファイル保存する | `artifact-output` |
| command 実行に承認や禁止ルールが必要 | `guarded-command` |
| レビュー結果を構造化したい | `review-workflow` |

### 方法 B: 手書きで作る

次の最小形から始めます。

```md
---
schemaVersion: workflow-register/v1
name: sample-workflow
description: "サンプル作業を実行する"
title: "Sample Workflow"
mode: agent
workspaceRequired: true
steps:
  - id: analyze
    title: Analyze
    type: agent
    prompt: |
      対象を確認し、結果を日本語で要約してください。
---
# Sample Workflow

## Goal

サンプル作業を実行する。
```

### 方法 C: AI で下書きする

Command Palette で次を実行します。

```text
Bob Workflow: AI で新規設計
```

入力する内容:

- workflow goal
- preferred workflow template

`workflowRegister.aiProviderCommand` が未設定の場合は mock provider が使われます。実運用で AI 設計補助を使う場合は、社内方針に合う provider command を設定してください。

## 4. `WORKFLOW.md` の基本構造

`WORKFLOW.md` は、YAML front matter と Markdown 本文で構成します。

```md
---
# YAML front matter
---
# Markdown body
```

front matter は機械が読む定義です。Markdown body は人間が読む説明と、Bob に渡す補足指示です。

## 5. top-level フィールドを埋める

まずは次の項目だけで開始できます。

```yaml
schemaVersion: workflow-register/v1
name: sample-workflow
description: "サンプル作業を実行する"
title: "Sample Workflow"
mode: agent
workspaceRequired: true
steps: []
```

よく使うフィールド:

| フィールド | 使いどころ |
| --- | --- |
| `permissions` | Bob approval permissions を明示したい。 |
| `inputs` | 実行前にユーザー入力を受け取りたい。 |
| `requires` | workspace、Bob version、必須ファイルを宣言したい。 |
| `preflight` | 実行前チェックを行いたい。 |
| `guardrails` | command 実行の許可・禁止・承認条件を明示したい。 |
| `artifacts` | 出力ファイルを成果物として扱いたい。 |
| `completion` | 完了時に成果物や結果検証を扱いたい。 |

## 6. step を設計する

step は workflow の実行単位です。まず、作業を 3〜7 個程度の step に分けます。

例: Bazaar 規約レビュー

```text
1. review-input: 対象 revision / range を確認する
2. collect-context: Bazaar 差分と変更ファイル情報を集める
3. load-rules: プロジェクト規約と JSON schema を読み込む
4. analyze-changes: 差分を規約に照らして分析する
5. output-result: review-result JSON と Markdown を出す
```

### step type の選び方

| type | 選ぶ基準 |
| --- | --- |
| `command` | VS Code command、MCP 連携、別拡張の処理で情報を集める。 |
| `agent` | AI に判断、要約、分析、生成をさせる。 |
| `manual` | 人間の確認が終わるまで先へ進めない。 |
| `result` | state や agent 結果をファイルや command に渡す。 |

## 7. command step を作る

`vscode.executeCommand` を使う場合の例です。

```yaml
steps:
  - id: collect-context
    title: Collect context
    type: command
    action:
      provider: vscode.executeCommand
      args:
        - bobBazaar.collectReviewContext
    resultKey: reviewContext
    sendResult: true
    required: true
```

設計ポイント:

- `args` の先頭は command ID。
- `resultKey` を付けると後続 step で参照できる。
- `sendResult: true` にすると command 結果を Bob message に含める。
- `required: true` にすると失敗時に workflow を止めやすい。

## 8. state を後続 step に渡す

前段 step の `resultKey` を、後続 step の `includeState` で参照します。

```yaml
steps:
  - id: collect-context
    title: Collect context
    type: command
    action:
      provider: vscode.executeCommand
      args:
        - bobBazaar.collectReviewContext
    resultKey: reviewContext

  - id: analyze
    title: Analyze
    type: agent
    includeState:
      - reviewContext
    prompt: |
      reviewContext を使って分析してください。
```

`includeState` が存在しない `resultKey` を参照すると検証エラーになります。

## 9. 実行前入力を定義する

```yaml
inputs:
  target:
    type: string
    title: Target path or topic
    required: true
  outputStyle:
    type: select
    title: Output style
    required: true
    options:
      - concise
      - detailed
```

prompt では次のように参照します。

```yaml
steps:
  - id: analyze
    title: Analyze input
    type: agent
    prompt: |
      Target: {{inputs.target}}
      Output style: {{inputs.outputStyle}}
```

## 10. preflight を定義する

必須ファイルがないと実行しても失敗する workflow では、`requires` と `preflight` を使います。

```yaml
requires:
  workspace: true
  files:
    - .bob/review/checklist.json
    - .bob/review/review-result.schema.json
preflight:
  - id: required-review-files
    title: Required review files exist
    required: true
    files:
      - .bob/review/checklist.json
      - .bob/review/review-result.schema.json
    failurePolicy: stop
```

`failurePolicy` は `stop`、`continue`、`warn` を指定できます。

## 11. guardrails を定義する

command を使う workflow では、許可・禁止・承認を明示してください。

```yaml
guardrails:
  allowedCommands:
    - bobBazaar.collectReviewContext
    - bobBazaar.loadReviewRules
  deniedCommands:
    - bzr.commit
    - bzr.push
  requireApproval:
    - id: command-approval
      when: before-command
      message: この command が現在の workspace で安全か確認してください。
```

同じ command を `allowedCommands` と `deniedCommands` の両方に入れると検証エラーになります。

## 12. 成果物を書き出す

AI の出力を Markdown ファイルに保存する例です。

```yaml
artifacts:
  - id: report
    producedBy: write-report
    path: .bob/artifacts/sample-report.md
completion:
  includeArtifacts: true
steps:
  - id: analyze
    title: Analyze
    type: agent
    resultKey: analysisReport
    prompt: |
      Markdown レポートを作成してください。
  - id: write-report
    title: Write report
    type: result
    result:
      source: state
      stateKey: analysisReport
      sinks:
        - type: file
          path: .bob/artifacts/sample-report.md
```

`file` sink は workspace 外のパスを拒否します。

## 13. 検証する

現在のファイルだけを検証する場合:

```text
Bob Workflow: 現在の定義を検証
```

workspace 内の workflow をまとめて検証する場合:

```text
Bob Workflow: ワークスペース定義を検証
```

検証で見るべき優先順位:

1. `error` を 0 にする。
2. `warning` をレビューし、意図したものだけ残す。
3. `info` で読み込み対象と schema version を確認する。

よくあるエラー:

| エラー | 対処 |
| --- | --- |
| `missing YAML front matter` | ファイル先頭に `---` を置き、front matter を閉じる。 |
| `invalid YAML` | インデント、リスト、引用符、タブ混入を直す。 |
| `Duplicate step id` | step ID を一意にする。 |
| `includeState references unknown resultKey` | 前段 step に `resultKey` を追加するか、参照を削除する。 |
| `select but has no options` | `inputs.<name>.options` を追加する。 |
| `Artifact ... unknown producedBy step` | `producedBy` を存在する step ID にする。 |
| `both allowed and denied` | command を allowed / denied の片方だけに置く。 |

## 14. Bob に再登録する

ファイルを保存したら、必要に応じて再読み込みします。

```text
Bob Workflow: ファイルを再読み込み
```

登録状態を確認します。

```text
Bob Workflow: 登録状態を確認
```

Bob の `Start Workflow` に表示されない場合は、次を確認してください。

- `.bob/workflows/*/WORKFLOW.md` の配置になっているか。
- `hidden: true` になっていないか。
- `workspaceRequired: true` なのに Bob 側 workspace がない状態で見ていないか。
- 検証エラーで登録対象から外れていないか。

## 15. 実行する

Bob の UI から実行する場合:

```text
Start Workflow
```

Command Palette から実行する場合:

```text
Bob Workflow: 実行
```

手動 step がある場合は、作業が終わったら次を実行します。

```text
Bob Workflow: 現在のステップを完了
```

または:

```text
Workflow Step: Complete Current Step
```

## 16. run を確認・再開する

実行状態を確認します。

```text
Bob Workflow: 実行履歴を確認
```

診断を確認します。

```text
Bob Workflow: 診断を確認
```

途中で止まった run を再開します。

```text
Bob Workflow: 実行を再開
```

現在 step を再試行します。

```text
Bob Workflow: 現在のステップを再試行
```

run state は次の場所に保存されます。

```text
.bob/workflows/runs/<runId>/run.json
```

## 17. AI で改善する

開いている `WORKFLOW.md` を改善したい場合:

```text
Bob Workflow: AI で改善
```

処理の流れ:

1. 現在の workflow を検証する。
2. 診断結果から repair context を作る。
3. AI provider に修正案を要求する。
4. 置換候補 Markdown を検証する。
5. preview と diff を表示する。
6. 明示確認後に backup を作成して上書きする。

すぐに上書きされるわけではないため、差分を確認してから適用できます。

## 18. レビュー観点チェックリスト

workflow を追加・変更したら、次を確認してください。

### 構造

- [ ] `schemaVersion: workflow-register/v1` を使っている。
- [ ] `name` とフォルダ名が一致している。
- [ ] `description` が人間にも Bob にも分かる。
- [ ] step ID が一意で、作業順に並んでいる。

### 実行

- [ ] `command` step の provider と args が正しい。
- [ ] `resultKey` と `includeState` の対応が正しい。
- [ ] required step の失敗時に止まるべきところで止まる。
- [ ] manual step は人間が判断する内容だけに絞っている。

### 安全性

- [ ] 破壊的 command を実行しない。
- [ ] 必要なら `guardrails.deniedCommands` を設定している。
- [ ] workspace 外へのファイル出力がない。
- [ ] 大きすぎる diff / result をそのまま Bob に渡さない。

### 出力

- [ ] 出力形式が明確。
- [ ] JSON が正式成果物の場合、schema と validation を用意している。
- [ ] Markdown は人間向け表示として位置づけている。
- [ ] 成果物の保存先が `.bob/artifacts` や `.bob/review/results` など分かりやすい。

## 19. 推奨する整備単位

workflow を増やすときは、次の 3 点をセットで整備してください。

```text
.bob/workflows/<workflow-name>/WORKFLOW.md
.bob/skills/<skill-name>/SKILL.md        # 必要な場合
.bob/review/checklist.json              # レビュー規約が必要な場合
```

拡張機能として提供する場合は、README に次を必ず書きます。

- 何をする拡張か。
- どの Bob / workflow-register command と連携するか。
- 初期化手順。
- 設定項目。
- 代表的な workflow 例。
- 生成・保存されるファイル。
- 破壊的操作をしない設計か。

## 20. 関連 README

- `extensions/workflow-register/README.md`
- `extensions/bob-bazaar-review/README.md`
- `extensions/README.md`
