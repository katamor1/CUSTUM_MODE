# workflow-register 中断・再開コントロール全体計画

## 1. 目的

業務時間終了、席外し、ネットワーク不安定、想定外に長い AI 実行などで、ワークフローが無人で進み続けることを防ぐ。

特に、次を満たすことを目的にする。

- 人間が明示的に「この run を止める」操作をできる。
- 停止要求後は、新しい step / 新しい AI 呼び出しを開始しない。
- 実行中 AI の扱いは複数方式を比較し、実装フェーズに入る前に採用方式を決める。
- 実行済み成果物、attempt 履歴、task snapshot は失わない。
- 再開時は `run.json` を正本として、次に実行すべき step から安全に再開する。
- Bob UI 内のチャット導線を優先しつつ、VS Code command / status bar / tree view でも操作できるようにする。

## 2. 前提と現状

現状の `workflow-register` には、step 実行後に人間レビューで止める `reviewing` ゲートがある。これは「step 結果を見て承認 / retry する」ための状態であり、「業務時間終了なので以後の無人実行を止める」ための状態ではない。

そのため、中断・再開は `reviewing` や `held` に混ぜず、独立した run control として設計する。

## 3. 用語整理

| 用語 | 意味 |
| --- | --- |
| pause request | 人間または自動制限により「停止してほしい」と要求された状態。実行中 step がすぐ止まるとは限らない。 |
| paused | Engine が checkpoint に到達し、次 step を開始せず停止した永続状態。 |
| resume | paused run を running に戻し、current step から再開する操作。 |
| graceful pause | 現在の AI 応答 / command 実行が終わるのを待ち、次 checkpoint で止める方式。 |
| cooperative interrupt | 実行中の AI に「ここで安全に止まり、再開用メモを残せ」と追加プロンプトを送る方式。 |
| hard cancel | API / process / provider の cancellation を使い、実行中処理を即時停止する best-effort 方式。 |
| review gate | step 実行後の人間確認。`reviewing` 状態。pause とは別概念。 |

## 4. 全体ロードマップ

中断・再開は一気に実装せず、次の順で進める。

| Phase | 目的 | 成果物 | 採用判断 |
| --- | --- | --- | --- |
| Phase 0 | 方式選定準備 | AI 実行中停止方式の比較、decision matrix、PoC 項目 | 実装前に採用方式を決める |
| Phase 1 | 最小安全停止 | `paused`、`control.json`、manual pause / resume、checkpoint | 必ず実装 |
| Phase 2 | Bob UI 導線 | chat 内 control block、Command Palette fallback | Bob API の link 対応状況で調整 |
| Phase 3 | AI 実行中停止方式 | graceful / cooperative / hard cancel の採用方式を実装 | Phase 0 の結果で決定 |
| Phase 4 | 自動停止・コスト制限 | 業務終了時刻、run 時間、agent step 数、予算上限 | 運用ルールに合わせる |
| Phase 5 | 外側 UI 強化 | Status Bar、Tree View、run 一覧操作 | 使い勝手改善として実施 |

## 5. Run status 設計

中断・再開用に `paused` を追加する。

```ts
export type RunStatus =
  | "running"
  | "paused"
  | "reviewing"
  | "held"
  | "completed"
  | "failed"
```

`pausing` は Phase 1 では追加しない。理由は、`control.json` に pause request が存在すれば UI 上は「停止要求済み」を表現できるためである。

将来、実行中 AI への cooperative interrupt / hard cancel を入れて「停止要求済みだがまだ実行中」を明確に表示したくなった場合だけ、`pausing` を追加する。

## 6. pause request 永続化方針

pause request は `run.json` ではなく、run ごとの control file に保存する。

```text
<workflowRoot>/.bob/workflows/runs/<runId>/control.json
```

例:

```json
{
  "schemaVersion": "workflow-register/run-control/v1",
  "runId": "20260703T...-code-consistency-review",
  "pauseRequestedAt": "2026-07-03T09:30:00.000Z",
  "pauseReason": "end-of-business-day",
  "requestedBy": "user",
  "mode": "afterCurrentStep"
}
```

理由:

- 実行中 Engine と UI command が同時に `run.json` を更新すると、後勝ちで pause request が消える可能性がある。
- `control.json` を分離すれば、UI は pause request だけを置き、Engine は checkpoint でそれを読むだけにできる。
- VS Code 再起動後も `run.json` + `control.json` で状態復元できる。

