# workflow-register STEP 戻り分岐判定機能 設計計画

## 1. 目的

`workflow-register` の step 実行を、現在の線形実行と retry に加えて、定義された条件により過去の step へ戻せるようにする。

主な対象シナリオは次の反復型ワークフローである。

```text
STEP N     : ユーザー入力を求める。入力完了で次 step へ進む。
STEP N+1   : ユーザー入力を使って AI 生成を実行する。生成完了で次 step へ進む。
STEP N+2   : ユーザー入力と AI 生成結果を使ってプレアプローバルチェックを行う。
             チェック NG の場合は STEP N へ戻る。チェック OK なら次 step へ進む。
STEP N+3   : ユーザーへアプローバルを求める。
             リジェクトの場合は STEP N へ戻る。アプローバルなら次 step へ進む。
```

この機能では、AI が実行制御を直接決めるのではなく、AI / command / manual approval step が `run.state` に保存した結果を、workflow engine が決定的な条件式で評価する。これにより、実行履歴、再現性、診断可能性を保つ。

## 2. 既存設計との関係

### 2.1 活かす既存機構

- `steps[]` は `command` / `agent` / `manual` / `result` を扱える。
- `resultKey` と `includeState` により、前段 step の結果を後段 step に渡せる。
- `run.json` が実行状態の正本であり、step status、current step、inputs、state、attempt 履歴を保存する。
- `stepExecution.mode: engineSteps` により、Bob UI 上の visible step と engine step を一致させられる。
- `stepReview` は step 後レビュー、承認、再試行、attempt 保存を扱う。
- `paused` / `control.json` による中断・再開制御がある。
- GUI Builder は `WorkflowAuthoringModel` を経由して `WORKFLOW.md` を編集し、Preview / Diagnostics / Save を行う。

### 2.2 既存 retry との違い

`retryCurrentStep` は current step を再実行するための機能である。今回の「戻る」は、current step ではなく、指定した過去 step から入力・生成・チェックをやり直すための workflow-level transition である。

| 機能 | 対象 | 用途 |
| --- | --- | --- |
| Retry | 現在の step | 同じ step の失敗、レビュー差し戻しを再試行する。 |
| Back transition | 指定された過去 step | 入力、AI 生成、チェック、承認を含む一連の区間をやり直す。 |
| Pause | run 全体 | 人間が無人進行を止める。 |
| Branch checkpoint | loop 上限超過時 | 暴走防止のため、追加 loop を人間が明示承認する。 |

## 3. 採用する設計方針

### 3.1 step に `transition` を追加する

各 step に `transition` を追加し、step 成功後にどこへ進むかを条件で決める。

```yaml
steps:
  - id: preapproval-check
    title: プレアプローバルチェック
    type: command
    includeState:
      - userRequest
      - generatedDraft
    action:
      provider: vscode.executeCommand
      args:
        - example.preapprovalCheck
    resultKey: preapproval
    transition:
      decisions:
        - id: preapproval-ng
          when:
            stateKey: preapproval.status
            equals: ng
          goto: collect-user-input
          loop: revise-until-approved
      default: next
```

`transition.decisions[]` は上から順に評価する。最初に一致した decision を採用し、一致しなければ `default` を使う。

### 3.2 top-level `branching` で loop 制御を定義する

戻り先、上限、上限超過時の手動 checkpoint を workflow 全体で明示する。

```yaml
branching:
  enabled: true
  loops:
    - id: revise-until-approved
      title: 入力・生成・承認の差し戻しループ
      entryStep: collect-user-input
      maxIterations: 5
      extensionSize: 5
      checkpoint:
        title: ループ上限に到達しました
        message: |
          STEP を戻る回数が 5 回に到達しました。
          入力、AI 生成結果、チェック結果を確認してください。
          続行を承認すると、追加で 5 回の戻りループを許可します。
```

`maxIterations: 5` は「戻り transition が実行された回数」の上限とする。初回の `STEP N+2 -> STEP N`、または `STEP N+3 -> STEP N` が 1 回目である。6 回目の戻りが必要になった時点で、自動的に branch checkpoint へ入る。

### 3.3 上限超過時は `checkpoint` status を追加する

