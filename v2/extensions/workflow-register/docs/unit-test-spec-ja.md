# workflow-register 単体テスト仕様書

## 1. 目的

本書は `extensions/workflow-register` の単体テスト仕様を定義する。対象は現行 TypeScript 実装の parser、validator、engine、run state、run control、task snapshot、result handoff、Bob adapter helper、authoring helper、Template Customization Studio helper である。

## 2. テスト実行方式

| 項目 | 内容 |
| --- | --- |
| 実行コマンド | `npm run compile && node --test test/*.test.js` |
| 対象成果物 | `out/` 配下へ compile された JavaScript |
| テストランナー | Node.js built-in test runner |
| 外部依存 | VS Code API と Bob API は mock / stub 化する |
| ファイル I/O | `fs.mkdtemp()` で一時 workspace を作成し、`.bob` 配下を検証する |

## 3. 共通テストデータ

| データ | 内容 |
| --- | --- |
| `workflowMinimalV1` | `schemaVersion: workflow-register/v1`、1 command step、required input なし。 |
| `workflowWithAgentResult` | agent step が `resultKey` を作成し、result sink へ渡す。 |
| `workflowWithManualStep` | manual step を含み、`manualCompletion` の有無で held / completed を分岐する。 |
| `workflowWithStepReview` | `stepReview.pauseAfter` と `allowRetry` を有効化する。 |
| `workflowWithPause` | 2 step 以上を持ち、checkpoint pause を検証する。 |
| `mockActionRegistry` | action ID ごとに success / error / structured error を返す。 |
| `mockAgentProvider` | fixed text、error、empty result を返す。 |
| `mockResultSinkRegistry` | file / command sink 呼び出しを記録する。 |
| `templateStudioModel` | 標準テンプレート、project profile、customization、UAT evidence path を持つ Studio model。 |

## 4. テスト項目

### WR-UT-001 Parser: v1 workflow を解析できる

- 入力: `workflowMinimalV1` の Markdown text。
- 期待結果: `CoreWorkflowDefinition` が返り、`engineSteps`、`inputs`、`workflowFile`、`workflowRoot` が正規化される。

### WR-UT-002 Parser: legacy workflow を互換解析できる

- 入力: `schemaVersion` を持たない legacy Markdown。
- 期待結果: legacy parser が呼ばれ、diagnostics error なしで workflow が生成される。

### WR-UT-003 Schema: 必須 field 不足を diagnostics 化する

- 入力: `name` または `description` が無い v1 workflow。
- 期待結果: parse result は失敗し、schema error が diagnostics に含まれる。

### WR-UT-004 Validator: step ID 重複を検出する

- 入力: 同じ `id` の step を2つ持つ workflow。
- 期待結果: `workflowValidator` が error を返す。

### WR-UT-005 Validator: state 前方参照を検出する

- 入力: 前の step で生成されない `includeState` / `stateKey` を参照する workflow。
- 期待結果: 参照不正が error になる。

### WR-UT-006 Validator: guardrails の allowed / denied 衝突を検出する

- 入力: 同じ command を `allowedCommands` と `deniedCommands` の両方に含む workflow。
- 期待結果: guardrail 衝突 error が返る。

### WR-UT-007 Engine: full 実行で全 step を完了できる

- 入力: command step 2件、成功 action provider。
- 期待結果: run status は `completed`、全 step status は `completed`、state に resultKey が保存される。

### WR-UT-008 Engine: singleStep 実行で run を running のまま残す

- 入力: 2 step workflow、`executionMode: "singleStep"`、先頭 step ID。
- 期待結果: 先頭 step は `completed`、run status は `running`、次 step は `pending`。

### WR-UT-009 Engine: allowOutOfOrder=false で前 step 未完了を拒否する

- 入力: 2 step workflow、2 step 目を直接 `singleStep` 実行。
- 期待結果: run status は `failed`、error に previous step block が含まれる。

### WR-UT-010 Engine: manual step は completion provider なしで held になる

- 入力: manual step、`manualCompletion` 未指定。
- 期待結果: step status と run status は `held`。

### WR-UT-011 Engine: stepReview で reviewing に停止する

- 入力: `stepReview.pauseAfter: everyStep` の workflow。
- 期待結果: step 成功後に step status と run status が `reviewing` になる。