## 7. Engine checkpoint 設計

`WorkflowEngine` は次の checkpoint で pause request を確認する。

1. workflow 開始直後、preflight 前
2. step 開始直前
3. agent step 実行直前
4. command step 実行直前
5. step 成功直後、次 step へ進む前
6. review accept 後、次 step へ進む前
7. resume 直後、再開対象 step を実行する前

pause request が存在する場合:

- 現在 step がまだ開始前なら、その step は `pending` のままにする。
- 直前 step が完了済みなら、その step は `completed` のままにする。
- `run.status = "paused"`
- `run.currentStep = 次に実行すべき step id`
- `run.state["workflow.pause"]` に理由、時刻、mode を保存する。
- `onRunPaused` hook を発火する。

再開時:

- `control.json` の pause request を clear する。
- `run.status = "running"`
- `run.currentStep` から `continueRun()` を再開する。

## 8. AI 実行中の停止方式候補

AI 実行中の中断は、実装前に方式を決める。候補は次の通り。

### 8.1 方式 A: 現在の応答を待って終了する graceful pause

現在実行中の AI 応答は最後まで待つ。応答が返ったら、result 保存、task snapshot 保存、attempt 更新を行い、次 checkpoint で `paused` にする。

長所:

- もっとも安全。
- 途中生成の壊れた成果物を扱わなくてよい。
- Bob / provider 側に cancellation API がなくても実装できる。
- 再開時は通常の run state だけを見ればよい。

短所:

- 長い AI 応答が走っている間のコストは止まらない。
- 「今すぐ止めたい」という心理的要求には弱い。

採用条件:

- Phase 1 の既定方式にする。
- すべての provider / Bob UI / standalone 実行で共通に使う。

### 8.2 方式 B: ステアリング型 cooperative interrupt

実行中の AI に、追加メッセージとして「ここで安全に中断し、再開用メモを残して終了せよ」と送る。

例:

```text
[Workflow pause requested]
Stop at the next safe point. Do not start new files or new analysis.
Summarize what has been completed, what is incomplete, and the exact next action.
Return a compact resume note under <workflow_resume_note>.
```

再開時は、保存した resume note を次の prompt に含める。

長所:

- cancellation API がなくても、AI が協調的に短く終わる可能性がある。
- 再開用メモを自然言語で残せる。
- 「今の回答を完走させず、区切りを作る」運用に近い。

短所:

- Bob / task API が実行中の subagent に追加メッセージを注入できる必要がある。
- 追加プロンプトが現在の作業プロンプトと競合する可能性がある。
- AI が必ず止まる保証はない。
- 中途半端な成果物を result sink に渡さない制御が必要。

採用条件:

- Bob API または agent provider が実行中セッションへの追加メッセージ注入をサポートしていること。
- 中断応答は通常成果物として扱わず、`run.state["workflow.resumeNote"]` や task snapshot に保存する設計にすること。

### 8.3 方式 C: provider cancellation / hard cancel

OpenAI API、外部 process、VS Code command provider などが cancellation token / abort controller / process kill を受けられる場合に、実行中処理へ中断通知を送る。

長所:

- コスト停止効果がもっとも高い可能性がある。
- 長時間 runaway への最後のブレーキになる。

短所:

- provider ごとに対応差が大きい。
- Bob `task.startSubagent()` がキャンセル可能か不明な場合は使えない。
- 途中成果物、部分出力、sink 実行中の整合性が難しい。
- command step の process kill は副作用の途中停止になる可能性がある。

採用条件:

- provider が明示的に cancellation をサポートしていること。
- cancellation 後の step status を `paused` にするか `failed` にするか、運用上合意すること。
- command step では default 無効、明示許可された provider のみ有効にすること。

### 8.4 方式 D: 予算・時間ベースの preemptive checkpoint

実行中 AI を止めるのではなく、そもそも危ない時間帯・長時間 run では次の AI 呼び出しを始めない。

例:

- 18:00 以降は次 AI call を開始しない。
- 1 run 45 分を超えたら pause。
- agent step 6 回を超えたら pause。
- estimated token / cost budget を超えそうなら pause。

長所:

- 実装が安定している。
- コスト暴走の大半を事前に防げる。
- provider 非依存。

短所:

- すでに始まった AI 応答は止められない。
- 精密な token / cost 見積もりは provider 情報が必要。

採用条件:

- Phase 4 で `runControl.limits` として実装する。
- 業務時間終了対策としては優先度が高い。

### 8.5 方式 E: step 分割を強制する設計側対策

長時間 AI step を作らせず、workflow authoring / validator で step を小さく分割する。

例:

- 1 agent step は最大 1 目的に限定する。
- 大きい調査は `collect evidence` / `analyze` / `summarize` / `write` に分ける。
- `maxResultBytes` と `includeState` を制限する。
- Builder / validator が「長すぎる prompt」「巨大すぎる includeState」を warning にする。

長所:

- runaway の根本予防になる。
- 中断・再開が自然に checkpoint 単位になる。

短所:

- 既存 workflow の見直しが必要。
- すぐに「現在実行中のものを止める」機能ではない。

採用条件:

- Phase 4 または別計画で validator warning として実装する。

## 9. AI 実行中停止方式の比較表

| 方式 | 即時性 | 安全性 | 実装難度 | provider 依存 | 初期採用 |
| --- | --- | --- | --- | --- | --- |
| A. graceful pause | 低 | 高 | 低 | 低 | 採用 |
| B. cooperative interrupt | 中 | 中 | 中〜高 | 高 | PoC 後判断 |
| C. hard cancel | 高 | 低〜中 | 高 | 高 | 後続・限定採用 |
| D. preemptive checkpoint | 中 | 高 | 中 | 低 | 採用 |
| E. step 分割設計 | 予防型 | 高 | 中 | 低 | 採用 |

初期方針:

1. Phase 1 は A + checkpoint を採用する。
2. Phase 3 に入る前に B の PoC を行う。
3. C は provider が cancellation を明示サポートする場合だけ実装する。
4. D は Phase 4 で実装する。
5. E は workflow validator / Builder 改善として並行検討する。

## 10. 方式決定チェックポイント

実装フェーズに移る前に、次を確認して採用方式を決める。

### 10.1 Bob API 調査

確認項目:

- `task.startSubagent()` 実行中に追加メッセージを送れるか。
- 実行中 subagent に cancellation / abort を通知できるか。
- `task.sendMessage()` が command URI link を表示・実行できるか。
- 途中応答の partial text を取得できるか。

判断:

- 追加メッセージ注入が可能なら B を PoC する。
- cancellation が可能なら C を provider 限定で PoC する。
- どちらも不可なら A + D を標準方式にする。

### 10.2 standalone AgentProvider 調査

確認項目:

- `workflowRegister.agentCommand` が cancellation token を受けられる設計にできるか。
- 外部 command provider に abort controller を渡せるか。
- 返却前 partial output を保存できるか。

判断:

- cancellation token を標準 API に入れる場合は breaking change にならないよう optional にする。
- 対応しない provider では graceful pause のみ保証する。

### 10.3 result sink / artifact 整合性

確認項目:

- cooperative interrupt の応答を通常成果物として保存しない仕組みがあるか。
- hard cancel 後に result sink を実行しないようにできるか。
- 再開用 note を `run.state` と task snapshot のどちらに保存するか。

判断:

- 中断応答は `workflow.resumeNote` と task snapshot に保存する。
- 通常の `resultKey` / artifact には入れない。

## 11. ユーザー操作設計

### 11.1 コマンド

追加する VS Code command:

| Command ID | 用途 |
| --- | --- |
| `workflowRegister.pauseCurrentRun` | 最新または選択 run に pause request を出す。 |
| `workflowRegister.pauseAfterCurrentStep` | 実行中 step の完了後に pause。既定モード。 |
| `workflowRegister.pauseBeforeNextAiCall` | 次の AI 呼び出し前に pause。checkpoint として before agent step を強制確認する。 |
| `workflowRegister.resumePausedRun` | paused run を再開する。 |
| `workflowRegister.interruptCurrentAiBestEffort` | cooperative interrupt または hard cancel を試みる。採用方式決定後に実装する。 |
| `workflowRegister.inspectRunControl` | pause request / paused 状態 / 自動停止理由を表示する。 |

既存の `workflowRegister.resumeRun` は `paused` を受け付けるように拡張してもよい。ただし UX としては `resumePausedRun` を別名で追加する。

### 11.2 Bob UI チャット内 control block