通常の `paused` はユーザーが任意に止めるための状態である。一方、loop 上限超過は「安全制約により engine が止めた」状態なので、通常 resume で誤って突破できないよう、`RunStatus` に `checkpoint` を追加する。

```ts
export type RunStatus =
  | "running"
  | "paused"
  | "checkpoint"
  | "reviewing"
  | "held"
  | "completed"
  | "failed"
```

`checkpoint` の解除は専用 command だけが行う。

| Command | 用途 |
| --- | --- |
| `workflowRegister.approveBranchCheckpoint` | 警告内容を確認したうえで、該当 loop の許可回数を `extensionSize` だけ増やす。既定は +5。 |
| `workflowRegister.abortBranchCheckpoint` | 追加 loop を許可せず、run を `failed` または `paused` に移す。初期実装では `failed` を推奨する。 |
| `workflowRegister.inspectBranching` | loop 回数、上限、checkpoint、分岐履歴を表示する。 |

### 3.4 structured manual step を導入する

今回のシナリオでは STEP N がユーザー入力、STEP N+3 が承認 / リジェクトを扱う。現状の `manual` step は完了待ちが中心なので、`manual` step に structured UI 用の `form` と `approval` を追加する。

#### 入力 step

```yaml
- id: collect-user-input
  title: ユーザー入力
  type: manual
  form:
    resultKey: userRequest
    fields:
      - id: request
        title: 依頼内容
        type: string
        required: true
        multiline: true
      - id: constraints
        title: 制約
        type: string
        required: false
        multiline: true
```

完了時、入力値は JSON として `run.state.userRequest` に保存する。戻り transition によりこの step が再実行される場合、前回値を初期値として表示し、ユーザーが編集できるようにする。

#### 承認 step

```yaml
- id: user-approval
  title: ユーザー承認
  type: manual
  includeState:
    - userRequest
    - generatedDraft
    - preapproval
  approval:
    resultKey: userApproval
    approveLabel: 承認
    rejectLabel: リジェクト
    message: |
      入力内容、AI 生成結果、プレアプローバルチェック結果を確認してください。
  transition:
    decisions:
      - id: user-rejected
        when:
          stateKey: userApproval.decision
          equals: rejected
        goto: collect-user-input
        loop: revise-until-approved
    default: next
```

承認時は `run.state.userApproval = { "decision": "approved", ... }`、リジェクト時は `decision: "rejected"` を保存する。

## 4. 条件式モデル

### 4.1 初期版で扱う条件

任意 JavaScript の実行は許可しない。条件式は schema で表現できる安全な比較に限定する。

```ts
type WorkflowTransitionCondition =
  | { stateKey: string; equals: unknown }
  | { stateKey: string; notEquals: unknown }
  | { stateKey: string; in: unknown[] }
  | { stateKey: string; exists: boolean }
  | { stateKey: string; truthy: boolean }
```

`stateKey` は dot path を許可する。たとえば `preapproval.status` は、`run.state.preapproval` を JSON parse できる場合は `{ status: ... }` の `status` を見る。JSON parse できない値は文字列として扱う。

### 4.2 decision 評価順序

```text
step 成功
  -> resultKey / approval result を run.state へ保存
  -> produced artifacts を書く
  -> transition.decisions[] を上から評価
  -> 最初に一致した decision を採用
  -> 一致なしなら transition.default を採用
```

`default` の値は初期版では次に限定する。

| 値 | 意味 |
| --- | --- |
| `next` | 次 step へ進む。既定。 |
| `end` | workflow を `completed` にする。 |
| `fail` | workflow を `failed` にする。 |
| `<stepId>` | 指定 step へ移動する。後方 step へ戻る場合は `loop` 指定必須。 |

## 5. Run state 拡張

`WorkflowRunState` に `branching` を追加する。

```ts
export interface WorkflowRunBranchingState {
  loops: Record<string, WorkflowBranchLoopState>
  checkpoint?: WorkflowBranchCheckpointState
  history: WorkflowBranchTransitionRecord[]
}

export interface WorkflowBranchLoopState {
  loopId: string
  count: number
  allowed: number
  maxIterations: number
  extensionSize: number
  checkpointCount: number
  lastTransitionAt?: string
}

export interface WorkflowBranchCheckpointState {
  id: string
  loopId: string
  fromStepId: string
  toStepId: string
  decisionId: string
  count: number
  allowed: number
  extensionSize: number
  message: string
  createdAt: string
}

export interface WorkflowBranchTransitionRecord {
  id: string
  loopId?: string
  decisionId: string
  fromStepId: string
  toStepId?: string
  action: "next" | "goto" | "end" | "fail" | "checkpoint"
  loopCount?: number
  createdAt: string
  conditionSnapshot?: unknown
}
```

