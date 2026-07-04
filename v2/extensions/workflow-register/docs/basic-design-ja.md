# workflow-register 基本設計書

## 1. 目的

`workflow-register` は、VS Code / IBM Bob 環境で `.bob/workflows/*/WORKFLOW.md` に定義されたワークフローを検出し、IBM Bob の Workflow UI へ登録し、Bob UI または Command Palette / 公開 API から実行できるようにする基盤拡張機能である。

個別拡張が持つ前処理、レビュー、結果保存、成果物生成、検証、triage などの処理を、共通の workflow 定義、step 実行、run state、run control、result handoff に接続することを目的とする。

## 2. 背景と課題

Bob 上でレビューや設計作業を定型化する場合、次の課題がある。

- `.bob/workflows` 配下の定義を Bob Workflow UI へ動的に登録したい。
- `command`、`agent`、`manual`、`result` を一連の step として扱いたい。
- Bob UI 上の Todo / visible step と engine `steps[]` を使い分けたい。
- 実行状態を壊れにくく保存し、再起動や中断後に再利用したい。
- AI 出力後に保存や検証だけ失敗した場合、Bob chat 側の出力を救済したい。
- 長い workflow を checkpoint で中断し、後で再開したい。
- Explorer view / Status Bar で run 状態を確認したい。
- GUI Builder、AI 補助、Diagnostics、Help を標準機能として運用したい。
- 他拡張が action provider / agent provider / result sink を後付けできるようにしたい。

## 3. スコープ

### 3.1 対象範囲

- `.bob/workflows/*/WORKFLOW.md` の探索、解析、検証、登録。
- `schemaVersion: workflow-register/v1` と legacy workflow の読み込み。
- IBM Bob Workflow UI への source / workflow 登録。
- Bob UI からの full 実行、Todo 単位の `singleStep` 実行、engine step 単位の実行。
- Command Palette / 公開 API からの standalone 実行。
- `command` / `agent` / `manual` / `result` step の実行。
- `stepReview` によるレビュー停止、承認、再試行、attempt 保存。
- `run.json` による run state 保存と recoverable run 再利用。
- `control.json` による pause request 保存、checkpoint 停止、paused run 再開。
- task snapshot による Bob chat 文脈、metadata、last assistant text の補助保存。
- `resumeRun` / `retryCurrentStep` / `runNextStep` / `acceptAndRunNextStep` による再開・段階実行。
- result handoff、file / command result sink、artifact 出力。
- Workflow Diagnostics、Run Diagnostics、Active Step 表示、Run Control 表示。
- Explorer view `workflowRegister.runs` と Status Bar による run 監視。
- テンプレート作成、AI 設計、AI 改善、診断説明。
- Webview GUI Builder による新規作成と既存 v1 workflow 編集。

### 3.2 対象外

- IBM Bob 本体の UI 実装。
- 個別業務処理そのものの実装。
- OS コマンドの自由実行。
- workspace root 外への成果物保存。
- 複数ユーザー間の run state 同期。
- Bob task object、Promise、callback の永続化。
- legacy workflow の GUI 編集。

## 4. 利用者と利用シーン

| 利用者 | 主な用途 |
| --- | --- |
| 開発者 | `.bob/workflows` に workflow を定義し、Bob UI または Command Palette から実行する。 |
| レビュー担当者 | Bob Workflow UI の Todo / Step を進め、step review で結果を承認・再試行する。 |
| 拡張機能開発者 | action provider、agent provider、result sink を登録する。 |
| ワークフロー設計者 | テンプレート、GUI Builder、AI 補助を使って `WORKFLOW.md` を作成・改善する。 |
| 保守担当者 | run state、run control、task snapshot、diagnostics、Explorer view を確認する。 |

## 5. 全体構成

```text
VS Code Extension Host
  └─ extensionWithAuthoring
       ├─ WorkflowRegisterService
       │    ├─ Parser / Schema / Validator
       │    ├─ BobWorkflowFactory
       │    ├─ BobWorkflowEngineRunner
       │    └─ WorkflowEngine
       │         ├─ ActionRegistry
       │         ├─ AgentProvider
       │         ├─ ResultSinkRegistry
       │         ├─ FileRunStateStore      -> .bob/workflows/runs/<runId>/run.json
       │         ├─ FileRunControlStore    -> .bob/workflows/runs/<runId>/control.json
       │         └─ FileTaskSnapshotStore  -> .bob/workflows/runs/<runId>/task-snapshots/
       ├─ WorkflowRunControlView
       ├─ Workflow Builder Webview
       ├─ Diagnostics commands
       └─ AI authoring commands
```

