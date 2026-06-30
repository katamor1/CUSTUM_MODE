# Bob Workflow Register（Bob ワークフロー登録）

`workflow-register` は、ワークスペースに置かれた IBM Bob 用のワークフロー定義を読み込み、Bob の Workflow UI に登録するための VS Code 拡張機能です。`.bob/workflows/*/WORKFLOW.md` を対象に、ワークフローの作成、検証、実行、再開、診断、AI 補助を行うコマンドを提供します。

この README では、コマンド名、設定キー、JSON / YAML のフィールド名、ファイル名、識別子は実装上の名称として原文のまま記載します。

## できること

- `.bob/workflows/*/WORKFLOW.md` を Bob ワークフローとして登録する。
- `schemaVersion: workflow-register/v1` のワークフロー定義を検証する。
- テンプレートから新しいワークフローを作成する。
- 手動ステップ、コマンドステップ、エージェントステップ、結果ステップを順番に実行する。
- ステップの結果をワークフロー状態に保存し、後続ステップへ渡す。
- 実行状態を保存し、診断、再開、再試行を行う。
- AI プロバイダー用コマンドが設定されている場合、ワークフローの設計、改善、診断説明を補助する。

## 前提

- VS Code / Bob IDE: `^1.106.1`
- IBM Bob 拡張: `IBM.bob-code`
- Node.js / npm
- TypeScript

## ワークフローの配置

ワークフローは、ワークスペース直下の `.bob/workflows` に配置します。

```text
<workspace>/
  .bob/
    workflows/
      workflow-name/
        WORKFLOW.md
```

読み込み対象は次のパターンだけです。

```text
.bob/workflows/*/WORKFLOW.md
```

`workflow-name` と front matter の `name` は一致させることを推奨します。

## 最短手順

1. Bob IDE / VS Code で対象ワークスペースを開く。
2. Command Palette で `Bob Workflow Register: Create Workflow from Template` を実行する。
3. テンプレート、ワークフロー名、表示タイトル、説明を入力する。
4. 生成された `.bob/workflows/<name>/WORKFLOW.md` を編集する。
5. `Bob Workflow Register: Validate Current Workflow` で検証する。
6. `Bob Workflow Register: Reload Bob Workflow Files` で再読み込みする。
7. Bob の `Start Workflow` または `Bob Workflow Register: Run Workflow` から実行する。

## テンプレート

| テンプレート | 用途 |
| --- | --- |
| `simple-agent` | 1 つの AI ステップで完結する基本形。 |
| `command-then-agent` | VS Code コマンドで情報を集め、AI ステップに渡す。 |
| `manual-checklist` | 人間の確認ステップを順番に進める。 |
| `input-driven-agent` | 実行前に入力値を集めてプロンプトに使う。 |
| `preflight-files` | 必須ファイルを確認してから実行する。 |
| `artifact-output` | AI 結果をファイル成果物として保存する。 |
| `guarded-command` | コマンド実行のガードレールと承認を明示する。 |
| `review-workflow` | レビュー対象の収集、分析、結果出力をまとめる。 |

## 推奨フォーマット

新規ワークフローでは `schemaVersion: workflow-register/v1` を指定してください。

```md
---
schemaVersion: workflow-register/v1
name: sample-review
description: "サンプル対象をレビューする"
title: "サンプルレビュー"
mode: agent
workspaceRequired: true
steps:
  - id: analyze
    title: 分析
    type: agent
    prompt: |
      対象を確認し、結果を日本語で要約してください。
---
# サンプルレビュー

## 目的

サンプル対象をレビューする。
```

必須フィールドは `name` と `description` です。`name` は英数字、`.`、`_`、`-` を使い、先頭は英数字にしてください。

## 主なトップレベルフィールド

| フィールド | 説明 |
| --- | --- |
| `schemaVersion` | 推奨値は `workflow-register/v1`。省略時は legacy 形式として扱う。 |
| `id` | Bob に渡す完全 ID。省略時は `<sourceId>.<name>`。 |
| `name` | 安定したワークフロー名。フォルダ名との一致を推奨する。 |
| `description` | Bob UI と検証レポートに表示する説明。 |
| `title` / `label` / `menuLabel` | 表示名。`label` は `title` より優先される。 |
| `mode` | Bob の実行モード。既定値は `agent`。 |
| `permissions` | Bob の承認権限。Todo 有効時は `todo` が追加される。 |
| `workspaceRequired` | ワークスペースがある時だけ有効にするか。既定値は `true`。 |
| `inputs` | 実行前入力。`string` / `number` / `boolean` / `select` を指定できる。 |
| `requires` | ワークスペース、Bob 最小バージョン、必須ファイルなどの実行条件。 |
| `preflight` | 実行前チェック。 |
| `guardrails` | 許可コマンド、禁止コマンド、承認メッセージ。 |
| `artifacts` | 生成成果物の宣言。 |
| `completion` | 完了時の要約、成果物表示、結果検証。 |
| `steps` | 実行ステップ本体。新規ワークフローではこの形式を推奨する。 |

