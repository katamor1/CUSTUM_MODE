# workflow-register Step 確定前確認 GUI 整備計画

## 1. 背景

`workflow-register` の GUI Builder は、step、inputs、artifacts、guardrails、requires、preflight、completion を編集できる段階まで拡張されている。

既存計画では、保存前に `validateWorkflowText` を実行し、`resultKey` / `includeState` / `artifacts.producedBy` の参照関係も GUI 上で把握できるようにしている。

しかし、複数の入力項目を持つ step では、個別フィールドの onChange をそのまま `WorkflowAuthoringModel` に反映すると、編集中の一時的な不整合が常に画面全体へ波及する。

例:

- `type` を `agent` から `command` に変える途中で `action.provider` / `args[0]` が未入力になる。
- `resultKey` を変更中に、後続 step の `includeState` が一時的に孤立する。
- `result.source` を `state` へ切り替える途中で `stateKey` が未選択になる。
- `sendResult` を有効化したが、`resultKey` / `maxResultBytes` / `completeOnSuccess` の意図が揃っていない。
- `includeState` と `stateRequired` の組み合わせが、step の実行意図とずれる。

この計画では、step 詳細編集に「仮編集 -> 整合性確認 -> 確定」という境界を追加する。

## 2. ゴール

- 複数入力項目を持つ step で、編集中の一時不整合を全体 model に即時反映しない。
- step 内の項目間整合性を、確定前に分かりやすく表示する。
- step 間参照への影響を、確定前に提示する。
- error がある場合は確定を止める。
- warning は利用者が理解した上で確定できる。
- 既存の `validateWorkflowText` と `workflowAuthoringReferenceAnalysis` を保存前の最終防衛線として残す。

## 3. 非ゴール

- Bob 本体の workflow 実行 UI を置き換えない。
- YAML の全表現を modal 上で完全編集できるようにはしない。
- AI に確定判断を委ねない。
- provider 別の完全な args schema を初期版で網羅しない。

## 4. UI 方針

### 4.1 Step 編集を transaction として扱う

現在の選択 step を直接更新するのではなく、Step 詳細ペインで編集を開始した時点で `draftStep` を作る。

```text
current WorkflowAuthoringModel
  -> selected step を clone
  -> draftStep を編集
  -> step validation / impact analysis
  -> Apply で model.steps[index] に反映
```

`draftStep` が dirty の間は、step 一覧に `未確定` バッジを表示する。

### 4.2 画面構成

```text
+--------------------------------------------------------------+
| Step detail: collect-document-candidates                     |
+-----------------------------+--------------------------------+
| 編集フォーム                | 確定前チェック                 |
|                             |                                |
| Basic                       | Status: error / warning / ok    |
| - id                        |                                |
| - title                     | Step 内チェック                |
| - type                      | - 必須項目                     |
|                             | - type 別整合                  |
| Execution                   | - provider / args              |
| - required                  | - resultKey / sendResult        |
| - stateRequired             |                                |
| - maxResultBytes            | Step 間影響                    |
|                             | - includeState 参照             |
| Type specific               | - producedBy 参照               |
| - prompt / action / result  | - downstream impact             |
|                             |                                |
| References                  | YAML preview diff              |
| - includeState              |                                |
+-----------------------------+--------------------------------+
| [Validate] [Apply changes] [Discard] [Open full diagnostics] |
+--------------------------------------------------------------+
```

### 4.3 確定ボタンの状態

| 状態 | Apply changes |
| --- | --- |
| error あり | disabled |
| warning のみ | enabled。押下時に warning summary を表示 |
| ok | enabled |
| dirty なし | disabled |

## 5. チェック分類

### 5.1 field local check

個別項目だけで判定できるもの。

- `id` が空でない。
- `id` が許可文字のみ。
- `title` が空でない。
- `type` が `agent` / `command` / `manual` / `result` のいずれか。
- `maxResultBytes` が正の数。
- file path が workspace 外へ出ない。

### 5.2 intra-step check

step 内の複数項目の組み合わせを見る。

#### agent step

- `prompt` が空でない。
- `includeState` がある場合、prompt に state 利用意図があるか warning を出す。
- `stateRequired: true` なのに `includeState` が空なら error。

#### command step

