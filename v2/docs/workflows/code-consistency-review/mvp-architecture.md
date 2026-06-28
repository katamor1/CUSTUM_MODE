# 整合プレレビュー MVP アーキテクチャ案

## 1. 目的

この文書は、コード変更と要求・設計整合プレレビューの MVP 実装におけるツール構成、モジュール分割、データフローを定義する。

MVP では、まず CLI ベースで実装し、GUI や PR 連携は後続フェーズに回す。

## 2. 全体構成

```text
bob-review CLI
  ├─ preprocess
  │   ├─ review-input-validator
  │   ├─ git-diff-collector
  │   ├─ document-extractor
  │   ├─ c-cpp-change-analyzer
  │   ├─ traceability-builder
  │   └─ review-package-builder
  │
  ├─ validate-output
  │   └─ bob-output-validator
  │
  └─ triage
      └─ human-triage-helper
```

## 3. コマンド構成

### 3.1 preprocess

```bash
bob-review preprocess --input review-input.yaml --out .bob-review/review-package
```

責務:

- 入力検証
- Git 差分収集
- 文書抽出
- C/C++ 変更解析
- トレーサビリティ候補作成
- bob-input.md 生成

生成物:

```text
.bob-review/review-package/
  manifest.yaml
  input-normalized.json
  changed-files.json
  changed-symbols.json
  change-summary.md
  diff-context.md
  document-index.json
  document-excerpts.md
  traceability-map.md
  deterministic-checks.md
  evidence-index.json
  bob-input.md
```

### 3.2 validate-output

```bash
bob-review validate-output \
  --package .bob-review/review-package \
  --bob-output .bob-review/bob-output/bob-output.yaml
```

責務:

- YAML 構文チェック
- bob-output-schema 検証
- evidence_id 検証
- final_approval 禁止確認
- validation-report.md 生成

### 3.3 triage

```bash
bob-review triage \
  --package .bob-review/review-package \
  --bob-output .bob-review/bob-output/bob-output.yaml \
  --out .bob-review/human-triage
```

責務:

- triage-result.yaml テンプレート生成
- accepted-findings.md 生成
- questions-to-author.md 生成
- rejected-findings.md 生成
- follow-up-actions.md 生成

## 4. 推奨ディレクトリ構成

既存リポジトリ構成に合わせるため、実際の配置は実装時に確認する。MVP の論理構成は以下とする。

```text
extensions/
  code-consistency-review/
    README.md
    package.json または manifest.yaml
    src/
      cli/
        main.*
        commands/
          preprocess.*
          validate-output.*
          triage.*
      core/
        review-input-validator.*
        git-diff-collector.*
        review-package-builder.*
        bob-output-validator.*
      analyzers/
        c-cpp-change-analyzer.*
        document-extractor.*
        traceability-builder.*
      schemas/
        review-input.schema.json
        bob-output.schema.json
      templates/
        prompts/
          system.md
          task.md
          output-format.md
        triage/
          triage-result.yaml
    tests/
      fixtures/
      unit/
      e2e/
```

## 5. データフロー

```text
review-input.yaml
  ↓ review-input-validator
input-normalized.json
  ↓ git-diff-collector
changed-files.json / diff-context.md
  ↓ c-cpp-change-analyzer
changed-symbols.json
  ↓ document-extractor
document-index.json / document-excerpts.md
  ↓ traceability-builder
traceability-map.md
  ↓ review-package-builder
bob-input.md
  ↓ bob
bob-output.yaml
  ↓ bob-output-validator
validation-report.md
  ↓ human-triage-helper
triage-result.yaml / accepted-findings.md
```

## 6. モジュール責務

### 6.1 review-input-validator

入力:

- `review-input.yaml`

出力:

- `input-normalized.json`
- validation errors / warnings

責務:

- 必須項目検証
- enum 検証
- 文書パス検証
- base/head 未指定検出
- 既定値補完

### 6.2 git-diff-collector

入力:

- `input-normalized.json`
- Git repository

出力:

- `changed-files.json`
- `diff-context.md`

責務:

- base/head 解決
- 変更ファイル一覧
- diff 抽出
- 変更行情報

### 6.3 document-extractor

入力:

- `input-normalized.json`
- 文書ファイル

出力:

- `document-index.json`
- `document-excerpts.md`
- document extraction warnings

責務:

- Word / Excel / Markdown 抽出
- ID 抽出
- evidence_id 付与
- 表構造保持