`branching.history` は診断と監査に使う。`RunStepAttempt` にも branch 情報を追加し、attempt ごとに「どの decision でどこへ戻ったか」を追えるようにする。

```ts
export interface RunStepAttempt {
  // existing fields...
  branchDecisionId?: string
  branchLoopId?: string
  branchFromStepId?: string
  branchToStepId?: string
  branchLoopCount?: number
}
```

## 6. Back transition の状態更新ルール

### 6.1 reset 範囲

`STEP N+2 -> STEP N` のように過去 step へ戻る場合、戻り先から現在 step までを再実行対象に戻す。

```text
targetIndex = STEP N
currentIndex = STEP N+2
reset range = [targetIndex, currentIndex]
```

reset 対象 step は次のように扱う。

1. 現在の step state を attempt として archive する。
2. `status = pending` に戻す。
3. `startedAt` / `completedAt` / `reviewStartedAt` / `acceptedAt` / `error` を clear する。
4. `attempt = archivedAttempts.length + 1` に更新する。
5. 対象 step が生成した `resultKey` を `run.state` から削除する。
6. form step の前回入力は `branching.history` または専用 backup に残し、再入力 UI の初期値として使う。

### 6.2 state cleanup

安全側に倒し、reset 範囲で生成された state は削除する。

削除対象:

- reset 範囲にある `resultKey`
- reset 範囲にある manual `form.resultKey`
- reset 範囲にある manual `approval.resultKey`
- reset 範囲にある agent `resultKey`

ただし、入力 step の再表示に必要な前回値は、次のように別キーへ退避する。

```text
run.state["workflow.branching.lastValues.<stepId>.<resultKey>"]
```

これにより、後段 step が古い生成結果を誤って参照することを避けながら、ユーザーには前回入力を初期値として提示できる。

### 6.3 forward transition

将来の汎用性のために前方 step への `goto` は schema 上許可できるが、初期実装では warning にする。今回の要件では backward transition の安全性が最優先である。

## 7. Engine 変更計画

### 7.1 追加 module

```text
extensions/workflow-register/src/core/branching.ts
extensions/workflow-register/src/core/branching/conditionEvaluator.ts
extensions/workflow-register/src/core/branching/transitionResolver.ts
extensions/workflow-register/src/core/engine/branchTransitions.ts
extensions/workflow-register/src/commands/branchCheckpoint.ts
```

| Module | 責務 |
| --- | --- |
| `conditionEvaluator.ts` | `run.state` と condition を使って decision を評価する。 |
| `transitionResolver.ts` | `transition.decisions[]` と `default` から次 action を決める。 |
| `branchTransitions.ts` | back jump、state cleanup、loop count、checkpoint 生成を行う。 |
| `branchCheckpoint.ts` | checkpoint 承認 / 中止 / inspect command を提供する。 |

### 7.2 `WorkflowEngine.continueRun()` の差し込み位置

現在の step 成功処理の後、`stepState.status = completed` を保存する前後に transition 解決を挿入する。

```text
executeStep
  -> artifact write
  -> manual completion / approval result save
  -> step review 判定
  -> step completed
  -> resolve transition
      -> next       : 従来どおり次 index へ
      -> goto back  : reset range, loop count increment, currentStep = target
      -> checkpoint : run.status = checkpoint, currentStep = target
      -> end        : run.status = completed
      -> fail       : run.status = failed
```

`stepReview` と併用する場合は、review accept 後に transition を評価する。既存の `acceptCurrentStep()` は現在 `run.json` を直接更新しているため、branching 対応後は engine API に委譲する。

```ts
engine.acceptCurrentStep(runId, workflow, { decision?: "approved" | "rejected" })
```

この API が、accept 後の transition、checkpoint、next step 決定まで一貫して扱う。

### 7.3 full 実行と singleStep 実行