### WR-UT-012 Engine: retryCurrentStep は attempt を保存して再実行する

- 入力: reviewing run、`allowRetry: true`。
- 期待結果: 既存 attempt が `attempts[]` に保存され、current step が再実行される。

### WR-UT-013 Engine: preflight error は run を failed にする

- 入力: failed preflight を返す workflow。
- 期待結果: run status は `failed`、error に preflight failure が含まれる。

### WR-UT-014 RunStateStore: run.json を atomic save / load できる

- 入力: 一時 workspace、run state。
- 期待結果: `.bob/workflows/runs/<runId>/run.json` が作成され、load 結果が一致する。

### WR-UT-015 RunStateStore: recoverable run を一致条件で取得する

- 入力: workflow ID、definition hash、workflow file、inputs が一致する running run。
- 期待結果: `findRecoverableRun()` が対象 run を返す。不一致の場合は返さない。

### WR-UT-016 RunControlStore: pause request を保存・clear できる

- 入力: run ID、`mode: afterCurrentStep`。
- 期待結果: `control.json` に `pauseRequestedAt` と `mode` が保存され、`clearPause()` 後は `clearedAt` が保存される。

### WR-UT-017 RunControlStore: invalid schemaVersion は undefined として扱う

- 入力: `schemaVersion` が異なる `control.json`。
- 期待結果: `loadControl()` は undefined を返す。

### WR-UT-018 Engine Pause: checkpoint で paused に遷移する

- 入力: active pause request を持つ run。
- 期待結果: `pauseRunIfRequested()` が true を返し、run status は `paused`、`workflow.pause` state が保存され、`onRunPaused` hook が呼ばれる。

### WR-UT-019 Resume: paused run は control clear 後に再開する

- 入力: `paused` run と active `control.json`。
- 期待結果: `resumeRun()` により pause request が clear され、run は次 step から継続する。

### WR-UT-020 RunControl command: completed / failed run の pause を拒否する

- 入力: completed または failed run selection。
- 期待結果: warning message を表示し、`control.json` を新規作成しない。

### WR-UT-021 RunControl command: inspect report に control と workflow.pause を出力する

- 入力: `control.json` と `run.state["workflow.pause"]` を持つ run。
- 期待結果: Markdown report に pauseRequestedAt、pauseReason、mode、clearedAt、workflow.pause が含まれる。

### WR-UT-022 RunControlView: TreeItem の表示を status ごとに作る

- 入力: running / paused / reviewing / held / failed / completed の run。
- 期待結果: description、tooltip、icon、contextValue が status に一致する。

### WR-UT-023 RunControlView: Status Bar は active run を集計する

- 入力: running / paused / reviewing / held / completed が混在する run list。
- 期待結果: Status Bar text に running / paused / reviewing / held の件数が反映される。

### WR-UT-024 TaskSnapshots: latest と pruning を保存する

- 入力: maxPerRun を超える snapshot 保存。
- 期待結果: `latest.json` が更新され、古い snapshot が prune される。

### WR-UT-025 TaskSnapshotRecovery: last assistant text を復旧する

- 入力: `latest.json` または `agent-output` snapshot。
- 期待結果: workflow ID、run ID、step ID、definition hash が一致する場合だけ text を返す。

### WR-UT-026 ResultHandoff: assistant text を互換 args と明示 field に渡す

- 入力: assistant output text。
- 期待結果: `args[0]`、`latestAssistantText`、`resultText`、`artifactText` に同じ trim 済み text が入る。

### WR-UT-027 ResultSink file: workspace 外 path を拒否する

- 入力: `../outside.md` など workspace 外へ逃げる path。
- 期待結果: sink error になり、ファイルは作成されない。

### WR-UT-028 BobTaskInputs: metadata / message から input を抽出する

- 入力: Bob task metadata、user message、既定 input。
- 期待結果: 優先順位どおりに workflow input が解決される。

### WR-UT-029 BobWorkflowMessages: step message と command result message を生成する

- 入力: workflow、step、state、command result。
- 期待結果: expected Markdown / text block を含む message が生成される。

### WR-UT-030 BobWorkflowFactory: stepExecution に応じて visible step を生成する