## ステップの種類

| `type` | 用途 |
| --- | --- |
| `agent` | Bob / agent にプロンプトを送って処理させる。 |
| `command` | VS Code コマンドやアクションプロバイダーを実行する。 |
| `manual` | 人間が確認して完了させる。 |
| `result` | 状態や固定値から結果を作り、ファイルまたはコマンドの出力先へ渡す。 |

### コマンドステップ

```yaml
steps:
  - id: collect-context
    title: コンテキスト収集
    type: command
    action:
      provider: vscode.executeCommand
      args:
        - example.collectContext
    resultKey: collectedContext
    required: true
    sendResult: true
```

`vscode.executeCommand` を使う場合、`args` の先頭に VS Code コマンド ID を置きます。`resultKey` を指定すると、コマンドの戻り値をワークフロー状態に保存できます。

### エージェントステップ

```yaml
steps:
  - id: analyze
    title: 分析
    type: agent
    includeState:
      - collectedContext
    prompt: |
      collectedContext を使って分析してください。
```

`includeState` には、前段ステップの `resultKey` で保存した値だけを指定できます。

### 手動ステップ

```yaml
stepCompletion: manual
steps:
  - id: confirm-input
    title: 入力確認
    type: manual
    prompt: |
      入力値と前提条件を確認してください。
```

手動ステップを進めるには、`Workflow Step: Complete Current Step` または `Bob Workflow Register: Complete Current Bob Workflow Step` を実行します。

### 結果ステップ

```yaml
artifacts:
  - id: report
    producedBy: write-report
    path: .bob/artifacts/sample-report.md
completion:
  includeArtifacts: true
steps:
  - id: analyze
    title: 分析
    type: agent
    resultKey: analysisReport
    prompt: |
      Markdown レポートを作成してください。
  - id: write-report
    title: レポート書き込み
    type: result
    result:
      source: state
      stateKey: analysisReport
      sinks:
        - type: file
          path: .bob/artifacts/sample-report.md
```

`file` 出力先は、ワークスペース外への書き込みを拒否します。

## 入力値

```yaml
inputs:
  target:
    type: string
    title: 対象パスまたはトピック
    required: true
  outputStyle:
    type: select
    title: 出力スタイル
    required: true
    options:
      - concise
      - detailed
steps:
  - id: analyze
    title: 入力の分析
    type: agent
    prompt: |
      Target: {{inputs.target}}
      Output style: {{inputs.outputStyle}}
```

`select` input には `options` が必要です。

## legacy 形式

既存互換のため、Markdown の `## Todo` と `## Step: <id>` による legacy 形式もサポートしています。新規ワークフローでは `schemaVersion: workflow-register/v1` と `steps:` の使用を推奨します。

~~~~md
## Todo

- [ ] collect-context: コンテキストを集める
- [ ] analyze: 分析する

## Step: collect-context

```workflow-step
command: bobBazaar.collectReviewContext
sendResult: true
resultKey: reviewContext
required: true
```
~~~~

## 検証

| コマンド | 用途 |
| --- | --- |
| `Bob Workflow Register: Validate Current Workflow` | 開いている `WORKFLOW.md` だけを検証する。 |
| `Bob Workflow Register: Validate Workspace Workflows` | ワークスペース内のワークフローをまとめて検証する。 |

主な検証内容:

- YAML front matter があるか。
- `name` / `description` があるか。
- `schemaVersion: workflow-register/v1` の構造が schema に合っているか。
- ステップ ID が重複していないか。
- `includeState` が存在する `resultKey` を参照しているか。
- `result.source: state` の `stateKey` が存在するか。
- `artifact.producedBy` が存在するステップを参照しているか。
- `select` input に `options` があるか。
- `guardrails.allowedCommands` と `guardrails.deniedCommands` が衝突していないか。

保存時と active editor 切り替え時にも `WORKFLOW.md` は diagnostics の対象になります。