| 実行方式 | Back transition 後の挙動 |
| --- | --- |
| full | checkpoint にならない限り、戻り先 step から同じ `continueRun()` 内で実行を続ける。ただし無限ループは loop count で止める。 |
| singleStep | 戻り先を `run.currentStep` に設定し、run は `running` のまま返す。次の操作で `runNextStep` が戻り先 step を実行する。 |
| Bob UI engineSteps | Bob の visible step は静的なので、run state を正本とし、chat message / tree view / inspect で「STEP N に戻った」ことを表示する。Bob API に step reset がない場合、Bob の過去 step 表示は補助情報として扱う。 |

## 8. Manual checkpoint UX

### 8.1 checkpoint 到達時

6 回目の戻りが必要になった時点で、engine は戻りを実行せず、次の状態にする。

```json
{
  "status": "checkpoint",
  "currentStep": "collect-user-input",
  "branching": {
    "checkpoint": {
      "loopId": "revise-until-approved",
      "fromStepId": "preapproval-check",
      "toStepId": "collect-user-input",
      "count": 5,
      "allowed": 5,
      "extensionSize": 5
    }
  }
}
```

この時点で、警告 message を Bob chat、VS Code notification、Run Tree View に表示する。

```text
ループ上限に到達しました。

revise-until-approved は 5 / 5 回の戻りを使い切りました。
入力、AI 生成結果、プレアプローバルチェック結果を確認してください。

[承認して +5 回許可] [中止] [診断を開く]
```

### 8.2 承認時

`workflowRegister.approveBranchCheckpoint` は次を行う。

1. checkpoint が pending であることを確認する。
2. `loop.allowed += extensionSize` を行う。
3. checkpoint を history に archive し、`branching.checkpoint` を clear する。
4. checkpoint を発生させた back transition を改めて適用する。
5. `run.status = running`、`run.currentStep = toStepId` にする。
6. Bob chat / Tree View / diagnostics を更新する。

### 8.3 中止時

初期実装では `workflowRegister.abortBranchCheckpoint` は `run.status = failed` とし、`run.error` に中止理由を保存する。

将来的に「編集のため paused にする」選択肢を追加してもよいが、初期版では安全性と分かりやすさを優先する。

## 9. GUI Builder 反映計画

### 9.1 追加する画面要素

GUI Builder に次を追加する。

| 画面 | 追加内容 |
| --- | --- |
| Workflow Settings | `branching.enabled`、loop 定義一覧、既定 `maxIterations`、`extensionSize`、checkpoint message。 |
| Step Details | `transition` セクション。decision 条件、goto、loop、default action を編集する。 |
| Manual Step Details | `form` と `approval` の編集 UI。入力 field、承認 / リジェクト label、resultKey を編集する。 |
| Flow Preview | step 間の通常遷移と戻り矢印を表示する。戻り矢印には loop id と上限を表示する。 |
| Diagnostics Panel | 参照切れ、loop 未指定、到達不能 step、危険な無制限 loop を警告する。 |

### 9.2 Step detail の transition UI

```text
+----------------------------------------------------------+
| Step: preapproval-check                                  |
+-----------------------------+----------------------------+
| 基本設定                    | Transition                 |
| - id                        | Default: next              |
| - title                     |                            |
| - type                      | Decisions                  |
|                             | 1. preapproval-ng          |
| Command                     |    when stateKey           |
| - provider                  |      preapproval.status    |
| - args                      |    equals: ng              |
| - resultKey: preapproval    |    goto: collect-user-input|
|                             |    loop: revise-until...   |
+-----------------------------+----------------------------+
| [Add decision] [Validate branch] [Apply changes]          |
+----------------------------------------------------------+
```

### 9.3 GUI validation

GUI 上では保存前に次を検査する。

| 検査 | error / warning |
| --- | --- |
| `goto` の step id が存在しない | error |
| backward `goto` に `loop` がない | error |
| `loop` が `branching.loops[]` に存在しない | error |
| `maxIterations < 1` | error |
| `extensionSize < 1` | error |
| condition の `stateKey` がどの step からも生成されない | warning。外部 action が生成する可能性を考え error にはしない。 |
| `stateKey` が現在 step より後の step でしか生成されない | error |
| `approval.resultKey` が空 | error |
| approval step に reject transition がない | warning |
| loop が自分自身に戻るだけで入力更新 step を含まない | warning |
| checkpoint message が空 | warning |
| Bob UI `engineSteps` で back transition がある | info。Bob visible step は run state と完全同期できない可能性を説明する。 |

