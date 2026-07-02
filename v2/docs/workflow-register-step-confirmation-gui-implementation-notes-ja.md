# workflow-register Step 確定前確認 GUI 実装メモ

## 実装範囲

`docs/workflow-register-step-confirmation-gui-plan-ja.md` の Phase 1〜5 を中心に、Step detail の仮編集、確定前チェック、host 側 workflow-level preview check、参照自動修復支援を追加した。

## 追加した主な機能

- Step detail の入力を `draftStep` として保持し、main `WorkflowAuthoringModel` へ即時反映しない。
- `Apply changes` / `Discard` / `Validate step` を Step detail の先頭に表示する。
- 未確定変更がある場合、step カードに `未確定` バッジを表示する。
- error が残っている draft は `Apply changes` を disabled にする。
- warning だけの場合は確認後に Apply できる。
- 未確定のまま別 step / 別 tab / template 反映 / step 操作へ移動しようとした場合、破棄確認を出す。
- command / result / agent / manual の type 別チェックを Webview 内で即時表示する。
- `id` / `resultKey` 変更が `artifacts.producedBy` や後続 `includeState` に与える影響を Apply 前に表示する。
- `Validate step` で extension host に `validateStepDraft` message を送り、`validateWorkflowText` による workflow-level diagnostics も表示する。
- `Apply + update refs` で、`id` / `resultKey` の単純 rename に伴う安全な参照更新を一括適用できる。

## 追加ファイル

```text
extensions/workflow-register/src/core/workflowAuthoringStepDraftValidation.ts
extensions/workflow-register/src/core/workflowAuthoringStepDraftRepair.ts
extensions/workflow-register/src/webview/workflowBuilderStepDraftScript.ts
extensions/workflow-register/src/webview/workflowBuilderStepDraftRepairScript.ts
extensions/workflow-register/test/workflowAuthoringStepDraftValidation.test.js
extensions/workflow-register/test/workflowBuilderStepDraftScript.test.js
```

## 変更ファイル

```text
extensions/workflow-register/src/webview/workflowBuilderPanel.ts
extensions/workflow-register/src/webview/workflowBuilderHtml.ts
extensions/workflow-register/src/webview/workflowBuilderStyles.ts
extensions/workflow-register/src/webview/README.md
```

## Core validation

`workflowAuthoringStepDraftValidation.ts` は、Webview から独立してテスト可能な step draft 検証ロジックである。

主な検出対象:

- step id / title / type / maxResultBytes の基本チェック。
- `stateRequired: true` なのに `includeState` が空。
- command step の `action.provider` 欠落。
- `provider: vscode.executeCommand` なのに `args[0]` が空。
- `sendResult: true` なのに `resultKey` が空、または `maxResultBytes` が未設定。
- result step の `source: state` で `stateKey` が空。
- result step の file sink path 欠落。
- `resultKey` 変更で後続 `includeState` / `result.stateKey` が孤立する。
- `id` 変更で `artifacts.producedBy` が孤立する。

## Core repair

`workflowAuthoringStepDraftRepair.ts` は、Step draft UI が提供する安全な参照更新を純粋関数として実装する。

更新対象は exact rename に限定する。

- `originalStep.id -> draftStep.id` の変更に伴い、`artifacts[].producedBy` を更新する。
- `originalStep.resultKey -> draftStep.resultKey` の変更に伴い、後続 step の `includeState[]` を更新する。
- `originalStep.resultKey -> draftStep.resultKey` の変更に伴い、後続 result step の `result.stateKey` を更新する。

推測による欠落補完、step 並び替え、type-specific field の復元は行わない。

## Host validation

`workflowBuilderPanel.ts` に `validateStepDraft` message を追加した。

```text
Webview draftStep
  -> validateStepDraft message
  -> core validateStepDraft
  -> draftStep を仮反映した WorkflowAuthoringModel
  -> serializeAuthoringModelToMarkdown
  -> validateWorkflowText
  -> stepDraftValidationResult message
```

Webview は `stepDraftValidationResult` を受け取り、Step detail の確定前チェックパネル内に Host validation と workflow-level diagnostics を表示する。

## Webview integration

`workflowBuilderStepDraftScript.ts` は、既存 `workflowBuilderClientScript.ts` を全面改修せず、後段の script fragment として合成する。

Phase 5 の参照更新支援は `workflowBuilderStepDraftRepairScript.ts` に分離した。

`workflowBuilderHtml.ts` の合成順序は次のとおり。

```text
renderWorkflowBuilderClientScript()
renderWorkflowBuilderStepDraftScript()
renderWorkflowBuilderStepDraftRepairScript()
renderWorkflowBuilderGuidedHelpScript()
renderWorkflowBuilderBodyScript()
renderWorkflowBuilderHelpScript()
```

Step draft script は、既存の `handleFieldEvent` を一度 remove し、Step detail に関係する field だけ draftStep へ反映する wrapper を再登録する。Step 以外の inputs / requires / preflight / artifacts / guardrails / completion は既存 handler へ委譲する。

`workflowBuilderStepDraftRepairScript.ts` は、既存の確定前チェックパネルへ `Apply + update refs` を差し込み、修復可能な参照エラーだけを対象に一括更新する。

## テスト

追加したテストは次の観点を確認する。

- command step の provider 欠落。
- `sendResult` と `maxResultBytes` の warning。
- `stateRequired` と `includeState` の不整合。
- `resultKey` 変更による後続 `includeState` 影響。
- `id` 変更による `artifacts.producedBy` 影響。
- `id` 変更時に `producedBy` を修復できること。
- `resultKey` 変更時に `includeState` と `result.stateKey` を修復できること。
- Webview HTML に step draft / step draft repair script が help decoration より前に合成されること。

## 今後の残件

- warning 表示から対象 field へ focus するリンクを追加する。
- provider 別 args schema が取得できるようになったら、command step の args UI を provider ごとに分ける。
