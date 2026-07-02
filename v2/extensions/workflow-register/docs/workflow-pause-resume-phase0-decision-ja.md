# Phase 0 調査結果: 中断・再開方式の採用判断

## 1. 調査対象

`workflow-register` の Bob UI 実行経路と standalone engine 実行経路を確認し、AI 実行中にどの停止方式を採用できるかを判断した。

確認した主なファイル:

- `src/bobWorkflowTypes.ts`
- `src/bobWorkflowRunner.ts`
- `src/core/engine.ts`
- `src/core/runStateStore.ts`
- `src/workflowRuntimeFactory.ts`

## 2. Bob API 側の確認結果

`BobWorkflowTask` の型定義では、利用可能な操作は次の範囲である。

```ts
export interface BobWorkflowTask {
  sendMessage?: (...args: unknown[]) => Promise<unknown> | Thenable<unknown> | unknown
  setStepComplete?: () => unknown
  startSubagent?: (prompt: string, preset?: unknown, mask?: unknown) => Promise<unknown> | Thenable<unknown> | unknown
  getMessages?: () => unknown[]
  getAllMetadata?: () => Record<string, unknown>
  toSerializable?: () => unknown
}
```

この型定義上、次は確認できない。

- 実行中 `startSubagent()` への cancellation / abort token。
- 実行中 subagent への steering message 注入 API。
- partial output stream の明示取得 API。

`bobWorkflowRunner.ts` では、agent step 実行時に `task.startSubagent(prompt)` を `await` しており、返却後に `extractSubagentResult()` で最終結果を取り出す構造である。

そのため、現状の型と実装だけを見る限り、Bob UI 経路で即時 hard cancel や実行中 steering prompt を安全に実装できる根拠はない。

## 3. standalone AgentProvider 側の確認結果

`AgentProvider` は次の形である。

```ts
export interface AgentProvider {
  run: (input: AgentExecutionInput) => Promise<string> | string
}
```

`AgentExecutionInput` に cancellation token / abort signal はない。

したがって、現状の公開 API を壊さずにできるのは graceful pause までである。将来 hard cancel を入れる場合は、optional な `cancellationToken` / `abortSignal` を追加する必要がある。

## 4. 採用判断

### Phase 1 で採用する方式

Phase 1 は **方式 A: graceful pause** を採用する。

意味:

- 現在実行中の AI 応答 / command は完了を待つ。
- 完了後、次 step / 次 AI 呼び出しを始める前の checkpoint で `paused` にする。
- pause request は `control.json` に保存する。
- 再開時は `control.json` を clear し、`run.currentStep` から再開する。

理由:

- Bob UI / standalone の両方で provider 非依存に実装できる。
- 中途半端な AI 出力を成果物や result sink に混ぜない。
- 実装が安定しており、まず安全停止の正本設計を固められる。

### Phase 3 で PoC する方式

Phase 3 では **方式 B: cooperative interrupt** を PoC 候補にする。

ただし、採用条件は次の通り。

- Bob API または外部 AgentProvider が実行中セッションへの追加メッセージ注入を明示サポートする。
- 中断応答を通常の `resultKey` / artifact に保存せず、`workflow.resumeNote` と task snapshot に分離できる。
- 再開 prompt に resume note を挿入して、未完了分だけ続行できる。

現状の repo 内型定義だけでは、Bob UI 経路での実装根拠はない。

### 限定採用にする方式

**方式 C: hard cancel** は、provider が明示的に cancellation をサポートする場合だけ限定採用する。

特に command step は副作用途中停止の危険があるため、default 無効にする。

## 5. Phase 1 実装範囲

Phase 1 では次を実装する。

- `RunStatus` に `paused` を追加。
- `runControlStore.ts` を追加し、`control.json` に pause request を保存する。
- `WorkflowEngine` に checkpoint を追加する。
- `pauseCurrentRun` / `pauseAfterCurrentStep` / `pauseBeforeNextAiCall` / `resumePausedRun` / `inspectRunControl` を追加する。
- `paused` run を recoverable run として扱う。
- diagnostics に paused 件数と pause reason を表示する。

Phase 1 では、実行中 AI への steering prompt 注入や hard cancel は実装しない。

## 6. Phase 1 後の確認項目

- 実行中 run に pause request を出せる。
- 現在の AI 応答または command 完了後、次 step に進まず `paused` になる。
- `resumePausedRun` で同じ runId から再開できる。
- `control.json` を消しても `run.json` の正本が壊れない。
- `inspectRunControl` と diagnostics で pause reason を確認できる。