Bob API が chat message 内の command link / markdown link を許容する場合は、step 開始時と review-required 時に次のような control block を送る。

```md
Workflow controls:
- Pause after current step: command:workflowRegister.pauseAfterCurrentStep?<encoded runId>
- Pause before next AI call: command:workflowRegister.pauseBeforeNextAiCall?<encoded runId>
- Inspect current step: command:workflowRegister.inspectCurrentStep?<encoded runId>
- Open current step in Builder: command:workflowRegister.openCurrentStepInBuilder?<encoded runId>
```

Bob chat が command link を実行しない場合でも、同じ内容をテキストとして表示し、Command Palette から同名 command を実行できるようにする。

### 11.3 VS Code 外側 UI

チャット内ボタンが難しい場合に備え、以下を実装する。

- Status Bar item: `Workflow: running / pause requested / paused / reviewing`
- QuickPick: run 一覧から pause / resume / inspect
- Tree View: `Workflow Runs` に run 状態、currentStep、pause request を表示

Phase 1 は Command Palette + QuickPick、Phase 2 で chat control block、Phase 5 で Status Bar / Tree View とする。

## 12. 自動停止・コスト抑制

### 12.1 workflow 定義

`WORKFLOW.md` に `runControl` を追加する。

```yaml
runControl:
  pause:
    enabled: true
    defaultMode: afterCurrentStep
    showChatControls: true
  limits:
    maxRunMinutes: 45
    maxAgentStepsPerRun: 6
    pauseAtLocalTime: "18:00"
    timezone: "Asia/Tokyo"
```

### 12.2 VS Code settings

全 workflow 共通の上限として設定も追加する。

```json
{
  "workflowRegister.runControl.enabled": true,
  "workflowRegister.runControl.maxRunMinutes": 60,
  "workflowRegister.runControl.pauseAtLocalTime": "18:00",
  "workflowRegister.runControl.timezone": "Asia/Tokyo",
  "workflowRegister.runControl.showStatusBar": true
}
```

workflow 側と settings 側の両方がある場合は、より厳しい値を採用する。

### 12.3 自動 pause の判定

Engine checkpoint で次を判定する。

- 現在時刻が `pauseAtLocalTime` を超えている。
- run 開始から `maxRunMinutes` を超えている。
- agent step 実行回数が `maxAgentStepsPerRun` を超える。
- estimated token / cost budget を超えそうである。
- `control.json` に pause request がある。

該当した場合、次 step / 次 AI call を開始せず paused にする。

## 13. 変更対象ファイル

### 13.1 core model

`src/core/model.ts`

- `RunStatus` に `paused` を追加する。
- `WorkflowRunControlDefinition` を追加する。
- `CoreWorkflowDefinition` に `runControl` を追加する。
- `WorkflowRunState` に `pausedAt`, `pauseReason` は直接持たせず、まずは `state["workflow.pause"]` に入れる。

### 13.2 schema / parser

`src/core/workflowSchema.ts`

- `runControl.pause.enabled`
- `runControl.pause.defaultMode`
- `runControl.pause.showChatControls`
- `runControl.limits.maxRunMinutes`
- `runControl.limits.maxAgentStepsPerRun`
- `runControl.limits.pauseAtLocalTime`
- `runControl.limits.timezone`
- `runControl.limits.maxEstimatedTokens`
- `runControl.limits.maxEstimatedCost`

を schema に追加する。

`src/core/parser.ts`

- `runControl` を normalize して `CoreWorkflowDefinition` に入れる。
- 未指定時は安全寄りの default を設定する。

### 13.3 run control store

新規ファイル:

```text
src/core/runControlStore.ts
```

責務:

- `requestPause(runId, reason, mode)`
- `clearPause(runId)`
- `loadControl(runId)`
- `isPauseRequested(runId)`
- `recordInterruptRequest(runId, method)`
- `recordResumeNote(runId, note)`

保存先:

```text
.bob/workflows/runs/<runId>/control.json
```

### 13.4 engine

`src/core/engine.ts`

- `WorkflowEngineOptions` に `runControlStore` と `clock` を追加する。
- `continueRun()` の before/after step に checkpoint を追加する。
- `executeStep()` の agent / command 直前に checkpoint を追加する。
- `resumeRun()` は `paused` を受け入れる。
- `findRecoverableRun()` の recoverable status に `paused` を追加する。
- `WorkflowExecutionHooks` に `onRunPaused` / `onPauseRequested` / `onAiInterruptRequested` を追加する。

