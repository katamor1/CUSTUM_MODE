# workflow-register 手動操作 Step GUI 完了導線 設計計画

## 1. 背景

`workflow-register` は `type: manual` の step や `stepCompletion: manual` によって、人間の確認・操作を待ってから workflow を進められる。

現状でも `workflowRegister.completeCurrentStep` / `workflowRegister.completeStep` で手動完了待ち step を完了できるが、利用者から見ると次の点が分かりづらい。

- いま workflow が「人間の操作待ち」で止まっているのか分かりにくい。
- 何を確認・操作すればよいのかが Bob / VS Code の GUI 上で明確に出ない。
- 完了操作が Command Palette / command link / QuickPick 前提で、初心者にとって発見しづらい。
- workflow 設計者が `WORKFLOW.md` から「利用者に見せる操作手順」を明示注入する専用項目がない。
- GUI Builder では manual step の `prompt` は編集できるが、利用者向けの完了導線としての文言・ボタン表示を設計できない。

この計画では、手動操作が必要な step に対して、VS Code Webview の GUI ページで利用者向けメッセージと `完了` ボタンを表示し、ボタン押下で現在 step を完了できる導線を追加する。

## 2. 用語

| 用語 | 意味 |
| --- | --- |
| 手動操作 Step | `type: manual` の step、または `stepCompletion: manual` により自動 step 後に人間完了待ちになる step。 |
| User Action | workflow 設計者が `WORKFLOW.md` に書く、利用者向け操作内容・手順・完了ボタン文言の定義。 |
| Manual Step Panel | 実行中の手動操作 step を表示し、完了ボタンを押せる Webview GUI。 |
| Active Step | Bob UI 実行中に `StepRuntime` が保持している、`task.setStepComplete()` と Promise resolve が可能な step。 |
| Held Run | `run.json` 上は `held` だが、VS Code 再起動などで Bob task への active handle が残っていない可能性がある run。 |

## 3. ゴール

- 手動操作が必要な step で、利用者が「何をすればよいか」と「どのボタンを押せば進むか」を同じ GUI 上で理解できる。
- `WORKFLOW.md` から step 単位で利用者向けメッセージを注入できる。
- メッセージは `inputs` / `state` / `run` / `workflow` / `step` の値を使って実行時にレンダリングできる。
- 完了ボタンは既存の `StepRuntime.completeCurrentStep()` と同等の経路で `task.setStepComplete()` と held promise resolve を行う。
- 複数 active step がある場合も、対象 step を取り違えない。
- GUI Builder の作成・編集画面で、User Action のメッセージとボタン文言を編集・保存・読み込みできる。
- 既存 workflow との後方互換性を保ち、`userAction` 未指定時は `prompt` または既定文言へ fallback する。

## 4. 非ゴール

- Bob 本体の Workflow UI を置き換えない。
- `stepReview` の承認・再試行 UI をこの計画で統合しない。reviewing run は既存の `acceptCurrentStep` / `retryCurrentStep` 系の対象とする。
- Webview 内で任意の command link や JavaScript を `WORKFLOW.md` から実行可能にしない。
- VS Code 再起動後に失われた Bob task handle を復元して `task.setStepComplete()` することは初期版の対象外とする。
- 手動 step で任意フォーム入力を受け取り state に保存する機能は初期版では扱わない。将来拡張とする。

## 5. 提案する WORKFLOW.md 形式

step に任意の `userAction` を追加する。

```yaml
steps:
  - id: confirm-generated-report
    title: 生成レポートの確認
    type: manual
    required: true
    prompt: |
      生成されたレポートを確認してください。
    userAction:
      message: |
        次のファイルを開き、内容に問題がないか確認してください。

        - 対象ファイル: `.bob/artifacts/{{inputs.reportName}}.md`
        - 確認観点:
          1. 見出しが揃っていること
          2. TODO が残っていないこと
          3. レビュー結果が日本語で書かれていること

        確認が終わったら下のボタンを押してください。
      completeLabel: 確認完了
      confirmOnComplete: true
      confirmMessage: この step を完了済みとして workflow を進めます。よろしいですか？
```

