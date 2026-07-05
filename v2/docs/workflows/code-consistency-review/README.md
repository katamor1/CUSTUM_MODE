# コード変更と要求・設計整合プレレビュー 詳細仕様

このディレクトリは、コード変更と要求書・設計書・テスト仕様書の整合プレレビューを実装・運用するための詳細仕様と参照資料をまとめる。

現行 runtime の正本は `extensions/bob-code-consistency-review/docs/` と `extensions/bob-code-consistency-review/resources/` である。このディレクトリ直下の schema / prompt / package 仕様は runtime と同期する公開仕様として扱い、`mvp-*` と `scaffold/` は歴史的経緯、fixture、設計検討の参照用として残す。

## 文書一覧

| 文書 | 内容 |
|---|---|
| `../code-requirement-design-consistency-review.md` | 全体の詳細フロー |
| `../code-requirement-design-consistency-review-plan-skeleton.md` | 計画の骨格 |
| `review-input-schema.md` | 人間または builder が生成する入力 YAML の仕様 |
| `review-package-spec.md` | Bob 投入前に作る根拠パッケージ仕様 |
| `bob-prompt-template.md` | Bob に投入するプロンプトテンプレート |
| `bob-output-schema.md` | Bob の構造化出力 YAML 仕様 |
| `human-triage-spec.md` | Bob 出力を人間が採用・棄却・追加調査に分類する仕様 |
| `c-cpp-analysis-scope.md` | C/C++ コード解析で抽出する対象 |
| `document-extraction-spec.md` | Word / Excel / Markdown 文書抽出仕様 |
| `traceability-sidecar-catalog.md` | 元文書非改変の sidecar catalog、ID 付与、工程間リンク、レビューゲート、review-input 生成統合方針 |
| `mvp-implementation-plan.md` | legacy/reference: 初期 MVP 実装マイルストーン、タスク、受け入れ条件 |
| `mvp-architecture.md` | legacy/reference: 初期 MVP の CLI、モジュール、データフロー構成 |
| `mvp-backlog.md` | legacy/reference: 初期 MVP 実装チケット候補と着手順 |
| `implementation-assets.md` | 実装コードから参照するスキーマ・テンプレート一覧 |
| `schemas/review-input.schema.json` | `review-input.yaml` 検証用 JSON Schema |
| `schemas/bob-output.schema.json` | `bob-output.yaml` 検証用 JSON Schema |
| `templates/prompts/consistency-review-v1/` | Bob 投入用 prompt template |
| `templates/triage/triage-result.template.yaml` | 人間 triage 結果テンプレート |
| `scaffold/README.md` | legacy/reference: 仕様検証用 scaffold の概要 |
| `scaffold/DEVELOPMENT.md` | legacy/reference: scaffold のローカル確認手順 |
| `scaffold/CI.md` | legacy/reference: scaffold の GitHub Actions 検証方針 |
| `scaffold/package-lock.json` | legacy/reference: scaffold CI 用の依存関係ロックファイル |
| `scaffold/tests/README.md` | legacy/reference: scaffold 検証 fixture と自動テストの説明 |
| `scaffold/tests/*.test.ts` | legacy/reference: review-input / bob-output validator の自動テスト |
| `scaffold/tests/fixtures/` | legacy/reference: review-input / bob-output の正常系・異常系 fixture |
| `scaffold/src/cli/main.ts` | legacy/reference: CLI エントリポイントの雛形 |
| `scaffold/src/core/` | legacy/reference: 入力検証、差分収集、review-package 生成、Bob 出力検証の雛形 |
| `scaffold/src/analyzers/` | legacy/reference: 文書抽出、C/C++ 解析、traceability 生成の雛形 |
| `scaffold/src/triage/` | legacy/reference: human triage 生成の雛形 |
| `../../../extensions/bob-code-consistency-review/` | 実行可能な VS Code 拡張実装 |
| `.github/workflows/code-consistency-review-scaffold.yml` | scaffold の typecheck / unit / smoke CI |
| `.bob/workflows/code-consistency-review/WORKFLOW.md` | Bob から整合プレレビュー手順を開始する workflow 定義 |
| `examples/simple-timeout-bugfix/README.md` | E2E 検証用の timeout 不整合サンプル |
| `examples/live-traceability-sidecar/README.md` | traceability sidecar 作成入力を含む実機検証用サンプル |
| `examples/multi-language-git-review/README.md` | TypeScript / Python / Java の Git 差分から汎用コード根拠を生成する実機検証用サンプル |

