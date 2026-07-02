# Bob Workflow Register（Bob ワークフロー登録）

`workflow-register` は、ワークスペースに置かれた IBM Bob 用のワークフロー定義を読み込み、Bob の Workflow UI に登録するための VS Code 拡張機能です。`.bob/workflows/*/WORKFLOW.md` を対象に、ワークフローの作成、検証、実行、再開、診断、AI 補助、GUI Builder を提供します。

この README では、コマンド名、設定キー、JSON / YAML のフィールド名、ファイル名、識別子は実装上の名称として原文のまま記載します。

## できること

- `.bob/workflows/*/WORKFLOW.md` を Bob ワークフローとして登録する。
- `schemaVersion: workflow-register/v1` のワークフロー定義を検証する。
- テンプレートまたは GUI Builder から新しいワークフローを作成する。
- 手動ステップ、コマンドステップ、エージェントステップ、結果ステップを順番に実行する。
- ステップの結果を workflow state に保存し、後続ステップへ渡す。
- 実行状態を `.bob/workflows/runs/<runId>/run.json` に保存し、診断、再開、再試行を行う。
- Bob UI 実行中の task snapshot を保存し、handoff 失敗時の調査や assistant 出力復旧候補に使う。
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
2. Command Palette で `Bob ワークフロー: テンプレートから作成` または `Bob ワークフロー: GUI で作成` を実行する。
3. 生成された `.bob/workflows/<name>/WORKFLOW.md` を編集する。
4. `Bob ワークフロー: 現在の定義を検証` で検証する。
5. `Bob ワークフロー: ファイルを再読み込み` で再読み込みする。
6. Bob の Workflow UI または `Bob ワークフロー: 実行` から実行する。

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
| `inputs` | 実行前入力。`string` / `number` / `boolean` / `select` を指定できる。`prompt: true` で実行時入力を促せる。 |
| `requires` | ワークスペース、Bob 最小バージョン、必須ファイルなどの実行条件。 |
| `preflight` | 実行前チェック。 |
| `guardrails` | 許可コマンド、禁止コマンド、承認メッセージ。 |
| `stepExecution` | Bob UI で full / Todo / engine `steps[]` のどれを visible step として表示するか、singleStep の順序制約を制御する。 |
| `stepReview` | 各 step 後のレビュー停止、承認、再試行、attempt 保存を制御する。 |
| `artifacts` | 生成成果物の宣言。 |
| `completion` | 完了時の要約、成果物表示、結果検証。 |
| `steps` | 実行ステップ本体。新規ワークフローではこの形式を推奨する。 |

## ステップの種類

| `type` | 用途 |
| --- | --- |
| `agent` | Bob / agent にプロンプトを送って処理させる。 |
| `command` | VS Code コマンドやアクションプロバイダーを実行する。 |
| `manual` | 人間が確認して完了させる。 |
| `result` | state や固定値から結果を作り、ファイルまたはコマンドの出力先へ渡す。 |

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

手動ステップを進めるには、`現在のワークフローステップを完了` または `Bob ワークフロー: 現在のステップを完了` を実行します。

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

## stepExecution

`stepExecution` は Bob UI に表示する step 粒度と singleStep の順序制約を制御します。

```yaml
stepExecution:
  mode: engineSteps
  allowOutOfOrder: false
  showInBob: true
```

| フィールド | 説明 |
| --- | --- |
| `mode` | `full` は単一 Bob step、`todo` は Todo ごとの Bob step、`engineSteps` は `steps[]` ごとの Bob step を表示する。 |
| `allowOutOfOrder` | `false` の場合、前 step が `completed` になるまで後続 step の singleStep 実行を拒否する。既定値は `false`。 |
| `showInBob` | `false` の場合、Bob UI では単一 Bob step 表示に戻す。既定値は `true`。 |

## stepReview

`stepReview` を使うと、step 結果を人間が確認してから次へ進められます。成功した step は `completed` ではなく `reviewing` で停止し、`Bob ワークフロー: 現在のステップ結果を承認` 後に `completed` になります。

```yaml
stepReview:
  enabled: true
  pauseAfter: agentAndCommand
  requireAcceptBeforeNext: true
  allowRetry: true
  allowEditBeforeRetry: true
  preserveAttempts: true
```

| フィールド | 説明 |
| --- | --- |
| `enabled` | step review を有効化する。 |
| `pauseAfter` | `everyStep` / `agentAndCommand` / `none`。どの step 後に停止するか。 |
| `requireAcceptBeforeNext` | 次 step 実行前に承認を要求する。 |
| `allowRetry` | current step の再試行を許可する。 |
| `allowEditBeforeRetry` | workflow 定義変更後の retry を許可する。 |
| `preserveAttempts` | retry 前の step attempt を保存する。 |

## 検証