### 13.5 commands

新規ファイル:

```text
src/commands/runControl.ts
```

追加 command:

- `pauseCurrentRun`
- `pauseAfterCurrentStep`
- `pauseBeforeNextAiCall`
- `resumePausedRun`
- `interruptCurrentAiBestEffort`
- `inspectRunControl`

### 13.6 Bob UI message

既存の Bob UI hook に control block を追加する。

- `onWorkflowStart`
- `onStepStart`
- `onStepReviewRequired`
- `onStepHeld`
- `onRunPaused`

message は command link が使える環境では link、使えない環境では command ID と run ID のテキストを表示する。

### 13.7 package.json

- activationEvents に command を追加する。
- contributes.commands に title を追加する。
- configuration に runControl settings を追加する。

### 13.8 diagnostics

`src/core/runDiagnostics.ts`

- `paused` run 数を summary に追加する。
- pause request / pause reason / pauseAt を表示する。
- `workflow.pause` state を読みやすく整形する。
- interrupt request / resume note を表示する。

## 14. 実装フェーズ詳細

### Phase 0: 方式選定準備

目的: 実装前に AI 実行中の停止方式を決める。

作業:

1. Bob API の追加メッセージ注入可否を調査する。
2. Bob API の cancellation 可否を調査する。
3. standalone AgentProvider の cancellation token 拡張可否を調査する。
4. cooperative interrupt 応答を通常成果物に混ぜない保存先を決める。
5. 方式 A / B / C / D / E のうち Phase 3 で実装する範囲を決める。

完了条件:

- `AI実行中は graceful pause を標準、cooperative interrupt は PoC、hard cancel は provider 限定` のように採用方針が明文化されている。
- Phase 1 の実装に入れる。

### Phase 1: 手動 pause / resume の最小実装

目的: 業務時間終了時に、次 step / 次 AI call を始めない。

実装:

1. `RunStatus` に `paused` を追加。
2. `runControlStore.ts` を追加。
3. `pauseAfterCurrentStep` / `resumePausedRun` / `inspectRunControl` を追加。
4. Engine に before step / after step checkpoint を追加。
5. `findRecoverableRun()` に `paused` を追加。
6. diagnostics に paused / pause reason を表示。
7. package.json に command を登録。

完了条件:

- 実行中 run に pause request を出せる。
- 現 step 完了後に run が `paused` になる。
- `resumePausedRun` で同じ runId から再開できる。
- `run.json` と `control.json` だけで VS Code 再起動後も復帰できる。

### Phase 2: Bob UI チャット内 control block

目的: Command Palette を開かず、Bob の会話中に停止操作を見つけられるようにする。

実装:

1. `buildWorkflowControlBlock()` を追加。
2. `onStepStart` / `onStepReviewRequired` / `onRunPaused` で control block を送る。
3. command URI link が使えない場合の fallback text を用意する。
4. `taskSnapshots` に `pause-requested` / `paused` reason を追加する。

完了条件:

- Bob chat に runId 付きの pause / inspect / open builder 導線が表示される。
- link 実行不可環境でも Command Palette から操作できる。

### Phase 3: AI 実行中停止方式の実装

目的: Phase 0 で採用した方式を実装する。

候補別作業:

- A 採用時: graceful pause を標準動作として確定し、UI に「現在の応答完了後に停止します」と表示する。
- B 採用時: cooperative interrupt prompt を送る command と resume note 保存を実装する。
- C 採用時: cancellation token / abort controller 対応 provider のみ hard cancel を実装する。
- D 採用時: 次 AI call 前の budget checkpoint を実装する。

完了条件:

- 採用方式ごとの UI 表示、run state、resume prompt が一貫している。
- 中断応答が通常成果物に混ざらない。
- 再開時に resume note が prompt に含まれる。

### Phase 4: 自動停止制限

目的: 無人実行のコスト上限を workflow / workspace 単位で制御する。

実装:

1. `runControl` schema / parser / authoring model / serializer を追加。
2. VS Code settings に `workflowRegister.runControl.*` を追加。
3. checkpoint で maxRunMinutes / pauseAtLocalTime / maxAgentStepsPerRun / token budget を判定する。
4. diagnostics に自動停止理由を表示する。

