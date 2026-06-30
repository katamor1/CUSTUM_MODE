# Bob タスクエクスポートを使った中断復旧補助計画

## 実装状況

この計画は `WorkflowEngine` 統一後の実装に反映済みである。

- Bob UI 経由の Todo step は `WorkflowEngine.runWorkflow(..., { executionMode: "singleStep" })` で実行する。
- command palette 経由は従来どおり `WorkflowEngine` の full 実行を使う。
- `run.json` は両経路で共通の正本であり、Bob UI 側の `StepRuntime` は手動完了待ちだけを保持する。
- Bob task snapshot は `TaskSnapshotProvider` / `FileTaskSnapshotStore` で保存する。
- `workflowRegister.inspectRunDiagnostics` は snapshot summary と `run.json` の不整合を表示する。

## 目的

`workflow-register` の中断復旧では、`.bob/workflows/runs/<runId>/run.json` を実行状態の正本として扱う。

この文書では、Bob の現在タスクのエクスポート機能を、`run.json` だけでは復元できない Bob チャット側の文脈を補うための補助証跡として利用する計画を定義する。

## 背景

`run.json` には、ワークフロー再開に必要な構造化状態を保存する。

- `runId`
- `workflowId`
- `workflowDefinitionHash`
- `inputs`
- `state`
- `currentStep`
- `steps`
- `status`
- `error`

一方で、Bob のタスク実行中には、次のような情報が Bob タスク側に残る。

- チャットメッセージ履歴
- 直近の assistant 出力
- message metadata
- Bob UI の Todo / Step 表示状態
- handoff 前後の会話上の成果物

これらは `run.json` の正規化済み状態とは性質が異なるため、`run.json` に直接混ぜ込まず、別ファイルとして保存する。

## 基本方針

### 正本と補助証跡を分離する

| 種類 | 保存先 | 役割 |
| --- | --- | --- |
| 正本 | `.bob/workflows/runs/<runId>/run.json` | 再開判定、入力、状態、現在ステップ、ステップ状態を保持する。 |
| 補助証跡 | `.bob/workflows/runs/<runId>/task-snapshots/*.json` | Bob チャット側の文脈、直近 assistant 出力、metadata、診断情報を保持する。 |

Bob タスクエクスポートは、`run.json` の代替ではなく、次の目的に限定して使う。

1. result handoff 失敗時の再抽出
2. 中断前後の診断
3. `runId` / `currentStep` の照合
4. Bob チャット側にしか残っていない assistant 出力の救済

## 非目的

次は実施しない。

- Bob のタスクオブジェクトそのものを復元する。
- 中断前の JavaScript Promise / callback / `resolve` を復元する。
- Bob タスクエクスポートを `run.json` より優先する。
- チャット全文を常に後続ステップの入力として使う。

Bob の `task` オブジェクトや `activeSteps` の `resolve` はシリアライズできないため、復旧は「同じ入力で再実行されたときに保存済み状態へ寄せる」方式とする。

## 保存タイミング

最初の実装では、次のタイミングで snapshot を保存する。

| タイミング | 保存目的 |
| --- | --- |
| workflow 開始時 | Bob task と `runId` の紐付けを残す。 |
| step 開始時 | `currentStep` と Bob task 側の状態を残す。 |
| agent 出力直後 | assistant 出力を handoff 前に退避する。 |
| result handoff 失敗時 | 再試行用に最後の assistant 出力とエラーを残す。 |
| manual / held 移行時 | 人間操作待ちの状態を診断できるようにする。 |
| failed 移行時 | 失敗原因と Bob 側文脈を同時に残す。 |

## 保存先

run 単位の snapshot ディレクトリを作る。

```text
.bob/workflows/runs/<runId>/task-snapshots/
```

ファイル名は、時系列と用途が分かる形にする。

```text
<timestamp>-workflow-start.json
<timestamp>-<stepId>-start.json
<timestamp>-<stepId>-agent-output.json
<timestamp>-<stepId>-handoff-failed.json
<timestamp>-<stepId>-held.json
<timestamp>-<stepId>-failed.json
latest.json
```

`latest.json` は、最新 snapshot へのコピーまたは要約版とする。

## Snapshot 形式

初期案は次の通り。

```json
{
  "schemaVersion": "workflow-register/task-snapshot/v1",
  "createdAt": "2026-06-30T00:00:00.000Z",
  "reason": "handoff-failed",
  "runId": "20260630T000000Z-review",
  "workflowId": "workflow-register.review",
  "logicalWorkflowId": "review",
  "workflowDefinitionHash": "...",
  "stepId": "capture-output",
  "runStatus": "running",
  "runCurrentStep": "capture-output",
  "taskMetadata": {},
  "messages": [],
  "lastAssistantText": "...",
  "handoff": {
    "resultCommand": "bobReview.captureOutput",
    "error": "..."
  }
}
```

### 必須フィールド

- `schemaVersion`
- `createdAt`
- `reason`
- `runId`
- `workflowId`
- `stepId`

### 推奨フィールド

- `logicalWorkflowId`
- `workflowDefinitionHash`
- `runStatus`
- `runCurrentStep`
- `taskMetadata`
- `messages`
- `lastAssistantText`
- `handoff`

## 実装方針

### 1. 抽象インターフェースを追加する

