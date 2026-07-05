# 3拡張機能の責務分割見直し（基準: 54e1fe58）

基準コミット: `54e1fe58b47c9469dbcaba9d2af5aded3ff1083f`

この文書は、`bob_builtin_analyze` に含まれる主要3拡張機能について、中程度以下の AI が安全に読み書きしやすい単位へ分割する観点で見直した結果をまとめる。

最終確認時点では、`workflow-register` の低リスク helper 分離と `StepRuntime` 分離、`bob-bazaar-review` の Bazaar review command / review-result validation command 分離、`bob-code-consistency-review` の traceability / review execution / review-input command 分離まで反映済みである。

## 対象拡張

| 拡張 | 主な役割 | 現状評価 |
|---|---|---|
| `extensions/workflow-register` | `.bob/workflows/*/WORKFLOW.md` の登録、実行、step review、Bob連携 | parser / engine / reports / Bob API helper は分割済み。`bobStepRuntime.ts` に `StepRuntime` を分離済み。 |
| `extensions/bob-bazaar-review` | Bazaar 差分・リビジョン範囲からレビュー packet を作成し Bob へ渡す | workflow-register bridge、Bazaar review command、review-result validation command を分離済み。`extension.ts` は command 登録と小さな orchestration に寄っている。 |
| `extensions/bob-code-consistency-review` | 要求・設計・テスト仕様とコード変更の整合プレレビュー用 input / preprocess / output 検証 | command option / wizard / workflow provider / workspace initializer / traceability commands / review execution commands / review-input commands を分離済み。次は追加分割ではなく contract と成果物 metadata の drift 防止が対象。 |

## 1. workflow-register

### 現状

`parser.ts` は facade 化され、実体は `core/parser/` 配下へ分割済み。`engine.ts` も `engine/preflight.ts`、`engine/runState.ts`、`engine/templateRenderer.ts` へ helper が分離済み。

Bob UI 実行 adapter である `src/bobWorkflowRunner.ts` から、比較的低リスクな helper は外へ出した。

### 実施済みの分割

| ファイル | 責務 |
| --- | --- |
| `src/bobApi.ts` | Bob 拡張 API の取得、activation error の記録、source-like object への安全な変換。 |
| `src/reports.ts` | attempt 実行、戻り値説明、Markdown report 表示。 |
| `src/bobWorkflowFactory.ts` | Bob workflow object と Bob step array の構築。 |
| `src/bobWorkflowMessages.ts` | workflow 開始、step 継続、command result、workflow state block の message 生成。 |
| `src/bobTaskInputs.ts` | Bob task metadata / message から workflow input を抽出。 |
| `src/taskSnapshotRecovery.ts` | task snapshot から最新 assistant text を復元。 |
| `src/resultHandoff.ts` | assistant 出力を file / command sink へ渡す。 |

既存の外部 import を壊さないよう、`bobWorkflowRunner.ts` から `createBobWorkflow` / `extractTaskWorkflowInputs` / `recoverResultTextFromSnapshots` を再 export している。

### 現在の Bob UI 実行責務

- `BobWorkflowEngineRunner`
- `src/bobStepRuntime.ts` の `StepRuntime`
- Bob task と `WorkflowEngine` の接続
- Bob chat への step message / command result / agent output 同期
- `WorkflowExecutionHooks` から task snapshot を保存する処理
- manual completion 待ちと `task.setStepComplete()` の同期
- result handoff 失敗時の復旧候補取得

### 現在の次対象

`StepRuntime` は `src/bobStepRuntime.ts` へ分離済みである。次対象は追加分割ではなく、`docs/workflow-action-contracts-ja.md` で公開 API と provider ID を固定し、README / contract の drift 防止テストで古い記述が戻らないようにすることである。

## 2. bob-bazaar-review

### 現状

`src/extension.ts` は単体では極端に巨大ではないが、以前は複数責務が混在していた。現在は Bazaar review command と review-result validation command を切り出し、activation / provider registration / project rules / GUI 起動に近づけている。

### 実施済みの分割

#### `workflowRegisterBridge.ts`

workflow-register API 接続と workflow action input helper を分離した。

移動済み:

- `WORKFLOW_REGISTER_EXTENSION_ID`
- `WorkflowActionExecutionInput`
- `WorkflowActionProvider`
- `WorkflowRegisterApi`
- `getWorkflowRegisterApi`
- `isWorkflowRegisterExtensionAvailable`
- `firstStringArg`
- `initialTargetFromWorkflowInputs`
- `stringInput`
- `captureOptionsFromCommandArgs`
- workflow state から expected checklist count を読む private helper 群

#### `bazaarReviewCommands.ts`

Bazaar review packet 作成 command 群を分離した。

移動済み:

- `reviewRevision`
- `reviewRange`
- `buildProjectRulesSectionForWorkspace`
- `makeBazaarClient`
- `getMaxDiffBytes`
- `getMaxAddedFileContentBytes`
- `showAndOfferBobContext`
- `addPacketToBobContext`
- `withProgress`

#### `reviewResultValidationCommand.ts`

active editor / selection から review-result JSON を検証する command を分離した。

移動済み:

- `validateActiveReviewResultJson`

### 現在 `extension.ts` に残る責務

- VS Code command 登録
- workflow-register action provider 登録
- `collectReviewContext`
- `loadReviewRules`
- `configureMcp`
- `initProjectRules`
- Bob ワークスペースフォルダー解決
- 開いている Bazaar review packet の探索

