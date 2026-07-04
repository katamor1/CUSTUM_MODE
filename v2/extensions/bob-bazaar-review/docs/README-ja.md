# bob-bazaar-review ドキュメント

このディレクトリには、`bob-bazaar-review` 拡張機能の設計・運用・テストに関するドキュメントを配置します。

## 現在の実装状態

`bob-bazaar-review` は、Bazaar 差分レビュー、project rules、review-result 保存、MCP 連携を提供する実行可能な VS Code 拡張です。

リファクタリング後は、`workflow-register` 連携の薄い bridge と workflow action input helper を `src/workflowRegisterBridge.ts` に分離しています。直接レビュー command は `src/bazaarReviewCommands.ts`、active editor の review-result JSON 検証は `src/reviewResultValidationCommand.ts`、Bob 拡張の有無判定は `src/bobCodeExtension.ts` が担当します。

## 設計書

- `basic-design-ja.md`  
  拡張機能の目的、スコープ、全体構成、主要コンポーネント、workspace モデル、Bazaar 実行方針、GUI / 直接レビュー command、workflow-register 連携、MCP、review-result 保存、セキュリティ方針をまとめた基本設計書です。

- `detailed-design-ja.md`  
  実装モジュール、VS Code command、workspace 解決、BazaarClient、GUI、直接レビュー command、MCP server、workflow-register bridge、project rules、review-result capture、multi-root 動作、テスト観点を整理した詳細設計書です。

## テスト仕様書

- `unit-test-spec-ja.md`  
  BazaarClient、文字コード、workspace resolver、review packet、直接レビュー command、workflow-register bridge、review-result capture、MCP server、workflow template の単体テスト仕様書です。

- `real-machine-test-spec-ja.md`  
  VS Code、IBM Bob、workflow-register、Bob Workflow UI、Bazaar Review GUI、Bazaar CLI、MCP server、multi-root workspace を含む実機テスト仕様書です。

## 既存ドキュメント

- `../README.md`  
  利用者向けの機能説明、コマンド一覧、GUI、MCP、設定、ビルド手順、現在の実装分割をまとめています。

- `workflow-authoring-guide-ja.md`  
  Bob / workflow-register で利用するワークフロー作成ガイドです。

- `../../../docs/extension-refactor-review-54e1fe58.md`  
  3 拡張機能全体の責務分割方針と、今後の分割候補をまとめています。
