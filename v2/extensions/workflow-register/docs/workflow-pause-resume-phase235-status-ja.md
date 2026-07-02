# Phase 2 / Phase 3 / Phase 5 実施状況

## 方針

Phase 4 の自動停止・コスト制限は、要件が固まるまで pending とする。

Phase 3 は当面 **graceful pause のみ** を正式方式とする。実行中 AI への steering prompt 注入、provider cancellation、hard cancel は実装しない。

## Phase 2: Bob UI 導線

実装内容:

- Bob chat に `Workflow controls` block を出す。
- control block には runId 付き command URI を載せる。
- 対象 command:
  - `workflowRegister.pauseAfterCurrentStep`
  - `workflowRegister.pauseBeforeNextAiCall`
  - `workflowRegister.inspectRunControl`
  - `workflowRegister.inspectCurrentStep`
  - `workflowRegister.openCurrentStepInBuilder`
  - paused 時のみ `workflowRegister.resumePausedRun`
- step start / review required / paused の hook で control block を出す。
- `paused` snapshot reason を追加する。

注意:

- command URI が Bob UI でクリック実行できない環境でも、コマンド名と runId が見えるため Command Palette の fallback として使える。
- `pauseBeforeNextAiCall` は Phase 3 方針に合わせ、当面は graceful checkpoint として扱う。

## Phase 3: graceful pause 固定

採用方式:

- 現在実行中の AI 応答 / command は完了を待つ。
- 完了後、次 step / 次 AI 呼び出し前に `paused` へ遷移する。
- 中断時の chat message に「in-flight AI response was not force-cancelled」と明記する。

保留する方式:

- cooperative interrupt prompt
- hard cancel
- provider cancellation token / abort controller
- command step process kill

保留理由:

- 現状の `BobWorkflowTask` 型には、実行中 subagent への追加メッセージ注入や cancellation API がない。
- standalone `AgentProvider` にも cancellation token / abort signal がない。
- 中途半端な成果物を `resultKey` / artifact / result sink に混ぜるリスクを避ける。

## Phase 5: 外側 UI

実装内容:

- Status Bar に active run 件数を表示する。
- Explorer 配下に `Bob Workflow Runs` tree view を追加する。
- tree item には runId / status / currentStep / root / updatedAt を表示する。
- item click は `inspectRunControl` を開く。
- context menu から pause / resume / inspect へ到達できる。
- `workflowRegister.refreshRunsView` で手動更新できる。
- 15秒間隔で軽く自動 refresh する。

## 今後の pending

Phase 4 は未実施。

今後決めるべき項目:

- 業務終了時刻の扱い。
- timezone。
- maxRunMinutes。
- maxAgentStepsPerRun。
- token / cost budget をどの provider 情報から見積もるか。
- workflow 定義側 `runControl.limits` と VS Code settings の優先順位。
