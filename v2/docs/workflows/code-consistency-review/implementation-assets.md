# 整合プレレビュー 実装アセット一覧

## 1. 目的

この文書は、MVP 実装でそのまま参照するスキーマ、プロンプトテンプレート、triage テンプレートをまとめる。

前フェーズまでの仕様書は設計文書であり、本フェーズのファイルは実装コードから読み込むことを想定したアセットである。

## 2. 追加アセット

```text
schemas/
  review-input.schema.json
  bob-output.schema.json

templates/
  prompts/
    consistency-review-v1/
      system.md
      task.md
      output-format.md
      bob-input.template.md
  triage/
    triage-result.template.yaml
```

## 3. review-input.schema.json

`review-input.yaml` を検証するための JSON Schema。

検証対象:

- `schema_version`
- `review.id`
- `review.title`
- `review.change_type`
- `review.purpose`
- `review.base`
- `review.head`
- `artifacts`
- `review_focus`
- `analysis_options`
- `bob_options`

MVP では、YAML を読み込んだ後に JSON 相当のオブジェクトとしてこのスキーマで検証する。

## 4. bob-output.schema.json

bob が出力した YAML を検証するための JSON Schema。

検証対象:

- `schema_version`
- `review_summary`
- `findings`
- `questions`
- `coverage_notes`
- `rejected_or_uncertain`
- `review_summary.final_approval: not_performed`
- finding の evidence 必須
- severity / confidence / category の enum

このスキーマは、bob が正式承認をしたような出力を invalid にするためにも使う。

## 5. prompt templates

`templates/prompts/consistency-review-v1/` は、bob-input.md 生成に使う。

| ファイル | 内容 |
|---|---|
| `system.md` | bob の役割、禁止事項 |
| `task.md` | 整合プレレビューの確認対象 |
| `output-format.md` | YAML 出力形式と禁止事項 |
| `bob-input.template.md` | review-package の各ファイルを統合する雛形 |

## 6. triage template

`templates/triage/triage-result.template.yaml` は、human-triage-helper が `triage-result.yaml` を生成する際の雛形である。

実装時は、bob-output.yaml の `findings` と `questions` を `items` に展開し、decision 未設定の状態で人間に渡す。

## 7. 実装時の読み込み順

```text
1. review-input.yaml を読み込む
2. schemas/review-input.schema.json で検証する
3. review-package を生成する
4. templates/prompts/consistency-review-v1/* を読み込む
5. bob-input.template.md に review-package の内容を埋め込む
6. bob-output.yaml を読み込む
7. schemas/bob-output.schema.json で検証する
8. triage-result.template.yaml を使って triage-result.yaml を生成する
```

## 8. MVP 実装で固定する前提

- prompt template ID は `consistency-review-v1` とする。
- bob 出力形式は YAML のみとする。
- `final_approval` は `not_performed` のみ許可する。
- finding には evidence と human_check を必須にする。
- GUI ではなく YAML / Markdown で triage する。

## 9. 後続拡張

- schema version 2 の追加
- prompt template の複数化
- severity / confidence の組織別カスタマイズ
- review_focus ごとの専用 checklist 追加
- triage decision の UI 化
