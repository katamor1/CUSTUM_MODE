# bob-code-consistency-review ドキュメント

このディレクトリには、`bob-code-consistency-review` 拡張機能の設計・運用に関するドキュメントを配置します。

## 設計書

- `basic-design-ja.md`  
  拡張機能の目的、背景、スコープ、全体構成、入力モデル、review-package、workflow-register 連携、Bob にさせること / させないこと、セキュリティ方針、テスト方針をまとめた基本設計書です。

- `detailed-design-ja.md`  
  VS Code command、workflow-register provider、前処理 pipeline、VCS 差分収集、文書抽出、C / C++ 軽量解析、review-package 生成、Bob 出力検証、human triage、テスト観点を整理した詳細設計書です。

## 運用メモ

- `vcs-bazaar-ja.md`  
  Git の代わりに Bazaar 差分を使うための `review-input.yaml` 指定方法、`bzr --no-aliases` の扱い、`vcs_root`、`bzrPath` の設定をまとめています。

- `text-encoding-ja.md`  
  Shift-JIS / CP932 が混在する既存ソース、Markdown 文書、Git / Bazaar 差分、`review-input.yaml` の読み取り文字コード設定をまとめています。

## 既存ドキュメント

- `../README.md`  
  利用者向けの機能説明、コマンド一覧、設定、review-input、review-package、Bob 出力検証、triage、workflow-register 連携をまとめています。

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
