# bob-bazaar-review ドキュメント

このディレクトリには、`bob-bazaar-review` 拡張機能の設計・運用に関するドキュメントを配置します。

## 現在の実装状態

`bob-bazaar-review` は、Bazaar 差分レビュー、project rules、review-result 保存、MCP 連携を提供する実行可能な VS Code 拡張です。

リファクタリング後は、`workflow-register` 連携の薄い bridge と workflow action input helper を `src/workflowRegisterBridge.ts` に分離しています。これにより `src/extension.ts` は、Command Palette 登録、GUI 起動、Bazaar packet 作成、Bob context 連携、review-result 検証の入口に寄せています。

## 設計書

- `basic-design-ja.md`  
  拡張機能の目的、スコープ、全体構成、主要コンポーネント、workspace モデル、Bazaar 実行方針、workflow-register 連携、MCP、review-result 保存、セキュリティ方針をまとめた基本設計書です。

- `detailed-design-ja.md`  
  実装モジュール、主要データ、処理シーケンス、workspace 解決、GUI、MCP server、project rules、review-result capture、multi-root 動作、テスト観点を整理した詳細設計書です。現在の実装では `workflowRegisterBridge.ts` が workflow-register API 取得と workflow action input 解釈を担当します。

## 既存ドキュメント

- `../README.md`  
  利用者向けの機能説明、コマンド一覧、GUI、MCP、設定、ビルド手順、現在の実装分割をまとめています。

- `workflow-authoring-guide-ja.md`  
  Bob / workflow-register で利用するワークフロー作成ガイドです。

- `../../../docs/extension-refactor-review-54e1fe58.md`  
  3 拡張機能全体の責務分割方針と、今後の分割候補をまとめています。
