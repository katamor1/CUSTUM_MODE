# Guided Help PR Summary

この PR は Workflow Builder の GUI 設定支援を強化する。

## 変更範囲

- Help Target 明示化。
- Step type ごとの設定ガイド。
- 動的選択肢の表示ラベル改善。
- Diagnostics から設定項目への誘導。

## 実装対象

- `workflowBuilderClientScript.ts`
- `workflowBuilderHtml.ts`
- `workflowBuilderStyles.ts`
- `workflowBuilderWebviewModules.test.js`
- `docs/workflow-builder-guided-help-ja.md`

## 注意

保存、serializer、loader の挙動は変更しない。