## 現行 runtime のゴール

現行 runtime では、1 件のコード変更に対して以下を実現する。

- 関連文書候補を収集し、AI draft 用 prompt にまとめられる。
- 元文書を変更せず、`.bob-trace/traceability-catalog.json` に仕様単位、ID 候補、工程間リンク、人間の承認状態を保持できる。
- traceability gate で未承認、欠落、stale、未対応レビュー指摘を検出できる。
- accepted catalog item から `review-input.yaml` を生成できる。
- `review-input.yaml` で対象コミットと関連文書を指定できる。
- Git / Bazaar 差分、変更ファイル、Git rename、空白入り path、binary numstat を抽出できる。
- C / C++ は変更関数や周辺候補を抽出し、TypeScript / JavaScript / Python / C# / Java / Go / Rust / Shell / SQL / JSON / YAML / Markdown / text / unknown は diff hunk 単位の汎用コード根拠を生成できる。
- Word / Excel / Markdown から関連文書の抜粋を作れる。
- 要求・設計・コード・テストの対応候補を作れる。
- Bob 投入用の `review-package` を生成できる。
- Bob 出力を YAML として保存できる。
- 人間が Bob 出力を triage できる。

## workflow の開始地点

現行の `.bob/workflows/code-consistency-review/WORKFLOW.md` は、`review-input.yaml` が既に完成している状態だけを入口にしない。

新しい入口は次の順序である。

```text
文書候補収集
  -> traceability AI draft prompt 生成
  -> AI が proposed-only catalog JSON を作成
  -> AI draft JSON を sidecar catalog へ merge
  -> Traceability Prep Webview で人間が承認 / 棄却 / 廃止
  -> traceability gate 検証
  -> accepted item から review-input.yaml 生成
  -> review-package / bob-input.md 生成
  -> Bob 整合プレレビュー
  -> Bob 出力検証
  -> 人間 triage
  -> 正式レビュー引き継ぎ
```

このため workflow の `requires.files` から `review-input.yaml` 必須条件を外す。`review-input.yaml` は、前段の `create-review-input-from-traceability` step で生成される成果物として扱う。

AI は traceability の正式承認を行わない。AI が作成できるのは `status: proposed` の候補だけであり、`accepted`、`rejected`、`deprecated` への遷移は Traceability Prep Webview で人間が実施する。

## 実行可能な拡張実装

runtime 実装は `extensions/bob-code-consistency-review/` に配置する。

- VS Code 拡張 ID は `local.bob-code-consistency-review`。
- `workflow-register` の `registerActionProvider` へ、preprocess / capture / validate / triage に加え、traceability-prep 系の provider を登録する。
- `.bob/workflows/code-consistency-review/WORKFLOW.md` は manual CLI 手順ではなく、provider を使って次の流れを実行する:
  `collect-document-candidates -> traceability draft -> human approval -> create review-input`
  `-> preprocess -> Bob agent -> capture -> validate -> triage -> handoff`
- `resources/schemas/` と `resources/templates/` は、この docs 配下の schema / template を runtime 用に同梱したもの。
- `scaffold/` は仕様検証用の歴史的参照として残し、実運用の Bob workflow からは runtime 拡張を呼び出す。

## 現在の runtime モジュール分割