### 9.4 Authoring model / serializer

`WorkflowAuthoringModel` に `branching` を追加し、step model に `transition`、manual step model に `form` / `approval` を追加する。

```ts
export interface WorkflowAuthoringModel {
  // existing fields...
  branching?: WorkflowBranchingDefinition
}

export interface WorkflowAuthoringStepBase {
  // existing fields...
  transition?: WorkflowStepTransitionDefinition
}

export interface WorkflowAuthoringManualStep extends WorkflowAuthoringStepBase {
  type: "manual"
  form?: WorkflowManualFormDefinition
  approval?: WorkflowManualApprovalDefinition
}
```

`workflowAuthoringLoader.ts` の `guiManagedFrontMatterFields` に `branching` を追加する。`workflowAuthoringSerializer.ts` は `branching` と `transition` を YAML front matter に出力する。

## 10. WORKFLOW.md 例

今回の要件を満たす最小例は次の通り。

```yaml
---
schemaVersion: workflow-register/v1
name: revise-generate-approval
description: 入力、生成、事前チェック、ユーザー承認を差し戻し可能にするサンプル
title: 差し戻し付き生成承認
mode: agent
workspaceRequired: true
stepExecution:
  mode: engineSteps
  allowOutOfOrder: false
  showInBob: true
branching:
  enabled: true
  loops:
    - id: revise-until-approved
      title: 入力修正から承認までの反復
      entryStep: collect-user-input
      maxIterations: 5
      extensionSize: 5
      checkpoint:
        title: ループ上限に到達しました
        message: |
          入力、AI生成結果、チェック結果を確認してください。
          承認すると追加で5回の戻りループを許可します。
steps:
  - id: collect-user-input
    title: ユーザー入力
    type: manual
    form:
      resultKey: userRequest
      fields:
        - id: request
          title: 依頼内容
          type: string
          required: true
          multiline: true
        - id: constraints
          title: 制約
          type: string
          required: false
          multiline: true

  - id: generate-draft
    title: AI生成
    type: agent
    includeState:
      - userRequest
    resultKey: generatedDraft
    prompt: |
      userRequest を読み、承認対象のドラフトを生成してください。

  - id: preapproval-check
    title: プレアプローバルチェック
    type: command
    includeState:
      - userRequest
      - generatedDraft
    action:
      provider: vscode.executeCommand
      args:
        - example.preapprovalCheck
    resultKey: preapproval
    transition:
      decisions:
        - id: preapproval-ng
          when:
            stateKey: preapproval.status
            equals: ng
          goto: collect-user-input
          loop: revise-until-approved
      default: next

  - id: user-approval
    title: ユーザー承認
    type: manual
    includeState:
      - userRequest
      - generatedDraft
      - preapproval
    approval:
      resultKey: userApproval
      approveLabel: 承認
      rejectLabel: リジェクト
      message: |
        入力、生成結果、プレアプローバルチェックを確認してください。
    transition:
      decisions:
        - id: user-rejected
          when:
            stateKey: userApproval.decision
            equals: rejected
          goto: collect-user-input
          loop: revise-until-approved
      default: next

  - id: finalize
    title: 確定処理
    type: result
    result:
      source: state
      stateKey: generatedDraft
      sinks:
        - type: file
          path: .bob/artifacts/final-draft.md
---
# 差し戻し付き生成承認

ユーザー入力、AI生成、事前チェック、ユーザー承認を反復します。
```

## 11. Parser / Schema / Validator 変更

### 11.1 `model.ts`

追加する型:

- `WorkflowBranchingDefinition`
- `WorkflowBranchLoopDefinition`
- `WorkflowBranchCheckpointDefinition`
- `WorkflowStepTransitionDefinition`
- `WorkflowTransitionDecisionDefinition`
- `WorkflowTransitionConditionDefinition`
- `WorkflowManualFormDefinition`
- `WorkflowManualApprovalDefinition`
- `WorkflowRunBranchingState`
- `WorkflowBranchLoopState`
- `WorkflowBranchCheckpointState`

### 11.2 `workflowSchema.ts`

