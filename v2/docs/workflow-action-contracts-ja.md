# Bob workflow action contract

この文書は `workflow-register` が公開する workflow 実行 API と、domain extension が登録する action provider ID を固定するための contract です。VS Code command ID、workflow action provider ID、workflow name、schema version は互換性に直結するため、この文書に載せた ID は rename しません。

## workflow-register public API

`local.workflow-register` は拡張 export として次の API を公開します。

| API | Contract |
| --- | --- |
| `registerActionProvider(provider)` | `command` step から呼び出す action provider を登録する。`provider.id` は workflow の `command` と一致させる。 |
| `registerAgentProvider(provider)` | standalone 実行時の `agent` step を外部 provider に委譲する。 |
| `registerResultSink(sink)` | `result` step の保存先を追加する。result sink は file / command sink と同じ failure contract に従う。 |
| `runWorkflow(workflowId, inputs)` | workflow を最初の step から standalone 実行する。 |
| `runWorkflowStep(runId, stepId, inputs)` | 既存 run の指定 step を実行する。 |
| `runNextStep(runId, inputs)` | run state の現在位置から次 step を実行する。 |

## Execution input

`ActionExecutionInput` は action provider に渡される入力です。provider は `args`、`inputs`、`state` を主入力とし、必要な場合だけ workflow context を参照します。

```ts
interface ActionExecutionInput {
  args: unknown
  inputs: Record<string, unknown>
  state?: Record<string, string>
  workflowId?: string
  logicalWorkflowId?: string
  workflowRoot?: string
  workflowFile?: string
  workflowFolderName?: string
  bobRoot?: string
  workspaceRoot?: string
  runId?: string
  stepId?: string
}
```

`AgentExecutionInput` は agent provider に渡される入力です。agent provider は prompt と workflow state を受け取り、Bob UI に依存せずに standalone 実行できます。

```ts
interface AgentExecutionInput {
  prompt: string
  inputs: Record<string, unknown>
  state?: Record<string, string>
  workflowId?: string
  runId?: string
  stepId?: string
}
```

## Result handoff

`result` step は `latestAssistantText`、`resultText`、`artifactText` の順に利用可能な出力を解決し、configured result sink に渡します。result sink が失敗した場合、workflow-register は失敗を握りつぶさず step failure として run state と診断に記録します。file sink / command sink / registered result sink のいずれでも、失敗時は後続 step へ成功として進めません。

## bob-bazaar-review providers

`bob-bazaar-review` は次の action provider ID を登録します。provider ID と同名の VS Code command ID は変更しません。

| Provider ID | Contract |
| --- | --- |
| `bobBazaar.openReviewGui` | Bazaar review GUI を開く。workflow context から初期 target を受け取れる。 |
| `bobBazaar.collectReviewContext` | review target、変更ファイル、packet summary を収集する。 |
| `bobBazaar.loadReviewRules` | `.bob/review/checklist.json` と `.bob/review/review-result.schema.json` を読み込む。 |
| `bobBazaar.captureReviewResult` | Bob 出力から review-result JSON を取り込み、検証して保存する。 |

## bob-code-consistency-review providers

`bob-code-consistency-review` は次の action provider ID を登録します。provider ID と VS Code command ID は変更しません。

| Provider ID | Contract |
| --- | --- |
| `bobCodeConsistency.prepareAiTraceabilityDraft` | traceability AI draft 用 prompt を作成する。 |
| `bobCodeConsistency.applyAiTraceabilityDraft` | AI draft JSON を `.bob-trace/traceability-catalog.json` に反映する。 |
| `bobCodeConsistency.openTraceabilityPrep` | Traceability Prep Webview を開く。 |
| `bobCodeConsistency.validateTraceabilityCatalog` | traceability catalog gate を検証する。 |
| `bobCodeConsistency.createReviewInputFromTraceability` | accepted traceability item から `review-input.yaml` を生成する。 |
| `bobCodeConsistency.preprocess` | `review-input.yaml` から review-package を生成する。 |
| `bobCodeConsistency.captureBobOutput` | Bob output YAML を取り込む。 |
| `bobCodeConsistency.validateOutput` | Bob output YAML を schema と evidence index で検証する。 |
| `bobCodeConsistency.triage` | 人間確認用 triage 成果物を生成する。 |