## 実行と運用

| コマンド | 用途 |
| --- | --- |
| `Bob Workflow Register: Reload Bob Workflow Files` | ワークフローファイルを再読み込みして Bob に登録する。 |
| `Bob Workflow Register: Inspect Bob Workflow Registration` | 登録状況と診断を Markdown で確認する。 |
| `Bob Workflow Register: Run Workflow` | ワークフローを選択して実行する。 |
| `Bob Workflow Register: Inspect Workflow Runs` | 実行状態を確認する。 |
| `Bob Workflow Register: Resume Workflow Run` | 中断または保持された実行を再開する。 |
| `Bob Workflow Register: Retry Current Workflow Step` | 現在のステップを再試行する。 |
| `Bob Workflow Register: Inspect Workflow Run Diagnostics` | 実行診断を確認する。 |
| `Bob Workflow Register: Inspect Active Bob Workflow Steps` | 手動完了待ちステップを確認する。 |
| `Bob Workflow Register: Complete Current Bob Workflow Step` | 現在の手動ステップを完了する。 |

実行状態は、ワークスペース内の `.bob/workflows/runs/<runId>/run.json` に保存されます。

## AI 補助

| コマンド | 用途 |
| --- | --- |
| `Bob Workflow Register: Design Workflow with AI` | 目的とテンプレート候補から新しい `WORKFLOW.md` を作る。 |
| `Bob Workflow Register: Improve Workflow with AI` | 開いているワークフローの検証結果をもとに修正案を作る。 |
| `Bob Workflow Register: Explain Workflow Diagnostics` | 診断結果を説明する。 |

AI プロバイダーは `workflowRegister.aiProviderCommand` で指定します。未設定時は mock provider が使われます。

`Improve Workflow with AI` は候補 Markdown を preview し、`.bob/workflows/.previews/...` に保存し、diff を表示します。明示確認後に backup を作成して適用します。

## 拡張ポイント

別拡張は `workflow-register` の API を使って処理を差し込めます。

| API | 用途 |
| --- | --- |
| `registerActionProvider(provider)` | `command` ステップで使うアクションプロバイダーを追加する。 |
| `registerAgentProvider(provider)` | standalone engine 用のエージェントプロバイダーを追加する。 |
| `registerResultSink(type, handler)` | `result` ステップの出力先を追加する。 |
| `listWorkflows()` | 読み込み済みワークフロー定義を取得する。 |
| `runWorkflow(workflowId, inputs)` | ワークフローをプログラムから実行する。 |

## 設定

| 設定 | 既定値 | 説明 |
| --- | --- | --- |
| `workflowRegister.sourceId` | `workflow-register` | Bob に登録する source ID。 |
| `workflowRegister.sourceName` | `Workflow Register` | Bob に表示する source 名。 |
| `workflowRegister.agentCommand` | 空 | standalone engine のエージェントステップを実行する VS Code コマンド。 |
| `workflowRegister.aiProviderCommand` | 空 | AI 設計、改善、診断説明に使う VS Code コマンド。 |

## ビルド

```powershell
cd extensions\workflow-register
npm install
npm run compile
npm run test
npm run package
```

生成される VSIX 名は次の形式です。

```text
workflow-register-0.1.0.vsix
```

## トラブルシュート

| 症状 | 確認ポイント |
| --- | --- |
| Bob の Workflow UI に出ない | `.bob/workflows/*/WORKFLOW.md` の配置、`hidden`、`workspaceRequired`、Bob 側ワークスペースを確認する。 |
| `missing YAML front matter` | ファイル先頭が `---` で始まり、front matter が `---` で閉じているか確認する。 |
| `invalid YAML` | インデント、リストの `-`、引用符、タブ混入を確認する。 |
| `includeState references unknown resultKey` | 参照先より前のステップに `resultKey` があるか確認する。 |
| `Unsupported action provider` | provider ID が登録済みか、または `vscode.executeCommand` を使っているか確認する。 |
| `select but has no options` | `inputs.<name>.options` に候補を追加する。 |
| 手動ステップが進まない | `Complete Current Bob Workflow Step` または `Workflow Step: Complete Current Step` を実行する。 |

## 関連ドキュメント

- `docs/basic-design-ja.md`
- `docs/detailed-design-ja.md`
- `docs/workflow-authoring-guide-ja.md`
- `docs/bob-task-export-recovery-plan-ja.md`
- `extensions/bob-bazaar-review/README.md`
- `extensions/README.md`
