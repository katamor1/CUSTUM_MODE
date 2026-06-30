# workflow-register core modules

このディレクトリは、`WORKFLOW.md` の読み込み、検証、GUI 編集用モデル、保存用 Markdown 生成を担当する。

## 主な流れ

```text
WORKFLOW.md
  -> parser.ts
  -> CoreWorkflowDefinition
  -> workflowAuthoringLoader.ts
  -> WorkflowAuthoringModel
  -> workflowAuthoringSerializer.ts
  -> WORKFLOW.md
```

## ファイル別の責務

| file | 責務 |
| --- | --- |
| `model.ts` | workflow-register の中心となる TypeScript 型を定義する。 |
| `workflowSchema.ts` | `schemaVersion: workflow-register/v1` の JSON Schema。validator の基準になる。 |
| `parser.ts` | YAML front matter と Markdown body を読み、`CoreWorkflowDefinition` に正規化する。 |
| `workflowValidator.ts` | parser / schema を使って workflow 定義を検証し、ユーザー向け diagnostics を返す。 |
| `workflowAuthoringModel.ts` | GUI 編集に都合のよい中間モデルを定義する。 |
| `workflowAuthoringDefaults.ts` | 新規作成時のテンプレートから `WorkflowAuthoringModel` を作る。 |
| `workflowAuthoringLoader.ts` | 既存 `WORKFLOW.md` を GUI 編集用 `WorkflowAuthoringModel` へ変換する。 |
| `workflowAuthoringSerializer.ts` | GUI 編集用 `WorkflowAuthoringModel` を `WORKFLOW.md` に戻す。 |
| `workflowAuthoringReferenceAnalysis.ts` | `resultKey` / `includeState` / `artifacts.producedBy` の参照関係を分析する。 |

## 境界の考え方

### parser と loader

`parser.ts` は実行用の `CoreWorkflowDefinition` を作る。

`workflowAuthoringLoader.ts` は GUI 編集用の `WorkflowAuthoringModel` を作る。GUI 管理外の front matter は `unknownFrontMatter` に退避し、Markdown body は `model.body` として保持する。

### serializer と validator

`workflowAuthoringSerializer.ts` は YAML front matter と Markdown body を含む完全な `WORKFLOW.md` を生成する。

保存前には必ず `validateWorkflowText` で生成結果を検証する。GUI が作ったモデルを信用しすぎず、最後は既存 parser/schema の検証に通す。

### YAML 表記安定化

`js-yaml` は意味上同じ値でもクォートを省略することがある。

既存運用ファイルとの差分を減らすため、serializer では `requires.bob.minVersion` と `guardrails.requireApproval[].when` をクォート付きに正規化している。

この処理は実行時の値を変えるためではなく、レビュー時の差分ノイズを減らすためのもの。
