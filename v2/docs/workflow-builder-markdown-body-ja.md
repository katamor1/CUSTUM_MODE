# Workflow Builder Markdown Body 編集メモ

## 背景

`WORKFLOW.md` は YAML front matter だけでなく、`---` の後ろに Markdown 本文を持てる。

`bob-bazaar-review` のような実運用 workflow では、YAML で構造化された steps / inputs / guardrails を定義しつつ、Markdown 本文に目的、手順、レビュー観点、運用上の注意を書きたいケースがある。

## 追加内容

Phase 6 では `Bob Workflow Builder` に `Markdown Body` タブを追加した。

このタブでは、YAML front matter の後ろへ出力される Markdown 本文を直接編集できる。

## 動作

- 新規作成時は、本文が未入力なら title / description から既定本文を生成する。
- 既存 `WORKFLOW.md` を GUI 編集で開いた場合は、既存の Markdown 本文を `model.body` として読み込み、タブ上で編集できる。
- `Markdown Body` タブの textarea は `model.body` を直接更新する。
- 保存時は既存の `serializeAuthoringModelToMarkdown()` が `model.body` を YAML の後ろに出力する。
- 空欄の場合は従来どおり serializer 側で既定本文を生成する。

## 追加ファイル

```text
extensions/workflow-register/src/webview/workflowBuilderBodyScript.ts
```

## 変更ファイル

```text
extensions/workflow-register/src/webview/workflowBuilderHtml.ts
extensions/workflow-register/src/webview/README.md
extensions/workflow-register/test/workflowBuilderWebviewModules.test.js
extensions/workflow-register/test/workflowAuthoringAdvancedSections.test.js
```

## テスト観点

- Webview HTML に `Markdown Body` タブが含まれること。
- `workflowBuilderBodyScript.ts` が `renderMarkdownBody`、`data-body-field`、`model.body` を含むこと。
- serializer が `model.body` を YAML front matter 後ろに出力すること。
- loader が既存 Markdown 本文を `model.body` として読み戻すこと。