### 次に切る対象

`extension.ts` は 160 行程度まで縮小しているため、直ちに追加分割しなくてもよい。さらに分けるなら、次の小粒度ファイルにする。

```text
src/workflowProviderRegistration.ts
src/projectRulesCommands.ts
src/mcpCommand.ts
src/reviewPacketFinder.ts
```

Command ID と workflow action provider ID は互換性に直結するため、分割時も名称は変更しない。

## 3. bob-code-consistency-review

### 現状

`src/extension.ts` は 700 行規模から大きく縮小し、現在は command 登録、workflow provider handler mapping、review-input 作成・AI draft・診断系 command handler の入口に寄っている。traceability と review execution は専用ファイルへ分離済み。

### 実施済みの分割

#### `extensionCommandOptions.ts`

移動済み:

- `notifyInfo`
- `notifyError`
- `requireBobWorkspaceRoot`
- `pickValue`
- `stringOrPrompt`
- `vcsOrPrompt`
- `changeTypeOption`
- `reviewFocusOption`
- `stringArrayOption`
- `splitCsv`
- `absolute`
- `optionalAbsolute`
- `stringOption`
- `booleanOption`
- `firstString`

#### `reviewInputWizard.ts`

移動済み:

- `collectReviewInputDraft`
- `collectReviewMetadata`
- `pickArtifacts`
- `stripCandidateUiFields`

注意点:

- `requireBobWorkspaceRoot` は `resolveBobWorkspaceRoot` と VS Code UI に依存するため、純粋 helper ではない。
- `reviewInputWizard.ts` は QuickPick / InputBox 依存があるが、review-input 作成 UI に閉じている。

#### `workflowProviderRegistration.ts`

移動済み:

- `optionRecord`
- workflow-register API の取得
- code consistency 用 action provider 登録
- command handler mapping から action provider への委譲

#### `workspaceInitializer.ts`

移動済み:

- `.bob/workflows/code-consistency-review/WORKFLOW.md` の初期化
- `review-input.yaml` 最小雛形の初期化
- 既存 workflow / review-input の backup 作成
- `docs/review-input-placeholder.md` の作成

#### `traceabilityCommands.ts`

移動済み:

- `runPrepareAiTraceabilityDraft`
- `runApplyAiTraceabilityDraft`
- `runValidateTraceabilityCatalog`
- `runCreateReviewInputFromTraceability`
- `runOpenTraceabilityPrep`

traceability 機能は AI draft、catalog merge、gate report、Webview、人間承認、review-input 生成までを含むため、`extension.ts` から外した状態を維持する。

#### `reviewExecutionCommands.ts`

移動済み:

- `runPreprocess`
- `runCaptureBobOutput`
- `runValidateOutput`
- `runTriage`

preprocess / capture / validate / triage は `.bob-review` 成果物を読み書きする実行系 command 群としてまとまった。

### 現在 `extension.ts` に残る責務

- VS Code command 登録
- `registerWorkflowProviders` に渡す handler mapping
- `runInitializeWorkspace`
- `runCreateReviewInput`
- `runPrepareAiReviewInputDraft`
- `runApplyAiReviewInputDraft`
- `runRepairReviewInput`
- `runExplainReviewInputDiagnostics`

### 現在の次対象

#### contract / metadata drift 防止

`reviewInputCommands.ts` は `src/commands/reviewInputCommands.ts` へ分離済みである。次対象は追加 VSIX 分割や shared package 化ではなく、workflow action contract、成果物 metadata、README / 設計文書の現状同期を drift 防止テストで固定することである。

## 推奨実施順

1. `workflow-register`: `bobWorkflowRunner.ts` の低リスク helper 分離（実施済み）
2. `bob-code-consistency-review`: `extensionCommandOptions.ts` へ helper 呼び出し移行（実施済み）
3. `bob-bazaar-review`: `workflowRegisterBridge.ts` へ bridge / helper 呼び出し移行（実施済み）
4. `bob-code-consistency-review`: `reviewInputWizard.ts` へ wizard 移行（実施済み）
5. `workflow-register`: `bobApi.ts` / `reports.ts` 追加（実施済み）
6. `bob-bazaar-review`: `bazaarReviewCommands.ts` / `reviewResultValidationCommand.ts` 分割（実施済み）
7. `bob-code-consistency-review`: `workflowProviderRegistration.ts` / `workspaceInitializer.ts` / `traceabilityCommands.ts` / `reviewExecutionCommands.ts` 分割（実施済み）
8. `bob-code-consistency-review`: `reviewInputCommands.ts`（実施済み）
9. `workflow-register`: `bobStepRuntime.ts`（実施済み）
10. 3拡張共通: workflow action contract と成果物 metadata contract の固定

## AI が扱いやすい粒度の目安

| ファイル種別 | 目安 |
|---|---|
| VS Code activation / command registration | 100〜180行 |
| command handler群 | 150〜300行 |
| pure builder / formatter / parser | 100〜250行 |
| UI wizard | 150〜300行 |
| runtime state machine | 200〜350行、ただし1責務に限定 |
| 型定義 | 長くても許容。ただし機能領域別に分ける |

## AI に任せにくい作業

- VS Code command ID / package.json contributes の整合変更
- Bob extension public API の互換性変更
- workflow-register action provider ID の変更
- result handoff / guardrail / manual completion の挙動変更
- task snapshot 形式の変更
- traceability item の正式承認状態の変更

これらは分割 PR では変更せず、関数移動と import 変更に限定する。