## 6. 主要コンポーネント

| コンポーネント | 主な責務 | 主なファイル |
| --- | --- | --- |
| Extension Entry | VS Code command 登録、Bob 連携、公開 API | `src/extension.ts` |
| Authoring Entry | core activation に検証、AI 補助、GUI Builder、Run Control View を追加 | `src/extensionWithAuthoring.ts` |
| WorkflowRegisterService | workflow 探索、Bob source 登録、run 操作、provider 管理 | `src/extension.ts` |
| Bob API helper | Bob 拡張の取得、activation error 記録、source-like 変換 | `src/bobApi.ts` |
| Report helper | attempt 実行、戻り値説明、Markdown report 表示 | `src/reports.ts` |
| BobWorkflowFactory | Bob workflow object / visible step array の構築 | `src/bobWorkflowFactory.ts` |
| BobWorkflowEngineRunner | Bob task を `WorkflowEngine` へ接続する UI 実行 adapter | `src/bobWorkflowRunner.ts` |
| BobWorkflowMessages | workflow 開始、step 継続、command result、state block の message 生成 | `src/bobWorkflowMessages.ts`, `src/workflowPromptContext.ts` |
| BobTaskInputs | Bob task metadata / message から workflow input を抽出 | `src/bobTaskInputs.ts` |
| StepRuntime | Bob UI の manual step 完了待ちをメモリ上で保持 | `src/bobWorkflowRunner.ts` |
| WorkflowEngine | full / singleStep / resume / retry / stepReview / pause を実行 | `src/core/engine.ts`, `src/core/engine/*`, `src/core/engineTypes.ts` |
| Run State Store | `run.json` の作成、保存、一覧、recoverable run 探索 | `src/core/runStateStore.ts` |
| Run Control Store | pause request、clear、resume note を `control.json` に保存 | `src/core/runControlStore.ts`, `src/core/engine/runPause.ts` |
| Run Control Commands | pause / resume / inspect の command 処理 | `src/commands/runControl.ts` |
| Run Control View | Explorer view と Status Bar に run 状態を表示 | `src/commands/runControlView.ts` |
| Task Snapshot | Bob task snapshot 保存、latest、pruning、復帰候補取得 | `src/core/taskSnapshots.ts`, `src/taskSnapshotRecovery.ts` |
| Parser / Validator | `WORKFLOW.md` の解析、schema validation、参照検証 | `src/core/parser.ts`, `src/core/parser/*`, `src/core/workflowSchema.ts`, `src/core/workflowValidator.ts` |
| Action / Agent / Sink | command step、agent step、result / artifact 出力 | `src/core/actionRegistry.ts`, `src/core/agentProvider.ts`, `src/core/resultSinkRegistry.ts` |
| Result Handoff | Bob assistant 出力を command sink へ渡す | `src/resultHandoff.ts` |
| Workspace Roots | `.bob` root と workspace root の解決 | `src/core/workspaceRoots.ts` |
| GUI Builder | Webview 作成、preview、diff、backup、save | `src/webview/*`, `src/core/workflowAuthoring*.ts` |
| AI Authoring | workflow 設計、改善、diagnostics 説明 | `src/commands/*Ai.ts`, `src/core/workflowAiProviderFactory.ts` |
| Diagnostics | workflow / run diagnostics の Markdown 表示と VS Code Diagnostics | `src/commands/*Diagnostics.ts`, `src/commands/validateWorkflow.ts` |

## 7. ワークフロー定義モデル

workflow は `WORKFLOW.md` の YAML front matter と Markdown body で定義する。新規定義では `schemaVersion: workflow-register/v1` を推奨する。

主な要素は、`name`、`description`、`title` / `label` / `menuLabel`、`mode`、`workspaceRequired`、`inputs`、`requires`、`preflight`、`guardrails`、`stepExecution`、`stepReview`、`branching`、`artifacts`、`completion`、`steps`、Markdown body である。

step 種別は次の4種類である。

| 種別 | 説明 |
| --- | --- |
| `command` | action provider を呼び出す。戻り値は `resultKey` に保存できる。 |
| `agent` | agent provider または Bob task の subagent へ prompt を渡す。 |
| `manual` | 人間の確認完了を待つ。 |
| `result` | state / literal / agent 結果を result sink に渡す。 |