### 5.1 フィールド定義

| field | type | 必須 | 既定値 | 説明 |
| --- | --- | --- | --- | --- |
| `userAction.message` | string | 任意 | `step.prompt`、それも無ければ既定文 | GUI に表示する利用者向け操作内容・手順。Markdown 風の複数行テキストを許可する。 |
| `userAction.completeLabel` | string | 任意 | `完了` | 完了ボタンに表示する文言。 |
| `userAction.confirmOnComplete` | boolean | 任意 | `false` | 完了ボタン押下時に VS Code 確認ダイアログを挟む。 |
| `userAction.confirmMessage` | string | 任意 | 既定確認文 | `confirmOnComplete: true` の場合の確認文。 |

### 5.2 初期版で採用しない候補

次は有用だが、初期版では schema に入れず後続 phase で検討する。

| 候補 | 理由 |
| --- | --- |
| `userAction.links[]` | 任意 URL / command link は安全性設計が重い。まずはメッセージ内のテキスト案内に留める。 |
| `userAction.form` | 入力値を run state に保存する仕様が必要。manual step の完了導線とは分ける。 |
| `userAction.timeout` | 自動 fail / reminder は運用設計が必要。 |
| `userAction.nextStepHint` | まずは current step 完了だけを明確にする。 |

### 5.3 fallback 方針

`userAction` 未指定でも既存 workflow は動く。

```text
表示 message =
  step.userAction.message
  -> step.prompt
  -> `${step.title} の操作が完了したら、完了ボタンを押してください。`

完了ボタン label =
  step.userAction.completeLabel
  -> `完了`
```

manual step では `prompt` が既に「人間が確認する内容」として使われているため、`userAction.message` 未指定時の fallback として自然に扱う。

## 6. 実行時 UX

### 6.1 Manual Step Panel の画面構成

```text
+--------------------------------------------------------------+
| Bob Workflow Manual Step                                     |
+--------------------------------------------------------------+
| Workflow: サンプルレビュー                                    |
| Run ID: 20260704-xxxx                                        |
| Step: 3 / confirm-generated-report                            |
| Status: waiting for user action                               |
+--------------------------------------------------------------+
| 操作内容                                                      |
|                                                              |
| 次のファイルを開き、内容に問題がないか確認してください。        |
| ...                                                          |
+--------------------------------------------------------------+
| 参考情報                                                      |
| - workflowFile: .bob/workflows/sample-review/WORKFLOW.md      |
| - state keys: analysisReport, reportPath                      |
+--------------------------------------------------------------+
| [確認完了] [現在のステップ状態を確認] [Workflow Builder で開く] |
+--------------------------------------------------------------+
```

### 6.2 起動導線

初期版では次の 3 つの導線を用意する。

1. Bob UI 実行中に manual step で `StepRuntime.hold(...)` へ入ったら、自動で Manual Step Panel を開く。
2. Bob chat に送る workflow control block に `Open manual step page` の command link を追加する。
3. `Bob Workflow Runs` TreeView の `held` / active run に `手動操作ページを開く` context command を追加する。

自動表示は利用者の迷いを最も減らすため、初期値で有効にする。将来、設定で無効化できるようにしてもよい。

### 6.3 完了ボタン押下時の流れ

```text
Manual Step Panel
  -> postMessage({ type: "completeManualStep", activeKey })
  -> extension host
  -> StepRuntime.completeStepByKey(activeKey)
  -> captureHeldStepResult(active)
  -> active.task.setStepComplete()
  -> active.resolve(true)
  -> activeSteps.delete(activeKey)
  -> panel へ完了結果を返す
```

既存の `completeCurrentStep()` は QuickPick で対象 active step を選ぶ。新規の `completeStepByKey(activeKey)` は GUI から渡された key を使うため、複数 active step があっても誤完了を避けられる。

### 6.4 完了後の表示