追加 schema:

- top-level `branching`
- step-level `transition`
- manual step `form`
- manual step `approval`

`additionalProperties: false` の step schema に新 field を追加する必要がある。

### 11.3 `parser/normalizers.ts`

追加 normalizer:

- `normalizeBranching(fields.branching)`
- `normalizeStepTransition(step.transition)`
- `normalizeManualForm(step.form)`
- `normalizeManualApproval(step.approval)`

### 11.4 `workflowValidator.ts`

追加 validation:

- decision id の重複。
- goto step の存在。
- backward goto の loop 指定。
- loop id の存在。
- loop entryStep の存在。
- condition が空でない。
- condition の演算子が 1 つだけ指定されている。
- `form.resultKey` / `approval.resultKey` と既存 `resultKey` の衝突。
- reset 範囲内外の state 参照影響。
- `branching.enabled !== true` なのに transition がある場合の warning または error。初期実装では error 推奨。

## 12. Bob UI / Command Palette / Tree View

### 12.1 Bob UI

Bob visible step は workflow 定義時に静的に作られる。過去 step へ戻ると Bob UI の完了表示を完全に戻せない可能性があるため、初期実装では次を行う。

- run state を正本とする。
- branch 発生時、Bob chat に「どの decision でどの step に戻ったか」を送信する。
- `workflowRegister.runNextStep` を実行する command link または案内を表示する。
- `WorkflowRegister.runs` Tree View に current step と checkpoint を表示する。
- Bob API が過去 step の complete 状態 reset をサポートしていることが確認できた場合だけ、追加同期を検討する。

### 12.2 Command Palette

追加 command:

| Command ID | 表示名 | 用途 |
| --- | --- | --- |
| `workflowRegister.approveBranchCheckpoint` | Bob Workflow: ループ上限を承認して続行 | checkpoint を承認し、+5 loop を許可する。 |
| `workflowRegister.abortBranchCheckpoint` | Bob Workflow: ループ上限で中止 | checkpoint 中の run を中止する。 |
| `workflowRegister.inspectBranching` | Bob Workflow: 分岐状態を確認 | loop count、history、checkpoint を表示する。 |

### 12.3 Tree View

Run Tree View に次の表示を追加する。

```text
runId: 20260704T...
status: checkpoint
currentStep: collect-user-input
branchLoop: revise-until-approved 5 / 5 (+5 available)
checkpoint: ループ上限に到達しました
```

## 13. 診断・監査

`inspectRunDiagnostics` に次を追加する。

- `branching.loops` の count / allowed / checkpointCount。
- pending checkpoint の有無。
- `branching.history` の一覧。
- reset された step attempts。
- 古い state 参照が残っていないか。
- `workflow.definitionMismatch` と branching 定義変更の関係。

branch history の表示例:

```text
## Branching History

- 2026-07-04T10:00:00.000Z preapproval-ng: preapproval-check -> collect-user-input; loop=revise-until-approved; count=1/5
- 2026-07-04T10:12:00.000Z user-rejected: user-approval -> collect-user-input; loop=revise-until-approved; count=2/5
- 2026-07-04T10:45:00.000Z checkpoint: preapproval-check -> collect-user-input; loop=revise-until-approved; count=5/5
```

## 14. 実装フェーズ

### Phase 1: 定義 model と schema

- `model.ts` に branching / transition / manual form / approval の型を追加する。
- `workflowSchema.ts` を更新する。
- parser normalizer を追加する。
- validator を追加する。
- README / basic design / detailed design への追記方針を整理する。

受け入れ条件:

- `WORKFLOW.md` の `branching` / `transition` / `form` / `approval` を parse できる。
- 不正な goto / loop / condition を diagnostics で検出できる。
- 既存 workflow の parse 結果が変わらない。

### Phase 2: Engine transition

- condition evaluator を実装する。
- step 成功後に transition resolver を呼ぶ。
- backward transition の reset / state cleanup / attempt archive を実装する。
- full / singleStep の挙動を分ける。

受け入れ条件:

- preapproval NG で STEP N に戻る。
- user reject で STEP N に戻る。
- OK / approve で次 step に進む。
- 古い AI 生成結果を後続 step が誤参照しない。

### Phase 3: Loop checkpoint