- `action.provider` が空でない。
- `provider: vscode.executeCommand` の場合、`args[0]` が command id として入力されている。
- `sendResult: true` かつ後続 step が参照する意図がある場合、`resultKey` 未設定は warning。
- `completeOnSuccess: true` で `required: false` の場合、意図確認 warning。
- `maxResultBytes` 未設定で `sendResult: true` の場合、巨大出力 warning。

#### manual step

- `prompt` が空でない。
- `stateRequired: true` なのに `includeState` が空なら error。
- 人間確認 step なのに `completeOnSuccess` が指定されている場合は warning。

#### result step

- `result.source` が `state` の場合、`stateKey` が必須。
- `result.source` が `literal` の場合、literal text が必須。
- file sink path が空でない。
- file sink path が workspace 外でない。
- `result.stateKey` が同一 step 自身の `resultKey` を参照していない。

### 5.3 inter-step impact check

確定後の model 全体を一時的に組み立てて、参照影響を見る。

- `id` 変更で `artifacts.producedBy` が孤立しないか。
- `resultKey` 変更で後続 step の `includeState` / `result.stateKey` が孤立しないか。
- `includeState` が前段 step の `resultKey` だけを参照しているか。
- step type 変更により、既存の type-specific field が捨てられるか。
- 並び順上、参照元が後段になっていないか。

### 5.4 workflow-level preview check

`draftStep` を反映した仮 model を serialize し、既存 validator を実行する。

```text
draft model
  -> serializeAuthoringModelToMarkdown
  -> validateWorkflowText
  -> diagnostics
```

この結果は、step 確定前チェックの下部に summary として表示する。

## 6. 操作仕様

### 6.1 Apply changes

1. `draftStep` を検証する。
2. 仮 model を作り、step 間 impact を分析する。
3. `validateWorkflowText` を実行する。
4. error がなければ `model.steps[index] = draftStep` を実行する。
5. `dirtyStepDraft` を clear する。
6. Preview / Diagnostics を更新する。

### 6.2 Discard

- `draftStep` を破棄し、現在の model の step に戻す。
- dirty バッジを消す。
- warning summary も clear する。

### 6.3 Type 変更時

`type` 変更は破壊的になりやすいので、即時変換せず確認を挟む。

```text
step type を command から agent へ変更します。
次の field は agent step では使われません。
- action.provider
- action.args
- sendResult

[変更する] [キャンセル]
```

初期版では、不要 field は model から削除する。将来版では `typeSpecificBackup` として戻せるようにしてもよい。

### 6.4 参照変更時

`id` / `resultKey` 変更では、後続参照を自動修復するか確認する。

選択肢:

- `参照も更新する`: `includeState` / `result.stateKey` / `artifacts.producedBy` を新しい値へ置換する。
- `参照は残す`: warning / error として残す。
- `キャンセル`

初期実装では、`参照は残す` と `キャンセル` のみでもよい。自動修復は Phase 2 に回す。

## 7. 実装方針

### 7.1 追加する core module

```text
extensions/workflow-register/src/core/workflowAuthoringStepDraftValidation.ts
```

責務:

- `validateStepDraft(...)`
- `analyzeStepDraftImpact(...)`
- `buildDraftWorkflowForStep(...)`
- error / warning / info の分類

戻り値例:

```ts
type StepDraftValidationResult = {
  status: "ok" | "warning" | "error"
  diagnostics: StepDraftDiagnostic[]
  affectedReferences: StepDraftReferenceImpact[]
  workflowDiagnostics: WorkflowDiagnostic[]
}
```

### 7.2 追加する Webview module

```text
extensions/workflow-register/src/webview/workflowBuilderStepDraftScript.ts
```

責務:

- `draftStep` state の管理。
- Step 詳細フォームの dirty 管理。
- Validate / Apply / Discard ボタン。
- 確定前チェックパネル描画。
- type 変更確認。
- id / resultKey 変更影響の表示。

### 7.3 host / Webview message

既存の `preview` / `save` に加えて、step draft 用 message を追加する。

| message | 用途 |
| --- | --- |
| `validateStepDraft` | Webview の draft step と model snapshot を host に渡し、core validation 結果を受け取る。 |
| `previewStepDraft` | draft step を反映した YAML preview と diagnostics を受け取る。 |