完了後、panel は次を表示する。

- `この step は完了しました。`
- `runId`
- 完了した step id / title
- 次に実行すべき操作候補
  - full 実行で engine が続行中なら `workflow が次の step に進んでいます。`
  - singleStep 実行で pending step が残る場合は `次のステップを実行` ボタンまたは command link。
  - workflow 完了済みなら `Workflow run completed`。

初期版では、完了ボタン押下直後の結果表示に留め、run 状態の完全追跡は既存の Run Control View に任せる。

### 6.5 Active Step が無い Held Run の扱い

`StepRuntime` は VS Code 再起動で失われるため、`run.json` だけが `held` でも `task.setStepComplete()` できないケースがある。

この場合の panel は read-only とし、次を表示する。

```text
この run は held ですが、現在の Bob task への接続がありません。
VS Code の再起動などで active step handle が失われた可能性があります。
`Bob Workflow: 実行を再開` または `Bob Workflow: 次のステップを実行` を使って復帰してください。
```

## 7. メッセージレンダリング

### 7.1 Template 変数

`userAction.message` と `userAction.confirmMessage` は、既存の template renderer と同じ方針で次を展開する。

| placeholder | 例 | 説明 |
| --- | --- | --- |
| `{{inputs.name}}` | `{{inputs.targetFile}}` | run inputs の値。 |
| `{{state.key}}` | `{{state.analysisReport}}` | 前段 step が保存した state。 |
| `{{run.id}}` | `{{run.id}}` | run ID。 |
| `{{workflow.id}}` | `{{workflow.id}}` | workflow ID。 |
| `{{step.id}}` | `{{step.id}}` | step ID。 |

### 7.2 表示形式

初期版では安全性を優先し、次のいずれかにする。

- Webview 側で HTML を escape し、改行と箇条書き程度を読みやすく表示する。
- もしくは extension host 側で Markdown を安全な HTML subset へ変換し、script / command URI / raw HTML は無効化する。

`WORKFLOW.md` の本文をそのまま `innerHTML` へ入れない。

### 7.3 長文対策

- `message` が長い場合も scroll で読めるようにする。
- validator では hard error にしないが、10,000 文字超などは warning を出す。
- ボタンは画面下部に sticky footer として残す。

## 8. Core / Runtime 実装方針

### 8.1 model 追加

`extensions/workflow-register/src/core/model.ts` に追加する。

```ts
export interface WorkflowUserActionDefinition {
  message?: string
  completeLabel?: string
  confirmOnComplete?: boolean
  confirmMessage?: string
}

export interface BaseEngineStep {
  // existing fields...
  userAction?: WorkflowUserActionDefinition
}
```

### 8.2 schema 追加

`extensions/workflow-register/src/core/workflowSchema.ts` の `steps.items.properties` に `userAction` を追加する。

```ts
userAction: {
  type: "object",
  properties: {
    message: { type: "string" },
    completeLabel: { type: "string" },
    confirmOnComplete: { type: "boolean" },
    confirmMessage: { type: "string" }
  },
  additionalProperties: false
}
```

step schema は `additionalProperties: false` のため、schema 追加なしに `WORKFLOW.md` へ `userAction` を書くと validation error になる。必ず schema / normalizer / serializer / loader を同時に更新する。

### 8.3 parser / normalizer

`extensions/workflow-register/src/core/parser/normalizers.ts` に `normalizeUserAction(...)` を追加し、`normalizeEngineStep(...)` の base に含める。

```ts
function normalizeUserAction(value: unknown): WorkflowUserActionDefinition | undefined {
  const record = asRecord(value)
  const normalized = {
    message: optionalString(record, "message"),
    completeLabel: optionalString(record, "completeLabel"),
    confirmOnComplete: optionalBoolean(record, "confirmOnComplete"),
    confirmMessage: optionalString(record, "confirmMessage")
  }
  return Object.values(normalized).some((value) => value !== undefined) ? normalized : undefined
}
```

### 8.4 user action view model