完了条件:

- 18:00 を超えた run が次 AI call 前に paused になる。
- agent step 数上限を超えた run が paused になる。
- workflow 個別設定と workspace 設定のうち厳しい値が使われる。

### Phase 5: Status Bar / Tree View

目的: チャット外でも run 状態を一目で確認し、停止・再開できるようにする。

実装:

1. Status Bar item で最新 run 状態を表示。
2. クリックで pause / resume / inspect の QuickPick を出す。
3. Tree View `Workflow Runs` を追加し、running / pause requested / paused / reviewing / failed を一覧表示する。

完了条件:

- Bob chat を見ていなくても無人実行中 run に気づける。
- running run を 2 click 程度で pause request できる。

## 15. 再開プロンプト設計

cooperative interrupt または hard cancel 後に resume する場合は、次の情報を prompt に含める。

```text
<workflow_resume_context>
Run was paused before completing the previous AI work.
Reason: {{pauseReason}}
Current step: {{currentStep}}
Completed attempts: {{attempts}}
Resume note:
{{workflow.resumeNote}}

Continue from the next incomplete action only.
Do not repeat completed analysis unless required for consistency.
</workflow_resume_context>
```

保存先:

- `run.state["workflow.resumeNote"]`
- task snapshot `reason = "interrupt-note"`
- `control.json.resumeNote`

通常の `resultKey` には保存しない。通常成果物と再開メモを混ぜると、result sink / validator が誤作動するためである。

## 16. テスト計画

### Unit test

- pause request がない場合、既存 workflow は従来通り進む。
- before step checkpoint で pause request がある場合、step は pending のまま `paused` になる。
- after step checkpoint で pause request がある場合、直前 step は completed、次 step が currentStep になる。
- paused run を resume すると currentStep から再開する。
- paused run が recoverable run として選ばれる。
- pauseAtLocalTime / maxRunMinutes / maxAgentStepsPerRun が正しく判定される。
- cooperative interrupt 応答が resultKey / artifact に保存されない。
- resume note が再開 prompt に含まれる。

### Integration test

- Bob UI 実行中に pause request を出し、次 step に進まないこと。
- review-required 中に pause request を出しても、accept 後に次 step が始まらず paused になること。
- VS Code 再起動後、paused run を再開できること。
- command link が使えない場合でも Command Palette で同じ操作ができること。
- cooperative interrupt 採用時、AI が resume note を返した場合だけ安全に paused へ移行すること。

## 17. リスクと対策

| リスク | 対策 |
| --- | --- |
| 実行中 AI 呼び出しを即時停止できない | Phase 1 では「次 AI call を始めない」を保証し、実行中停止は Phase 3 の方式選定後に実装する。 |
| cooperative interrupt が通常成果物に混ざる | interrupt 応答は `workflow.resumeNote` と task snapshot に保存し、resultKey / artifact には入れない。 |
| hard cancel で副作用途中の command が止まる | command step の hard cancel は default 無効。明示許可された provider のみ対応する。 |
| run.json の同時更新で pause request が消える | pause request は `control.json` に分離する。 |
| `held` / `reviewing` / `paused` の意味が混ざる | `paused` を安全停止専用 status として追加する。 |
| Bob chat 内ボタンが環境依存 | Command Palette / Status Bar / Tree View を fallback とする。 |
| 自動停止時刻の timezone 問題 | workflow / settings に timezone を明示し、未指定時は VS Code 環境の timezone を使う。 |
| resume 後に古い定義で危険な再開をする | 既存の workflowDefinitionHash / step id order 検査を再利用し、危険な変更は止める。 |

## 18. 初回実装スコープ

最初の実装では次だけを入れる。

- `paused` RunStatus
- `runControlStore.ts`
- `pauseAfterCurrentStep`
- `resumePausedRun`
- `inspectRunControl`
- Engine checkpoint: before step / after step
- diagnostics 表示
- package.json command 登録

この範囲では、実行中 AI は無理に止めない。現在の AI 応答完了後に停止する。

理由:

- 実装が安定する。
- provider 非依存で動く。
- `run.json` / `control.json` の正本設計を先に固められる。
- コスト暴走の主要因である「次々に step が進む」問題を先に止められる。

Bob chat 内ボタン、自動停止時刻、cooperative interrupt、hard cancel は後続 Phase に分ける。
