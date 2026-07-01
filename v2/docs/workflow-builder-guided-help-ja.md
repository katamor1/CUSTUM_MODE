# Workflow Builder Guided Help

## 背景

Workflow Builder の設定項目が増えたため、静的ヘルプパネルだけでなく、設定中の文脈に応じて作業を案内する必要がある。

本変更では次の改善をまとめて行う。

1. Help Target 明示化
2. Step type ごとの設定ガイド
3. 選択肢の表示ラベル改善
4. Diagnostics から設定項目への誘導
5. Webview Client Script 分割
6. Help ID Registry 化

## 1. Help Target 明示化

従来は `workflowBuilderHelpScript.ts` が DOM を観察し、`data-*` から help id を推定していた。

今後は重要な入力要素に描画時点で `data-help-id` を付与する。

主な対象:

- `templateSelect`
- `steps[].type`
- `steps[].prompt`
- `steps[].includeState`
- `steps[].action.*`
- `steps[].result.*`
- `artifacts[].producedBy`

これにより、label と select が離れている場合でも `?` ボタンと対象 field の対応が安定する。

## 2. Step type ごとの設定ガイド

`Step detail` では選択中 step type に応じて、設定順を示す guide card を表示する。

例:

- `agent`: prompt、includeState、resultKey。
- `command`: action.provider、args、resultKey、sendResult、completeOnSuccess。
- `manual`: prompt、includeState、人間確認。
- `result`: source、stateKey / literal text、file sink path、artifacts.producedBy。

## 3. 選択肢の表示ラベル改善

内部値は変更せず、select option の表示だけ補足つきにする。

例:

```text
agent — AI に分析・生成させる
command — 拡張機能の処理を実行
collect-context — コンテキスト収集 / command
reviewResultJson — レビュー結果JSON生成 / agent
```

対象:

- `steps[].type`
- `steps[].result.source`
- `steps[].result.stateKey`
- `artifacts[].producedBy`
- `templateSelect`

## 4. Diagnostics から設定項目への誘導

Preview / Diagnostics の診断や参照チェックに、関連設定へ移動する link を表示する。

例:

- `includeState` の unknown / forward reference → Step detail の `includeState`。
- `Artifact producedBy` の参照切れ → Artifacts の `producedBy`。
- `resultKey` 関連 → Step detail の `resultKey`。
- `guardrails` 関連 → Guardrails。
- `input options` 関連 → Inputs。

link を押すと対象タブへ移動し、可能な場合は該当 field に focus し、右側ヘルプも該当項目へ切り替える。

## 5. Webview Client Script 分割

`workflowBuilderClientScript.ts` は大きくなっているため、機能単位で段階的に分割する。

今回の分割対象:

- `workflowBuilderGuidedHelpScript.ts`
  - `stepTypeGuideHtml`
  - `stepOptionLabel`
  - `resultKeyOptionLabel`
  - `diagnosticTarget`
  - `diagnosticLinkHtml`
  - `renderDiagnosticsList`
  - `gotoHelpTarget`

`workflowBuilderHtml.ts` は、`renderWorkflowBuilderClientScript()` の後に `renderWorkflowBuilderGuidedHelpScript()` を合成する。

## 6. Help ID Registry 化

`workflowBuilderHelpIds.ts` を追加し、help id を定数化する。

目的:

- help id の typo を減らす。
- renderer、help catalog、diagnostics 誘導先の対応を確認しやすくする。
- 将来、catalog に存在しない help id を test で検出できるようにする。

主な公開値:

```ts
WorkflowBuilderHelpIds.StepPrompt
WorkflowBuilderHelpIds.StepIncludeState
WorkflowBuilderHelpIds.CommandProvider
WorkflowBuilderHelpIds.ResultSource
WorkflowBuilderHelpIds.ArtifactProducedBy
workflowBuilderHelpIdValues
isWorkflowBuilderHelpId()
```

## 非対象

- Diagnostics の完全な構文解析。
- エラーごとの自動修正。
- AI による動的説明生成。
- workflow 定義の保存ロジック変更。
- `workflowBuilderClientScript.ts` の全面分割。

これらは後続 phase の候補とする。