`includeState` は前段 step の `resultKey`、manual `form.resultKey`、manual `approval.resultKey` を参照する。GUI Builder では参照切れ、前方参照、`artifact.producedBy` の不整合を即時警告する。

`branching` は step 成功後の決定的な遷移制御を定義する。各 step の `transition.decisions[]` は `run.state` の値を安全な比較条件で評価し、`next`、`end`、`fail`、または他 step への `goto` を選ぶ。過去 step への `goto` には `branching.loops[]` の `loop` 指定を必須とし、loop 回数が上限に達した場合は run を `checkpoint` にして専用 command でのみ続行または中止できる。

## 8. 実行方式

| 実行方式 | Bob task | 主な用途 |
| --- | --- | --- |
| Bob UI full | あり | Bob UI から workflow 全体を一括実行する。 |
| Bob UI singleStep | あり | Todo または engine step を Bob visible step として1つずつ実行する。 |
| Standalone full / singleStep | なし | Command Palette または公開 API から実行する。 |

Bob UI 実行では、`BobWorkflowEngineRunner` が task metadata / messages から input 候補を抽出し、`task.startSubagent()`、`task.sendMessage()`、`task.setStepComplete()`、task snapshot、manual completion を扱う。Standalone 実行では Bob task を使わず、VS Code UI、registered provider、設定値を使う。

`stepReview` が有効な場合、対象 step 成功後に run は `reviewing` で停止する。人間は `acceptCurrentStep`、`retryCurrentStep`、`acceptAndRunNextStep` を使い、承認・再試行・次 step 実行を選ぶ。

`transition` が有効な step では、step 完了後に engine が分岐を評価する。full 実行では checkpoint に達しない限り戻り先 step から続行し、singleStep 実行では `currentStep` を戻り先に設定して次操作を待つ。Bob UI の visible step は静的なため、過去 step への戻りは `run.json` を正本とし、chat / run view / diagnostics で現在位置を明示する。

## 9. 実行状態、再開、run control

### 9.1 run state

実行状態の正本は次である。

```text
<workflowRoot>/.bob/workflows/runs/<runId>/run.json
```

`run.json` は run ID、workflow ID / name / schema version / definition hash / workflow file、engine version、inputs、state、steps、current step、status、error、created / updated timestamp を保持する。分岐実行時は `branching.loops`、pending checkpoint、transition history も保持し、reset された step attempt と古い state の cleanup を追跡できるようにする。

### 9.2 run control

pause request は次に保存する。

```text
<workflowRoot>/.bob/workflows/runs/<runId>/control.json
```

`control.json` は `schemaVersion: workflow-register/run-control/v1`、`runId`、`pauseRequestedAt`、`pauseReason`、`requestedBy`、`mode`、`clearedAt`、`resumeNote` を保持する。`WorkflowEngine` は `before-preflight`、`before-step:<stepId>`、`after-step:<stepId>` などの checkpoint で pause request を確認し、検出時に run を `paused` にする。

| 操作 | 説明 |
| --- | --- |
| `pauseCurrentRun` / `pauseAfterCurrentStep` | `mode: afterCurrentStep` の pause request を保存する。 |
| `pauseBeforeNextAiCall` | `mode: beforeNextAiCall` の pause request を保存する。現行 engine では checkpoint 停止情報として扱う。 |
| `resumePausedRun` | pause request を clear し、`resumeRun` を呼び出す。 |
| `inspectRunControl` | run status、current step、control fields、`workflow.pause` state を表示する。 |

### 9.3 task snapshot

Bob task 側の chat 文脈は補助証跡として次に保存する。

```text
<workflowRoot>/.bob/workflows/runs/<runId>/task-snapshots/*.json
<workflowRoot>/.bob/workflows/runs/<runId>/task-snapshots/latest.json
```

snapshot は `run.json` の代替ではなく、`lastAssistantText` の救済、handoff 失敗調査、run と Bob UI の不整合診断に使う。

## 10. GUI Builder / AI 補助 / Diagnostics

GUI Builder は template からの新規作成、既存 `workflow-register/v1` の編集、参照関係 warning、Preview、Diagnostics、Diff、backup 後 save を扱う。

AI 補助は `workflowRegister.designWorkflowWithAi`、`workflowRegister.improveWorkflowWithAi`、`workflowRegister.explainWorkflowDiagnostics` で提供する。

Diagnostics は `WORKFLOW.md` 保存時、active editor 切替時、検証 command、GUI preview / save 時に実行する。Run Diagnostics は `run.json` と task snapshot summary を読み、hash mismatch、step mismatch、handoff error、truncated 状態などを表示する。