Bob タスクエクスポート API の実体に依存しすぎないよう、拡張側では抽象化する。

```ts
export interface TaskSnapshotProvider {
  exportTask(input: TaskSnapshotInput): Promise<TaskSnapshotPayload | undefined>
}
```

`BobWorkflowTask` に直接 `exportTask` のような API がある場合でも、直接呼び出しを各所に散らさず、この provider に閉じ込める。

### 2. snapshot store を追加する

```ts
export interface TaskSnapshotStore {
  saveSnapshot(snapshot: TaskSnapshotPayload): Promise<{ path: string }>
  loadLatest(runId: string): Promise<TaskSnapshotPayload | undefined>
}
```

保存処理は `run.json` と同様に atomic write を使う。

### 3. Engine hook / Bob adapter から保存する

Bob 連携側では、`BobWorkflowEngineRunner` が `WorkflowExecutionHooks` を使って保存ポイントを接続する。

| Hook | reason |
| --- | --- |
| `onWorkflowStart` | `workflow-start` |
| `onStepStart` | `step-start` |
| `onAgentOutput` | `agent-output` |
| `onHandoffFailed` | `handoff-failed` |
| `onStepHeld` | `held` |
| `onStepFailed` | `failed` |
| `onStepCompleted` / `onWorkflowCompleted` | `completed` |

手動完了時の `captureHeldStepResult` は、Engine の manual completion controller から登録された `activeSteps` を完了する時に呼ばれる。

### 4. handoff 再試行で利用する

`result handoff` が失敗した場合、再開時には次の順で result text を探す。

1. 現在の Bob task の last assistant text
2. `task-snapshots/latest.json` の `lastAssistantText`
3. 該当 step の `agent-output` snapshot
4. 見つからなければ通常の retry にフォールバック

snapshot は `runId`、`workflowId`、`workflowDefinitionHash`、`stepId` が一致する場合だけ自動復帰に使う。

これにより、AI の回答生成は完了していたが、ファイル保存や capture command の途中で落ちたケースを救済できる。

### 5. 診断表示に統合する

`Inspect Workflow Run Diagnostics` では、`run.json` と snapshot を比較して次を表示する。

- `run.json` の `currentStep`
- snapshot の `stepId`
- `workflowDefinitionHash` の一致 / 不一致
- `inputs` の有無
- `lastAssistantText` の有無
- handoff error の有無
- Bob task metadata の有無

## セキュリティと運用上の注意

Bob タスクエクスポートには、ユーザー入力、レビュー対象、AI 出力、内部メタデータが含まれる可能性がある。

そのため、次を守る。

- snapshot はワークスペース配下にのみ保存する。
- ワークスペース外への書き込みを禁止する。
- snapshot を Git 管理対象にしない運用を推奨する。
- 必要に応じて `.gitignore` に `.bob/workflows/runs/` を追加する。
- 診断表示では全文ではなく要約、サイズ、先頭数行だけを表示できるようにする。
- snapshot の最大サイズを設定で制限できるようにする。

## 段階的実装計画

### Phase 1: 証跡保存のみ

- 完了: `TaskSnapshotProvider` を追加する。
- 完了: `TaskSnapshotStore` を追加する。
- 完了: workflow 開始、step 開始、failed / held 移行時に snapshot を保存する。
- 完了: `latest.json` を保存する。

### Phase 2: handoff 救済

- 完了: agent output 直後に snapshot を保存する。
- 完了: handoff 失敗時に snapshot を保存する。
- 完了: retry / resume 時に snapshot の `lastAssistantText` から handoff を再試行できるようにする。

### Phase 3: 診断統合

- 完了: `Inspect Workflow Run Diagnostics` に snapshot 情報を追加する。
- 完了: `run.json` と snapshot の不整合を警告する。
- 完了: snapshot の `lastAssistantText` / handoff error 有無を表示する。

### Phase 4: 運用制御

- 完了: snapshot 最大サイズを設定化する。
- 完了: 保存有無を設定化する。
- 完了: 古い snapshot の pruning を追加する。

## テスト計画

最低限、次のテストを追加する。

1. workflow 開始時に snapshot が保存される。
2. step 開始時に `stepId` 付き snapshot が保存される。
3. handoff 失敗時に `lastAssistantText` と error が保存される。
4. retry 時に現在 task から assistant 出力が取れない場合、snapshot の `lastAssistantText` を使う。
5. snapshot の `workflowDefinitionHash` が現在定義と異なる場合、自動復旧に使わず警告する。
6. snapshot 保存先がワークスペース外になる場合は拒否する。

## 期待する効果

この計画により、次の中断ケースを扱いやすくする。

- AI 出力後、result handoff 前に中断した。
- Bob チャット側には成果物があるが、`run.json` の `state` には未反映だった。
- 再開時にどの step で止まったか判断しづらい。
- `run.json` と Bob UI の見え方がずれている。
- ユーザーから「かなり前まで巻き戻った」と報告されたとき、原因を追跡したい。

## まとめ

Bob タスクエクスポートは、実行状態の正本ではなく、Bob チャット文脈を保持する補助証跡として使う。

`run.json` を正本、`task-snapshots/*.json` を補助証跡と分離することで、再開処理の堅牢性と障害診断能力を同時に高められる。
