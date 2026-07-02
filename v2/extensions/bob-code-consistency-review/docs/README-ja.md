# bob-code-consistency-review ドキュメント

このディレクトリには、`bob-code-consistency-review` 拡張機能の設計・運用に関するドキュメントを配置します。

## 現在の実装状態

`bob-code-consistency-review` は、コード変更と要求・設計・テスト仕様の整合プレレビューを行う実行可能な VS Code 拡張です。

リファクタリング後は、`src/extensionCommandOptions.ts` に command option / prompt / path / notification helper を、`src/reviewInputWizard.ts` に対話式 `review-input.yaml` 作成 UI を分離しています。`src/extension.ts` には、Command Palette 登録、workflow provider mapping、traceability command、review-input AI draft、preprocess / capture / validate / triage の入口が残っています。

## 設計書

- `basic-design-ja.md`  
  拡張機能の目的、背景、スコープ、全体構成、入力モデル、traceability sidecar、review-package、workflow-register 連携、Bob にさせること / させないこと、セキュリティ方針、テスト方針をまとめた基本設計書です。

- `detailed-design-ja.md`  
  VS Code command、workflow-register provider、前処理 pipeline、VCS 差分収集、文書抽出、C / C++ 軽量解析、review-package 生成、Bob 出力検証、human triage、テスト観点を整理した詳細設計書です。現在の実装では `extensionCommandOptions.ts` と `reviewInputWizard.ts` が `extension.ts` から分離済みです。

## 運用メモ

- `vcs-bazaar-ja.md`  
  Git の代わりに Bazaar 差分を使うための `review-input.yaml` 指定方法、`bzr --no-aliases` の扱い、`vcs_root`、`bzrPath` の設定をまとめています。

- `text-encoding-ja.md`  
  Shift-JIS / CP932 が混在する既存ソース、Markdown 文書、Git / Bazaar 差分、`review-input.yaml` の読み取り文字コード設定をまとめています。

## 既存ドキュメント

- `../README.md`  
  利用者向けの機能説明、コマンド一覧、設定、traceability sidecar、review-input、review-package、Bob 出力検証、triage、workflow-register 連携、現在の実装分割をまとめています。

- `../../../docs/workflows/code-consistency-review/README.md`  
  コード整合プレレビュー全体のワークフロー仕様です。

- `../../../docs/workflows/code-consistency-review/review-input-schema.md`  
  `review-input.yaml` の仕様です。

- `../../../docs/workflows/code-consistency-review/review-package-spec.md`  
  `review-package` の成果物仕様です。

- `../../../docs/workflows/code-consistency-review/bob-prompt-template.md`  
  Bob に投入する prompt の仕様です。

- `../../../docs/workflows/code-consistency-review/bob-output-schema.md`  
  Bob 出力 YAML の schema 仕様です。

- `../../../docs/extension-refactor-review-54e1fe58.md`  
  3 拡張機能全体の責務分割方針と、今後の分割候補をまとめています。