- `checkpoint` status を追加する。
- loop count / allowed / history を run state に保存する。
- 上限超過時に checkpoint を生成する。
- approve / abort / inspect command を追加する。
- 通常 resume が checkpoint を突破できないようにする。

受け入れ条件:

- 5 回までは back transition できる。
- 6 回目は checkpoint で停止する。
- 承認 command で +5 回許可される。
- 中止 command で run が安全に停止する。

### Phase 4: Manual form / approval UX

- Bob UI 実行時の manual form / approval capture を追加する。
- Command Palette fallback を追加する。
- approval result を `run.state` に保存する。
- リジェクト理由を任意で保存する。

受け入れ条件:

- STEP N で structured input を取得できる。
- 戻った STEP N で前回値が初期表示される。
- STEP N+3 で承認 / リジェクトを選べる。
- リジェクト理由が diagnostics に表示される。

### Phase 5: GUI Builder

- `WorkflowAuthoringModel` に `branching`、`transition`、`form`、`approval` を追加する。
- Workflow Settings に loop 定義 UI を追加する。
- Step Details に transition UI を追加する。
- Manual Step Details に form / approval UI を追加する。
- Flow Preview に戻り矢印を表示する。
- Preview / Diff / Save / Diagnostics を更新する。

受け入れ条件:

- GUI だけで今回のシナリオを作成できる。
- 保存された YAML が parser / validator を通る。
- branch 参照切れや loop 未指定が GUI 上で分かる。

### Phase 6: Sample / docs / tests

- `samples/review-gated-step-execution` とは別に、`samples/step-back-branching-approval` を追加する。
- README に概要と最小 YAML を追記する。
- basic / detailed design を更新する。
- authoring guide に GUI 操作手順を追記する。
- unit / integration test を追加する。

## 15. テスト計画

| 対象 | テスト |
| --- | --- |
| schema | `branching`、`transition`、`form`、`approval` の valid / invalid。 |
| parser | YAML から model へ normalize できる。既存 workflow の互換性が保たれる。 |
| validator | 不明 step、loop 未指定、condition 不正、resultKey 衝突を検出する。 |
| condition evaluator | JSON state、string state、equals / notEquals / in / exists / truthy。 |
| engine full | NG -> N、reject -> N、OK -> next、approve -> next。 |
| engine singleStep | back transition 後に `currentStep` が target になる。 |
| state cleanup | reset 範囲の resultKey が削除され、前回入力だけ初期値として復元できる。 |
| loop guard | 5 回許可、6 回目 checkpoint、承認後 10 回まで許可。 |
| checkpoint commands | approve / abort / inspect。通常 resume で checkpoint を突破できない。 |
| GUI serializer | branching / transition / form / approval を YAML に出力する。 |
| GUI loader | 既存 YAML を GUI model に復元する。 |
| GUI validation | 戻り矢印、loop 未指定、参照切れ warning / error。 |
| diagnostics | branch history と checkpoint が表示される。 |

## 16. 既知リスクと対策

| リスク | 対策 |
| --- | --- |
| Bob visible step と run state の見た目がずれる | run state を正本にし、chat message / Tree View / diagnostics で current step を明示する。 |
| 無限ループ | loop count と checkpoint を必須にする。backward goto は loop 指定なしでは error。 |
| 古い生成結果の誤参照 | reset 範囲の `resultKey` を state cleanup で削除する。 |
| condition が複雑化しすぎる | 初期版は安全な比較演算だけに限定し、任意 JS は入れない。 |
| 通常 resume で checkpoint を突破する | `checkpoint` status を追加し、専用 approve command のみ解除可能にする。 |
| GUI が複雑になる | Workflow-level loop 定義と step-level transition を分け、Flow Preview で視覚化する。 |
| 既存 stepReview と責務が混ざる | stepReview は結果レビュー、branching は実行遷移として分離する。accept 後の transition 評価だけ engine に集約する。 |

## 17. 初期実装での優先順位

1. `transition` + `branching.loops` + engine back transition。
2. 5 回上限と checkpoint 承認。
3. manual approval step。
4. manual form step。
5. GUI Builder 反映。
6. Bob UI の見た目同期強化。

手戻りを減らすため、最初に schema / model / validator を固め、その後 engine、checkpoint、GUI の順に進める。