最初は Webview 内だけで可能な check を先に実装し、`validateWorkflowText` が必要な preview check だけ host に投げる構成でもよい。

## 8. 実装フェーズ

### Phase 1: UI transaction 化

- Step 詳細編集に `draftStep` を導入する。
- Apply / Discard を追加する。
- dirty バッジを表示する。
- error なしなら Apply できる最小チェックを入れる。

受け入れ条件:

- フォーム編集中は model 本体へ即時反映されない。
- Apply でだけ model に反映される。
- Discard で元に戻る。

### Phase 2: step 内整合チェック

- agent / command / manual / result の type 別チェックを追加する。
- `stateRequired` と `includeState` の整合を確認する。
- `sendResult` / `resultKey` / `maxResultBytes` の warning を追加する。

受け入れ条件:

- error がある step は Apply できない。
- warning は summary 確認後に Apply できる。

### Phase 3: step 間影響チェック

- `workflowAuthoringReferenceAnalysis` と連携し、仮 model で参照影響を見る。
- `id` / `resultKey` 変更による downstream impact を表示する。
- `artifacts.producedBy` への影響を表示する。

受け入れ条件:

- 既存参照を壊す変更が確定前に分かる。
- 参照エラーの対象 step / artifact へ移動できる。

### Phase 4: workflow-level preview check

- draft step を反映した仮 workflow を serialize し、`validateWorkflowText` を実行する。
- その diagnostics を step 確定前チェックに表示する。

受け入れ条件:

- Apply 前に保存時 validator とほぼ同じエラーを確認できる。
- Diagnostics から該当 field へ移動できる。

### Phase 5: 自動修復支援

- `id` / `resultKey` 変更時に参照も更新する option を追加する。
- type 変更時に不要 field の削除差分を表示する。
- 可能なら `includeState` 候補を自動再選択する。

受け入れ条件:

- 参照変更の修正が手作業だけに依存しない。
- 自動修復は必ず preview 付きで、人間が確定する。

## 9. テスト計画

### unit test

```text
extensions/workflow-register/test/workflowAuthoringStepDraftValidation.test.js
```

主なケース:

- command step で `action.provider` が空なら error。
- command step で `sendResult: true` かつ `maxResultBytes` 未設定なら warning。
- manual / agent step で `stateRequired: true` かつ `includeState` 空なら error。
- result step で `source: state` かつ `stateKey` 空なら error。
- `resultKey` 変更が後続 `includeState` に影響することを検出する。
- `id` 変更が `artifacts.producedBy` に影響することを検出する。

### Webview module test

```text
extensions/workflow-register/test/workflowBuilderStepDraftScript.test.js
```

主なケース:

- dirty step の Apply / Discard UI が存在する。
- error 時に Apply button が disabled になる。
- warning 時に warning summary が表示される。
- diagnostics link が対象 field へ移動できる。

### round-trip test

既存の serializer / loader test に、draft 確定後の model が従来と同じ `WORKFLOW.md` を生成できることを追加する。

## 10. 既存構成への影響

- `workflowBuilderPanel.ts` は VS Code panel 制御に留める。
- HTML shell は `workflowBuilderHtml.ts` で script fragment を合成するだけにする。
- Step draft UI は `workflowBuilderClientScript.ts` へ直書きせず、専用 script へ分割する。
- 保存前の `validateWorkflowText` は引き続き必須にする。
- 既存の Preview / Diagnostics / Diff / Save path は壊さない。

## 11. 優先度

最優先は Phase 1〜3 である。

`code-consistency-review` のように、traceability draft、catalog、gate、review-input、preprocess など複数 command step が連続する workflow では、1つの step の `provider`、`args`、`resultKey`、`includeState` の不整合が後続へ広く波及する。

そのため、保存前の全体 validator だけでなく、step 確定前に局所的に確認できる GUI が必要である。

## 12. Codex / 実装依頼向け分割

1. `workflowAuthoringStepDraftValidation.ts` を追加し、unit test を先に作る。
2. `workflowBuilderStepDraftScript.ts` を追加し、Apply / Discard / dirty 表示だけを実装する。
3. command / result step の type 別 check を接続する。
4. `workflowAuthoringReferenceAnalysis` を使って step 間 impact を接続する。
5. Webview module test を追加する。
6. README / implementation notes に Phase 8 として追記する。