runtime 表示用に、step 定義そのものではなく表示用 view model を作る。

```ts
export interface ManualStepActionViewModel {
  activeKey?: string
  runId: string
  workflowId: string
  workflowLabel: string
  stepId: string
  stepTitle: string
  status: "active" | "heldWithoutActiveTask" | "completed" | "error"
  message: string
  completeLabel: string
  confirmOnComplete: boolean
  confirmMessage?: string
  workflowFile?: string
  stateKeys: string[]
}
```

`buildManualStepActionViewModel({ workflow, run, step, active })` は `renderTemplate(...)` を使って message / confirmMessage をレンダリングする。

### 8.5 StepRuntime 拡張

`extensions/workflow-register/src/bobStepRuntime.ts` に次を追加する。

```ts
getActiveStep(key: string): ActiveStep | undefined
completeStepByKey(key: string): Promise<string>
```

`completeCurrentStep()` は既存互換のため残し、内部的に `completeStep(active)` helper を共有する。

```text
completeCurrentStep()
  -> pickActiveStep()
  -> completeStep(active)

completeStepByKey(key)
  -> activeSteps.get(key)
  -> completeStep(active)
```

### 8.6 Manual Step Panel module

新規 module 候補:

```text
extensions/workflow-register/src/webview/manualStepPanel.ts
extensions/workflow-register/src/webview/manualStepHtml.ts
extensions/workflow-register/src/webview/manualStepStyles.ts
extensions/workflow-register/src/webview/manualStepScript.ts
```

初期版では `manualStepPanel.ts` に寄せてもよいが、既存 Builder と同じく HTML / styles / script を分けるとテストしやすい。

### 8.7 command 追加

`package.json` と `extensionWithAuthoring.ts` / `extension.ts` へ追加する。

| command | title | 用途 |
| --- | --- | --- |
| `workflowRegister.openManualStepPanel` | `Bob Workflow: 手動操作ステップを開く` | active step または held run の操作 GUI を開く。 |
| `workflowRegister.completeManualStepFromPanel` | internal | Webview から完了要求を受ける内部 command。通常は command palette に出さない。 |

Webview からは command を直接実行せず、`postMessage` で host に要求する。

## 9. Bob UI / Run Control 連携

### 9.1 workflow control block

`buildWorkflowControlBlock(...)` に、対象 step が manual action 待ちのときだけ次を追加する。

```text
- Open manual step page `workflowRegister.openManualStepPanel`
```

command link には `runId` を渡す。active step の key は Bob chat に露出させず、host 側で runId から active step を引く。

### 9.2 Run Control View

`WorkflowRunControlView` では `held` run に対して context menu を追加する。

```json
{
  "command": "workflowRegister.openManualStepPanel",
  "when": "view == workflowRegister.runs && viewItem == workflowRun.held",
  "group": "inline"
}
```

active step が存在する場合は完了ボタン付き、存在しない場合は read-only 復帰案内を表示する。

### 9.3 自動表示

`StepRuntime.hold(...)` の直後、または `manualCompletion` callback 内で `ManualStepPanel.show(activeKey)` を呼ぶ。

注意点:

- 複数 active step が連続する場合は既存 panel を reuse し、active step list を更新する。
- 利用者が panel を閉じても workflow は held のまま。再度 command から開ける。
- panel を開く失敗は workflow 失敗にしない。Bob chat の command link / Command Palette を fallback とする。

## 10. GUI Builder 反映

### 10.1 Step detail への項目追加

Step detail に `User action` section を追加する。

```text
Step detail
  Basic
  Execution
  Type specific
  References
  User action
    [x] 手動操作ページに表示するメッセージを指定する
    Message textarea
    Complete button label input
    [ ] 完了前に確認ダイアログを表示する
    Confirmation message textarea
```

表示条件:

- `type: manual` の step では常に表示し、入力を推奨する。
- `stepCompletion: manual` の workflow では command / result step にも表示する。
- それ以外の agent / command / result step では折りたたみの詳細項目として表示してよい。