### 6.4 c-cpp-change-analyzer

入力:

- `changed-files.json`
- `diff-context.md`
- Git repository

出力:

- `changed-symbols.json`
- code analysis warnings

責務:

- 変更関数推定
- 変更シンボル抽出
- グローバル変数候補抽出
- RT 禁止処理候補抽出

### 6.5 traceability-builder

入力:

- `document-index.json`
- `changed-symbols.json`
- `changed-files.json`

出力:

- `traceability-map.md`
- `evidence-index.json` への追加候補

責務:

- 明示 ID 対応
- シンボル名一致
- キーワード一致
- confidence 付与

### 6.6 review-package-builder

入力:

- 各中間生成物
- prompt templates

出力:

- `manifest.yaml`
- `change-summary.md`
- `deterministic-checks.md`
- `bob-input.md`

責務:

- review-package 構築
- bob 入力統合
- 再現性メタデータ保存

### 6.7 bob-output-validator

入力:

- `bob-output.yaml`
- `evidence-index.json`

出力:

- `validation-report.md`

責務:

- YAML スキーマ検証
- evidence_id 検証
- 禁止出力検出

### 6.8 human-triage-helper

入力:

- `bob-output.yaml`
- `validation-report.md`
- `evidence-index.json`

出力:

- `triage-result.yaml`
- `accepted-findings.md`
- `questions-to-author.md`
- `rejected-findings.md`
- `follow-up-actions.md`

責務:

- 人間判断の記録
- 正式レビュー向け Markdown 生成
- 棄却理由保存

## 7. データモデルの考え方

MVP では、内部モデルを細かく作り込みすぎない。次の境界を守る。

| データ | 形式 | 理由 |
|---|---|---|
| 人間入力 | YAML | 手で編集しやすい |
| 中間データ | JSON | 機械処理しやすい |
| bob 入力 | Markdown | bob が読みやすい |
| bob 出力 | YAML | 後処理しやすい |
| 人間 triage | YAML + Markdown | 記録とレビュー利用を両立 |

## 8. エラーハンドリング方針

### 8.1 即時停止するエラー

- `review-input.yaml` が読めない。
- base/head が解決できない。
- Git diff が取得できない。
- 必須文書が存在しない。
- review-package の必須ファイルを生成できない。
- bob-output.yaml が YAML として壊れている。

### 8.2 警告として継続するもの

- 文書版数が不明。
- 関連テスト仕様書が未指定。
- traceability の confidence が low。
- C/C++ 解析で関数所属が不明。
- 関数ポインタ候補を解決できない。
- 静的解析結果が未入力。

## 9. テスト方針

### 9.1 unit test

- review-input の正常系 / 異常系
- changed-files.json の生成
- evidence_id 採番
- bob-output.yaml スキーマ検証
- triage-result.yaml 生成

### 9.2 fixture test

以下のサンプルを用意する。

```text
tests/fixtures/code-consistency-review/
  simple-bugfix/
    repo/
    docs/
    review-input.yaml
    expected/
```

### 9.3 e2e test

`review-input.yaml` から `accepted-findings.md` まで生成する。

MVP では bob の実行自体はモックでもよい。`bob-output.yaml` のサンプルを入力して後処理を検証する。

## 10. 設定ファイル案

```yaml
tool:
  output_root: .bob-review
  default_prompt_template: consistency-review-v1

analysis:
  max_code_context_lines: 80
  max_call_depth: 2
  treat_unknown_as_warning: true

documents:
  extract_hidden_sheets: false
  preserve_table_position: true
  require_document_version: false

bob_output:
  max_findings: 30
  max_questions: 30
  require_evidence: true
  require_human_check: true
```

## 11. 実装上の注意

- bob に渡す Markdown は、必ず evidence_id を含める。
- bob-output.yaml の evidence_id は、必ず evidence-index.json と照合する。
- `問題なし` のような自由文だけの出力は valid にしない。
- `final_approval` は常に `not_performed` に固定する。
- 解析できなかったものを無視せず、warning として残す。
- MVP では完璧な解析より、再現可能な根拠パッケージ生成を優先する。

## 12. 後続フェーズへの拡張余地

- PR コメント投稿
- GitHub Actions 連携
- Redmine 連携
- GUI triage
- PDF / doc / xls 抽出
- clang ベースの AST 解析
- 呼び出しグラフの永続化
- 類似度検索インデックス
- 誤検知フィードバック
