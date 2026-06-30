# Workflow Builder Webview modules

`workflowBuilderPanel.ts` は VS Code extension host 側の WebviewPanel 制御だけを担当する。

Webview の表示とクライアント処理は次のファイルへ分割する。

| file | role |
| --- | --- |
| `workflowBuilderPanel.ts` | WebviewPanel 作成、preview / diff / save、backup、`workflowRegister.reload` 実行。 |
| `workflowBuilderHtml.ts` | HTML shell、CSP、nonce、初期 state、help catalog 埋め込み。 |
| `workflowBuilderStyles.ts` | Webview CSS。3カラムレイアウトとヘルプパネルも定義する。 |
| `workflowBuilderClientScript.ts` | Webview 内で動く form state / tab / preview / guardrails UI 処理。 |
| `workflowBuilderBodyScript.ts` | YAML front matter 以外の Markdown body 編集 UI を追加する補助 script。 |
| `workflowBuilderHelpCatalog.ts` | GUI 設定者向けの日本語ヘルプ文言と選択肢説明。 |
| `workflowBuilderHelpScript.ts` | 既存 form DOM へ `?` ボタン、field key、固定ヘルプパネル、検索、項目ジャンプを追加する補助 script。 |

## Extension host と Webview の境界

Webview client は `vscode.postMessage(...)` で extension host へ要求を送る。

主な message は次のとおり。

| message | host side behavior |
| --- | --- |
| `preview` | `WorkflowAuthoringModel` を Markdown 化し、`validateWorkflowText` を実行して diagnostics を Webview へ返す。 |
| `diff` | edit mode の既存 `WORKFLOW.md` と生成結果を VS Code diff で表示する。 |
| `save` | 生成結果を validate し、backup 作成後に `WORKFLOW.md` を保存する。 |
| `resetTemplate` | template から新しい `WorkflowAuthoringModel` を作り直して Webview に送る。 |

## Save path

```text
Webview form state
  -> WorkflowAuthoringModel
  -> serializeAuthoringModelToMarkdown
  -> validateWorkflowText
  -> backup if needed
  -> write WORKFLOW.md
  -> workflowRegister.reload
```

GUI が作った state でも、保存直前に必ず既存 validator を通す。これにより Webview 側の入力不整合がそのままファイルに保存されることを避ける。

## Contextual Help

`workflowBuilderHelpCatalog.ts` は、日本語の項目説明、効果、注意、YAML例、select の選択肢説明を持つ静的 catalog である。

`workflowBuilderHelpScript.ts` は既存のフォーム描画を大きく変更せず、DOM を観察して次を後付けする。

- ラベル横の `?` ボタン。
- `title` や `guardrails.requireApproval[].when` などの実フィールド名表示。
- 右側固定の `この項目の説明` パネル。
- input / select / textarea への focus 時のヘルプ切り替え。
- select の選択値に応じた選択肢説明。
- tab 切り替え時のタブ概要表示。
- ヘルプ catalog 全体を横断する日本語/英語検索。
- 検索結果クリックによる対象タブへの移動と対象 field への focus。
- テンプレート select と Step 追加ボタンへの説明。
- `includeState` / `Command` / `Result` 見出しへの説明。
- `template` / `producedBy` / `stateKey` / `includeState` の動的選択肢説明。

検索は `labelJa`、`fieldKey`、`summary`、`effect`、`whenToUse`、`caution`、`example`、選択肢説明を対象にする。たとえば `resultKey`、`承認`、`成果物`、`Bob`、`stop`、`テンプレート` などで検索できる。

この機能は Webview 内だけで完結し、serializer / loader / save path には影響しない。

## Guardrails tab

`guardrails.requireApproval` の GUI 編集は `workflowBuilderClientScript.ts` の `renderGuardrails()` と `handleFieldEvent()` / click handler で扱う。

approval rule の `when` は条件式として読む人間に分かりやすいよう、serializer 側で YAML 出力時にダブルクォート付きへ正規化する。

## Markdown Body tab

`Markdown Body` タブは `workflowBuilderBodyScript.ts` が `renderTabs()` を拡張し、`model.body` を直接編集する。

空欄の場合は serializer 側の既存挙動により title / description から既定本文を生成する。

この拡張は意図的に小さく保っている。将来 `workflowBuilderClientScript.ts` を機能別 module に分割する場合は、body tab も通常の tab renderer として統合する。

## 既存 workflow 編集時の注意

- GUI 管理外の front matter は loader が `unknownFrontMatter` として保持する。
- YAML のコメントや順序は完全保持しない。
- Markdown body は `model.body` として保持し、`Markdown Body` タブで編集できる。
- edit mode 保存時は既存ファイルへ backup を作成してから上書きする。