### 10.2 validation / warning

Builder の step draft validation に次を追加する。

| 条件 | severity | message |
| --- | --- | --- |
| `type: manual` かつ `userAction.message` も `prompt` も空 | warning | 手動 step ですが、利用者向け操作メッセージがありません。 |
| `completeLabel` が長すぎる | warning | ボタン文言が長いため GUI で折り返される可能性があります。 |
| `confirmOnComplete: true` かつ `confirmMessage` が空 | info | 既定の確認文を使います。 |
| `userAction.message` に `command:` URI らしき文字列がある | warning | メッセージ内の command URI はリンクとして実行されません。 |

保存前の `validateWorkflowText` は従来通り最終防衛線にする。

### 10.3 Serializer / Loader

`WorkflowAuthoringStepBase` に `userAction?: WorkflowUserActionDefinition` を追加する。

- `workflowAuthoringSerializer.ts`: `serializeStep(...)` の base に `userAction` を含める。
- `workflowAuthoringLoader.ts`: 既存 `WORKFLOW.md` の `userAction` を GUI model へ読み込む。
- `workflowAuthoringDefaults.ts`: `manual-checklist` template に userAction の例を追加する。
- `workflowBuilderHelpCatalog.ts`: `userAction.message` / `completeLabel` / `confirmOnComplete` の説明を追加する。
- `workflowBuilderHelpIds.ts`: Help ID を追加する。

### 10.4 Preview

Step detail の User action section には、小さなプレビューを置く。

```text
実行時の表示イメージ
+-----------------------------------+
| 操作内容                           |
| ...                               |
| [確認完了]                         |
+-----------------------------------+
```

初期版では template 変数は未展開のまま表示し、`{{inputs.xxx}}` は「実行時に置換されます」と補足する。

## 11. セキュリティ・安全性

- `userAction.message` は信頼できない入力として扱い、HTML escape する。
- Webview CSP を設定し、inline script は nonce 付きの既存方式に合わせる。
- `command:` URI や raw HTML は自動リンク化しない。
- 完了ボタン押下では active key / runId / stepId の整合を host 側で確認する。
- 二重クリック対策として、押下直後にボタンを disabled にし、host 側でも active step 削除済みなら idempotent なメッセージを返す。
- `confirmOnComplete` が有効な場合は VS Code の `showWarningMessage(..., { modal: true })` または Webview 内確認を使う。
- `captureHeldStepResult(...)` と guardrails は既存経路を必ず通し、GUI button で bypass しない。

## 12. テスト計画

### 12.1 Core schema / parser

```text
extensions/workflow-register/test/workflowUserActionSchema.test.js
```

- `steps[].userAction.message` を含む `WORKFLOW.md` が validate / parse できる。
- unknown property は引き続き fail する。
- `userAction` 未指定の workflow が従来通り parse できる。
- `message` / `confirmMessage` の template 変数が render できる。

### 12.2 Authoring round-trip

```text
extensions/workflow-register/test/workflowAuthoringUserAction.test.js
```

- GUI model の `userAction` が YAML に出力される。
- 既存 `WORKFLOW.md` の `userAction` が loader で保持される。
- `manual-checklist` template に既定 userAction が入る。
- edit mode で unknown front matter と body を壊さない。

### 12.3 StepRuntime

```text
extensions/workflow-register/test/bobStepRuntimeManualPanel.test.js
```

- `completeStepByKey(activeKey)` が対象 active step だけを完了する。
- 複数 active step がある場合に key 指定で取り違えない。
- `captureHeldStepResult` 失敗時は complete しない。
- 二重完了要求では分かりやすいメッセージを返す。

### 12.4 Webview

```text
extensions/workflow-register/test/manualStepPanel.test.js
```

- message / completeLabel が HTML に表示される。
- HTML / script injection が escape される。
- 完了ボタンが `completeManualStep` message を送る。
- 完了後にボタンが disabled になる。
- active task がない held run では read-only 復帰案内になる。