## 11. 他拡張との連携

activation return value として次の API を公開する。

| API | 用途 |
| --- | --- |
| `registerActionProvider(provider)` | `command` step の provider を追加する。 |
| `registerAgentProvider(provider)` | standalone engine または Bob adapter の fallback agent 実行を差し替える。 |
| `registerResultSink(type, handler)` | `result.sinks[].type` で参照できる sink を追加する。 |
| `listWorkflows()` | 読み込み済み workflow 定義を取得する。 |
| `runWorkflow(workflowId, inputs)` | workflow を standalone 実行する。 |
| `runWorkflowStep(workflowId, stepId, inputs)` | workflow step を `singleStep` で実行する。 |
| `runNextStep(runId)` | 保存済み run の次の pending step を1つ実行する。 |

## 12. 運用 command

主な command は次のとおりである。

- `workflowRegister.reload`
- `workflowRegister.inspect`
- `workflowRegister.runWorkflow`
- `workflowRegister.runWorkflowStep`
- `workflowRegister.inspectRuns`
- `workflowRegister.resumeRun`
- `workflowRegister.retryCurrentStep`
- `workflowRegister.acceptCurrentStep`
- `workflowRegister.runNextStep`
- `workflowRegister.acceptAndRunNextStep`
- `workflowRegister.inspectCurrentStep`
- `workflowRegister.pauseCurrentRun`
- `workflowRegister.pauseAfterCurrentStep`
- `workflowRegister.pauseBeforeNextAiCall`
- `workflowRegister.resumePausedRun`
- `workflowRegister.inspectRunControl`
- `workflowRegister.refreshRunsView`
- `workflowRegister.openCurrentStepInBuilder`
- `workflowRegister.inspectRunDiagnostics`
- `workflowRegister.inspectActiveSteps`
- `workflowRegister.completeCurrentStep`
- `workflowRegister.completeStep`
- `workflowRegister.validateCurrentWorkflow`
- `workflowRegister.validateWorkspaceWorkflows`
- `workflowRegister.createWorkflowFromTemplate`
- `workflowRegister.openWorkflowBuilder`
- `workflowRegister.editWorkflowInBuilder`
- `workflowRegister.designWorkflowWithAi`
- `workflowRegister.improveWorkflowWithAi`
- `workflowRegister.explainWorkflowDiagnostics`

`workflowRegister.runs` view は Explorer に表示され、running / paused / reviewing / held / failed / completed の icon と context value を持つ。Status Bar は active run 数を `running / paused / reviewing / held` 別に表示する。

## 13. セキュリティとエラー処理方針

- command step は action provider 経由で実行する。
- guardrails により許可・禁止 command を検査する。
- `file` result sink は workspace root 外への書き込みを拒否する。
- task snapshot と run control は workspace root 配下の run directory に保存する。
- Bob task object、Promise、callback は保存しない。
- workflow parse 失敗は登録対象から除外し、diagnostics に出す。
- preflight error、provider 未登録、result sink 失敗は run / step を `failed` にする。
- manual step は `held`、step review は `reviewing`、pause request 検出時は `paused` として保存する。
- completed / failed run への pause request は command 側で拒否する。

## 14. テスト方針

- parser の v1 / legacy 解析を検証する。
- schema validation と workflowValidator の参照検証を検証する。
- workflow engine の full / singleStep / resume / retry / stepReview を検証する。
- run control の request / clear / paused 遷移 / resume を検証する。
- task snapshot の保存、latest、pruning、診断表示、復帰候補利用を検証する。
- result handoff の assistant 成果物渡しを検証する。
- Bob workflow factory / messages / task input helper を検証する。
- GUI authoring serializer / loader / reference analysis を検証する。
- Run Control View の item 表示、context value、Status Bar 集計を検証する。
- 実機では VS Code / IBM Bob / multi-root workspace / Bob UI step 実行 / Webview / Status Bar の結合動作を確認する。

詳細な単体テスト仕様は `unit-test-spec-ja.md`、実機テスト仕様は `real-machine-test-spec-ja.md` に定義する。

## 15. 今後の拡張方針

- `StepRuntime` の `src/bobStepRuntime.ts` への分離。
- run control の `beforeNextAiCall` を AI step / subagent 呼び出し直前 checkpoint として精緻化する。
- active step の再接続 UI。
- result handoff の再試行 UI 強化。
- task snapshot から artifact 候補を選ぶ UI。
- action provider / result sink の権限モデル拡張。