| コマンド | 用途 |
| --- | --- |
| `Bob ワークフロー: 現在の定義を検証` | 開いている `WORKFLOW.md` だけを検証する。 |
| `Bob ワークフロー: ワークスペース定義を検証` | ワークスペース内のワークフローをまとめて検証する。 |

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
| `Bob ワークフロー: ファイルを再読み込み` | ワークフローファイルを再読み込みして Bob に登録する。 |
| `Bob ワークフロー: 登録状態を確認` | 登録状況と診断を Markdown で確認する。 |
| `Bob ワークフロー: 実行` | ワークフローを選択して実行する。 |
| `Bob ワークフロー: ステップを実行` | ワークフローと step を選択して `singleStep` 実行する。 |
| `Bob ワークフロー: 実行履歴を確認` | 実行状態を確認する。 |
| `Bob ワークフロー: 実行を再開` | 中断または保持された実行を再開する。 |
| `Bob ワークフロー: 現在のステップを再試行` | 現在のステップを再試行する。 |
| `Bob ワークフロー: 現在のステップ結果を承認` | step review 中の現在ステップを承認する。 |
| `Bob ワークフロー: 次のステップを実行` | `reviewing` でない run の次の pending step を1つだけ実行する。 |
| `Bob ワークフロー: 承認して次のステップを実行` | current step を承認して次 step を実行する。 |
| `Bob ワークフロー: 現在のステップ状態を確認` | current step の状態を表示する。 |
| `Bob ワークフロー: 現在のステップをGUIで編集` | current step の定義を GUI Builder で開く。 |
| `Bob ワークフロー: 診断を確認` | run state と task snapshot の診断を確認する。 |
| `Bob ワークフロー: 実行中ステップを確認` | 手動完了待ち active step を確認する。 |
| `Bob ワークフロー: 現在のステップを完了` | 現在の手動ステップを完了する。 |

実行状態は、ワークスペース内の `.bob/workflows/runs/<runId>/run.json` に保存されます。

## AI 補助

| コマンド | 用途 |
| --- | --- |
| `Bob ワークフロー: AI で新規設計` | 目的とテンプレート候補から新しい `WORKFLOW.md` を作る。 |
| `Bob ワークフロー: AI で改善` | 開いているワークフローの検証結果をもとに修正案を作る。 |
| `Bob ワークフロー: 診断を AI で説明` | 診断結果を説明する。 |

AI プロバイダーは `workflowRegister.aiProviderCommand` で指定します。未設定時は mock provider が使われます。

`AI で改善` は候補 Markdown を preview し、`.bob/workflows/.previews/...` に保存し、diff を表示します。明示確認後に backup を作成して適用します。

## 拡張ポイント

別拡張は `workflow-register` の API を使って処理を差し込めます。

| API | 用途 |
| --- | --- |
| `registerActionProvider(provider)` | `command` ステップで使うアクションプロバイダーを追加する。 |
| `registerAgentProvider(provider)` | standalone engine 用のエージェントプロバイダーを追加する。 |
| `registerResultSink(type, handler)` | `result` ステップの出力先を追加する。 |
| `listWorkflows()` | 読み込み済みワークフロー定義を取得する。 |
| `runWorkflow(workflowId, inputs)` | ワークフローをプログラムから standalone 実行する。 |

## 現在の実装分割

リファクタリング後の主な実装ファイルは次の通りです。

| ファイル | 責務 |
| --- | --- |
| `src/extension.ts` | core activation、Bob source 登録、公開 API、standalone 実行 command。 |
| `src/extensionWithAuthoring.ts` | core activation に検証、AI 補助、GUI Builder command を追加する entry。 |
| `src/bobApi.ts` | Bob 拡張 API の取得と source-like object への安全な変換。 |
| `src/reports.ts` | attempt 実行、戻り値整形、Markdown report 表示 helper。 |
| `src/bobWorkflowRunner.ts` | Bob task と `WorkflowEngine` を接続する adapter。`BobWorkflowEngineRunner` と現時点の `StepRuntime` を保持する。 |
| `src/bobWorkflowFactory.ts` | Bob workflow object と Bob step array の構築。 |
| `src/bobWorkflowMessages.ts` | workflow 開始、step 継続、command result、workflow state を Bob chat へ送る message 生成。 |
| `src/bobTaskInputs.ts` | Bob task metadata / message から workflow input を抽出する。 |
| `src/taskSnapshotRecovery.ts` | task snapshot から `lastAssistantText` を復旧候補として取得する。 |
| `src/resultHandoff.ts` | assistant 出力を file / command sink へ渡す。 |

今後の分割候補は `StepRuntime` です。VS Code UI、result handoff、guardrail、active step state に触るため、純粋 helper ではなく Bob UI 実行専用 runtime として扱います。

## 設定

| 設定 | 既定値 | 説明 |
| --- | --- | --- |
| `workflowRegister.sourceId` | `workflow-register` | Bob に登録する source ID。 |
| `workflowRegister.sourceName` | `ワークフロー登録` | Bob に表示する source 名。 |
| `workflowRegister.agentCommand` | 空 | standalone engine のエージェントステップを実行する VS Code コマンド。 |
| `workflowRegister.aiProviderCommand` | 空 | AI 設計、改善、診断説明に使う VS Code コマンド。 |
| `workflowRegister.taskSnapshots.enabled` | `true` | Bob UI 実行時に task snapshot を保存する。 |
| `workflowRegister.taskSnapshots.maxBytes` | `262144` | 1 snapshot JSON の最大サイズ。 |
| `workflowRegister.taskSnapshots.maxPerRun` | `50` | 1 run に保持する snapshot 数。 |
| `workflowRegister.taskSnapshots.includeMessages` | `true` | snapshot に Bob chat messages を含める。 |
| `workflowRegister.taskSnapshots.pruneOnSave` | `true` | snapshot 保存時に古い snapshot を削除する。 |

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
| 手動ステップが進まない | `現在のワークフローステップを完了` または `Bob ワークフロー: 現在のステップを完了` を実行する。 |

## 関連ドキュメント

- `docs/basic-design-ja.md`
- `docs/detailed-design-ja.md`
- `docs/workflow-authoring-guide-ja.md`
- `docs/bob-task-export-recovery-plan-ja.md`
- `extensions/bob-bazaar-review/README.md`
- `extensions/bob-code-consistency-review/README.md`
- `extensions/README.md`