### 12.5 Integration smoke

- Bob UI 実行で `type: manual` step に入る。
- Manual Step Panel が自動表示される。
- `WORKFLOW.md` の `userAction.message` が表示される。
- 完了ボタンで `task.setStepComplete()` が呼ばれ、run が次 step へ進む。
- Command Palette の `workflowRegister.completeCurrentStep` は従来通り使える。

## 13. 実装フェーズ

### Phase 1: schema / model / authoring round-trip

- `WorkflowUserActionDefinition` を追加する。
- `workflowV1Schema`、parser normalizer、validator を更新する。
- authoring model / serializer / loader に追加する。
- unit test と round-trip test を追加する。

受け入れ条件:

- `userAction` を含む `WORKFLOW.md` が validate / parse / serialize / load できる。
- `userAction` 未指定 workflow の出力差分が発生しない。

### Phase 2: Manual Step Panel MVP

- active step を表示する Webview panel を追加する。
- `StepRuntime.completeStepByKey(...)` を追加する。
- panel の完了ボタンから既存完了経路へ接続する。
- message fallback と HTML escape を実装する。

受け入れ条件:

- manual step で panel が開き、`完了` ボタンで step 完了できる。
- 複数 active step でも key 指定で正しい step だけ完了できる。
- Command Palette の既存完了導線は壊れない。

### Phase 3: Bob UI / Run Control 連携

- workflow control block に `Open manual step page` を追加する。
- Run Control View の held run context menu から panel を開けるようにする。
- active task がない held run の read-only 表示を実装する。

受け入れ条件:

- Bob chat / TreeView / Command Palette のいずれからも手動操作ページへ到達できる。
- active handle が無い場合に誤って完了扱いにしない。

### Phase 4: GUI Builder 反映

- Step detail に User action section を追加する。
- step draft validation に warning を追加する。
- Help catalog / Help ID / preview を追加する。
- `manual-checklist` template を更新する。

受け入れ条件:

- GUI で `userAction.message` と `completeLabel` を編集できる。
- 保存後の `WORKFLOW.md` に `userAction` が出力される。
- 既存 `WORKFLOW.md` 編集時に `userAction` を読み込んで再保存できる。

### Phase 5: ドキュメント更新

- `extensions/workflow-register/README.md` に User Action の書き方を追記する。
- `extensions/workflow-register/docs/detailed-design-ja.md` の StepRuntime / GUI Builder 章を更新する。
- `docs/workflow-register-gui-authoring-implementation-notes-ja.md` に実装メモを追記する。

受け入れ条件:

- 利用者向け README だけで `userAction` の基本利用例が分かる。
- 実装者向け詳細設計に runtime / Webview / Builder の責務が反映される。

## 14. 既存仕様への影響

| 領域 | 影響 |
| --- | --- |
| `type: manual` | `userAction` があれば GUI 表示に使う。無ければ `prompt` fallback。 |
| `stepCompletion: manual` | command / result step 後の手動完了待ちにも `userAction` を使える。 |
| `stepReview` | 既存の reviewing / accept / retry とは分離する。 |
| `prompt` | 既存意味を維持する。manual step では fallback として GUI 表示にも使う。 |
| Bob UI step 表示 | `stepExecution.mode` の挙動は変えない。manual panel は補助 GUI。 |
| Standalone 実行 | Bob task が無いため完了ボタンは使わない。既存の held / resume 経路を維持する。 |

## 15. リスクと対策

| リスク | 対策 |
| --- | --- |
| `WORKFLOW.md` 由来の HTML injection | HTML escape / CSP / command URI 無効化。 |
| active step 取り違え | `activeKey` と `runId` / `stepId` の整合確認。 |
| VS Code 再起動後に完了できない | read-only 表示と resume 案内を出す。初期版では復元しない。 |
| `prompt` と `userAction.message` の役割が曖昧 | Builder 上で「AI/step instruction」と「利用者向け操作手順」を説明し、manual step では fallback 関係を明記する。 |
| button 完了が guardrails / result handoff を bypass する | `completeStepByKey` でも既存 `captureHeldStepResult(...)` helper を必ず通す。 |
| workflow 設計者が長文を書きすぎる | Builder preview、sticky footer、validator warning。 |