| モジュール | 現在の責務 |
|---|---|
| `src/extension.ts` | activation、Command Palette 登録、workflow provider mapping、まだ分離していない command handler 群。 |
| `src/extensionCommandOptions.ts` | command option / prompt / path / notification helper。 |
| `src/reviewInputWizard.ts` | 対話式 `review-input.yaml` 作成 UI と review metadata 収集。 |
| `src/workflowProviderRegistration.ts` | `workflow-register` action provider 登録。 |
| `src/workspaceInitializer.ts` | `.bob/workflows/code-consistency-review/WORKFLOW.md` と `review-input.yaml` 雛形の初期化。 |
| `src/core/*` | review-input builder、AI draft provider、traceability catalog、language classifier、Git / Bazaar diff collector、pipeline、Bob output capture / validator。 |
| `src/analyzers/codeChangeAnalyzer.ts` | C / C++ 深掘り解析と複数言語の汎用コード根拠生成を統合する。 |
| `src/analyzers/cCppChangeAnalyzer.ts` | C / C++ 変更関数、define、global、call graph、RT 候補を抽出する。 |
| `src/analyzers/genericCodeEvidenceAnalyzer.ts` | 詳細解析対象外の言語でも diff hunk 単位の `SRC-*` evidence を生成する。 |
| `src/webview/traceabilityPrepWebview.ts` | Traceability Prep Webview。 |
| `src/triage/humanTriageHelper.ts` | human triage 成果物生成。 |

今後の分割候補は `traceabilityCommands.ts`、`reviewInputCommands.ts`、`reviewExecutionCommands.ts` である。Command ID と workflow provider ID は互換性に直結するため、分割時も名称を変更しない。

## legacy MVP 実装単位

この一覧は初期計画の履歴であり、現行実装の作業順序ではない。

```text
M1. review-input-validator
M2. git/bazaar-diff-collector
M3. review-package-builder の最小版
M4. document-extractor の最小版
M5. c-cpp-change-analyzer の最小版
M6. traceability-builder の最小版
M7. bob-input.md 生成
M8. bob-output-validator
M9. human-triage-helper
M10. サンプル変更で end-to-end 検証
```

## CLI の想定

CLI 仕様は scaffold と将来の自動化確認用に残す。現行の Bob workflow は runtime 拡張の Command Palette / action provider を呼び出す。

```bash
bob-review preprocess --input review-input.yaml --out .bob-review/review-package
bob-review validate-output --package .bob-review/review-package --bob-output .bob-review/bob-output/bob-output.yaml
bob-review triage --package .bob-review/review-package --bob-output .bob-review/bob-output/bob-output.yaml --out .bob-review/human-triage
```

## Bob 結合確認 sandbox

`integration/launch-bob-code-consistency-sandbox.ps1` は、repo root を汚さず `%TEMP%/bob-workflow-integration-*` に確認用 workspace を作る。

- `workflow-register`、`bob-bazaar-review`、`bob-code-consistency-review` の VSIX を isolated `--extensions-dir` に install する。
- `bob2/bob-code` は raw copy ではなく `--extensionDevelopmentPath` で読み込む。
- sample `review-input.yaml` と `.bob/workflows/code-consistency-review/WORKFLOW.md` は sandbox workspace にコピーする。
- `-Sample multi-language-git-review` は TypeScript / Python / Java の baseline / head fixture から実 Git repo を作成し、`feature/multi-language-git-review` branch を checkout する。
- `-NoLaunch` を付けると VS Code は起動せず、sandbox 作成と拡張 install、起動コマンド表示だけを行う。

## 実装アセット

`schemas/` と `templates/` は、仕様説明ではなく実装コードから読み込むアセットとして扱う。

- `schemas/review-input.schema.json` で `review-input.yaml` を検証する。
- `schemas/bob-output.schema.json` で Bob 出力 YAML を検証する。
- `templates/prompts/consistency-review-v1/` で `bob-input.md` を組み立てる。
- `templates/triage/triage-result.template.yaml` で人間 triage の初期 YAML を生成する。

## 実装スケルトン

`scaffold/` は、仕様確定前に CLI / validator / CI の粒度を確認するための legacy/reference スケルトンである。runtime 拡張実装が整った後も、仕様説明用の fixture として残す。
