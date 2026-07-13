# workflow-register ドキュメント

このディレクトリには、`workflow-register` 拡張機能の設計・運用・テストに関するドキュメントを配置します。

## 設計書

- `basic-design-ja.md`  
  拡張機能の目的、スコープ、全体構成、主要コンポーネント、workflow 定義モデル、実行状態、run control、task snapshot、GUI Builder、Template Customization Studio、AI 補助、他拡張連携、テスト方針をまとめた基本設計書です。

- `detailed-design-ja.md`  
  実装モジュール、activation、command、設定、公開 API、parser / validator、Bob 登録、WorkflowEngine、run state、run control、Run Control View、task snapshot、result handoff、GUI Builder、Template Customization Studio、diagnostics、テスト観点を整理した詳細設計書です。

- `run-state-schema-v1-ja.md`  
  `run.json` の schema version、historical v0 migration、exact-byte backup、future-version read-only protection、invalid document isolationを定義します。

## テスト仕様書

- `unit-test-spec-ja.md`  
  parser、validator、engine、run state、run control、Run Control View、task snapshot、result handoff、Bob adapter helper、authoring helper、Template Customization Studio helper の単体テスト仕様書です。

- `real-machine-test-spec-ja.md`  
  VS Code / IBM Bob / Bob Workflow UI / Webview / Template Customization Studio / Explorer view / Status Bar / multi-root workspace を含めた実機テスト仕様書です。

## 運用・検討メモ

- `workflow-authoring-guide.md`  
  workflow 作成者向けの authoring guide です。

- `bob-task-export-recovery-plan-ja.md`  
  Bob task snapshot / recovery に関する検討メモです。

- `workflow-pause-resume-plan-ja.md`  
  workflow pause / resume 機能の検討メモです。

- `workflow-pause-resume-phase0-decision-ja.md`  
  pause / resume phase0 の判断記録です。