## 16. 実装対象ファイル候補

```text
extensions/workflow-register/package.json
extensions/workflow-register/src/extension.ts
extensions/workflow-register/src/extensionWithAuthoring.ts
extensions/workflow-register/src/bobStepRuntime.ts
extensions/workflow-register/src/bobWorkflowMessages.ts
extensions/workflow-register/src/bobWorkflowTypes.ts
extensions/workflow-register/src/core/model.ts
extensions/workflow-register/src/core/workflowSchema.ts
extensions/workflow-register/src/core/parser/normalizers.ts
extensions/workflow-register/src/core/workflowValidator.ts
extensions/workflow-register/src/core/workflowAuthoringModel.ts
extensions/workflow-register/src/core/workflowAuthoringSerializer.ts
extensions/workflow-register/src/core/workflowAuthoringLoader.ts
extensions/workflow-register/src/core/workflowAuthoringDefaults.ts
extensions/workflow-register/src/webview/manualStepPanel.ts
extensions/workflow-register/src/webview/manualStepHtml.ts
extensions/workflow-register/src/webview/manualStepStyles.ts
extensions/workflow-register/src/webview/manualStepScript.ts
extensions/workflow-register/src/webview/workflowBuilderClientScript.ts
extensions/workflow-register/src/webview/workflowBuilderHelpCatalog.ts
extensions/workflow-register/src/webview/workflowBuilderHelpIds.ts
extensions/workflow-register/test/workflowUserActionSchema.test.js
extensions/workflow-register/test/workflowAuthoringUserAction.test.js
extensions/workflow-register/test/bobStepRuntimeManualPanel.test.js
extensions/workflow-register/test/manualStepPanel.test.js
```

## 17. Codex / 実装依頼向け分割

1. `WorkflowUserActionDefinition` と schema / parser / authoring serializer / loader の round-trip を追加する。
2. `StepRuntime.completeStepByKey` と `ManualStepActionViewModel` を追加し、unit test を作る。
3. Manual Step Panel Webview MVP を追加し、active step の message 表示と完了ボタンを接続する。
4. Bob control block と Run Control View から panel を開く導線を追加する。
5. GUI Builder の Step detail に User action section、help、validation、preview を追加する。
6. README / detailed design / implementation notes を更新する。

## 18. 最小受け入れシナリオ

次の `WORKFLOW.md` を GUI Builder で作成・保存でき、Bob UI 実行時に GUI ページから完了できること。

```md
---
schemaVersion: workflow-register/v1
name: manual-action-sample
description: 手動操作 GUI の確認用 workflow
title: 手動操作 GUI サンプル
mode: agent
workspaceRequired: true
stepExecution:
  mode: engineSteps
  allowOutOfOrder: false
  showInBob: true
steps:
  - id: check-file
    title: ファイル確認
    type: manual
    required: true
    userAction:
      message: |
        `.bob/workflows/manual-action-sample/WORKFLOW.md` を開き、内容を確認してください。

        確認できたら完了ボタンを押してください。
      completeLabel: 確認できたので完了
      confirmOnComplete: true
      confirmMessage: ファイル確認を完了済みとして次へ進みます。よろしいですか？
  - id: done
    title: 完了メッセージ
    type: result
    result:
      source: literal
      text: 手動確認が完了しました。
      sinks:
        - type: file
          path: .bob/artifacts/manual-action-sample-result.txt
---
# 手動操作 GUI サンプル
```

確認観点:

- `check-file` step で Manual Step Panel が開く。
- `userAction.message` が表示される。
- ボタン文言が `確認できたので完了` になる。
- 押下時に確認メッセージが表示される。
- 承認後に step が完了し、次 step へ進む。
- `workflowRegister.completeCurrentStep` でも従来通り完了できる。