- 入力: `engineSteps` / `todo` / `full` の workflow。
- 期待結果: Bob step 数、label、runner 呼び出し先が設計どおりになる。

### WR-UT-031 BobWorkflowEngineRunner: hook で task snapshot を保存する

- 入力: mock Bob task、agent output を返す workflow。
- 期待結果: `workflow-start`、`step-start`、`agent-output`、`completed` snapshot 保存 hook が呼ばれる。

### WR-UT-032 BobWorkflowEngineRunner: manual step を StepRuntime に登録する

- 入力: manual step workflow、mock Bob task。
- 期待結果: active step が登録され、`completeCurrentStep()` で `task.setStepComplete()` と resolve が呼ばれる。

### WR-UT-033 Authoring serializer: GUI model を v1 Markdown に保存する

- 入力: authoring model。
- 期待結果: YAML front matter と Markdown body が生成され、parse 可能である。

### WR-UT-034 Authoring loader: unknownFrontMatter と body を保持する

- 入力: unknown field と Markdown body を含む workflow。
- 期待結果: GUI model へ保持され、保存後も欠落しない。

### WR-UT-035 Reference analysis: step 削除・移動の影響を検出する

- 入力: `includeState`、`producedBy`、`requiredWhen` を持つ model。
- 期待結果: 参照切れ候補が warning として返る。

### WR-UT-036 Template Studio: metadata から候補と既定値を作る

- 入力: 標準テンプレート metadata。
- 期待結果: `targetLanguage` / `vcs.type` の選択肢が metadata と一致し、Git profile には Bazaar prompt supplement が入らない。

### WR-UT-037 Template Studio: input default の型を保持する

- 入力: `string` / `number` / `boolean` / `null` を含む workflow input defaults。
- 期待結果: Studio HTML と client parser が型を保持し、生成される profile / customization で文字列化されない。

### WR-UT-038 Template Studio: unsafe output path と symlink escape を拒否する

- 入力: `../outside`、workspace 外へ向く symlink 配下の生成先。
- 期待結果: workflow / profile / customization は書き込まれず、readiness または generate result に error が含まれる。

### WR-UT-039 Template Studio: 既存生成物を backup してから上書きする

- 入力: 既存の profile、customization、`WORKFLOW.md` を持つ workspace。
- 期待結果: `.bak` 系の backup が作成され、生成結果と backup path が report に含まれる。

## 5. 非機能観点

- 一時ファイルと workspace root はテストごとに分離する。
- 時刻依存は `now()` injection または matcher で安定化する。
- Bob / VS Code API は直接呼ばず、最小 interface の mock を使う。
- ファイル保存系テストは Windows / POSIX path 差異を考慮する。
- snapshot のサイズ制限、truncation、messages 省略は境界値を含める。
- Webview / Status Bar / TreeDataProvider は VS Code API mock で表示値と command 登録を検証する。
- Template Customization Studio は source regex だけでなく、model helper と生成結果の実ファイル I/O を検証する。

## 6. 完了条件

- `npm run compile` が成功する。
- `node --test test/*.test.js` が成功する。
- 新規 run control / Run Control View 関連テストが既存 engine / snapshot テストと独立して実行できる。
- テストデータは実 workspace や Bob task に依存しない。

<!-- REMEDIATION-2026-07-11 -->
## 2026-07-11 追加単体テスト契約

| ID | 観点 | 期待結果 |
| --- | --- | --- |
| EXT-UT-REM-001 | soft dependency | companion extension 不在でも通常 command が利用でき、後から有効化すると provider 登録が回復する。 |
| EXT-UT-REM-002 | provider ownership | 同一 ID の別所有元登録を拒否し、disposable 後は再登録できる。古い disposable は新登録を削除しない。 |
| EXT-UT-REM-003 | external process | timeout、cancel、buffer exceed、非許可 exit code を分類し、子プロセスを終了する。 |
| EXT-UT-REM-004 | Windows path | drive、UNC、device、drive-relative、dot、traversal、control-character path を拒否する。 |
| EXT-UT-REM-005 | processing limits | manifest/runtime の範囲が一致し、極端値を clamp し、UTF-8 byte 上限を守る。 |
| EXT-UT-REM-006 | workflow contracts | 全 workflow を動的探索し、未知 provider / command、strict warning、mirror drift を検出する。 |
