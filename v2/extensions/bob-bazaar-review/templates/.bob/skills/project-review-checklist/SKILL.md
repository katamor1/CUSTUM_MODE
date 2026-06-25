# Project Review Checklist Skill

このSkillは、Bazaar revision/range のコードレビューで、プロジェクト独自規約を必ず確認するために使用する。

## 目的

Bobは通常の不具合レビューに加えて、`.bob/review/checklist.json` の全ルールを評価する。レビュー結果は、自然文だけでなく、`review-result.schema.json` に従う正規化JSONを正本として出力する。

## 必須方針

1. `checklist.json` の全 rule を確認対象にする。
2. `applies_when` に合致しない rule は `not_applicable` にする。
3. 判断材料が不足している rule は `unknown` にする。推測で `pass` にしない。
4. `pass` は evidence がある場合だけ許可する。
5. `fail` は evidence と finding を必須にする。
6. `blocked` は tool / revision / file / checklist / schema が取得できない場合に使用する。
7. every `finding.rule_id` は `checklist_results.rule_id` に存在する値にする。
8. every failed rule must have at least one finding with the same `rule_id`.
9. Markdown `[x]` チェックリストは表示用であり、正本はJSONとする。
10. 変更を勝手に修正しない。レビューと指摘に徹する。

## Review focus

特に以下を重点確認する。

- RT_INPUT / RT_CONTROL / RT_OUTPUT などRT周期処理でのI/O混入
- ファイルI/O、ログ出力、標準出力、sleep/wait、mutex待ち
- malloc/free/new/delete など動的確保
- 外部I/F構造体のメンバ追加・削除・順序変更・型変更・padding影響
- PLC / モーション / センサ / 共有メモリIFの読み書き方向と更新順序
- グローバル変数・static変数の初期化順序、排他、状態遷移
- NULL、配列範囲外、文字列終端、バッファサイズ、符号付き/符号なし変換
- エラー処理、タイムアウト、リトライ、復旧不能状態
- 基本設計、詳細設計、IF台帳、エラー台帳、メッセージ台帳、翻訳台帳との不整合
- 単体テスト・機能テスト観点の不足

## Required output order

必ず以下の順で出力する。

1. `review_result_json` という名前の fenced JSON block
2. Markdown checklist summary

JSON block example:

```review_result_json
{
  "review_id": "BRR-YYYYMMDD-001",
  "vcs": {
    "type": "bazaar",
    "repository": "<repo>",
    "revision_mode": "single",
    "revision": "1234"
  },
  "checklist_results": [],
  "findings": [],
  "summary": {
    "pass": 0,
    "fail": 0,
    "unknown": 0,
    "not_applicable": 0,
    "blocked": 0
  }
}
```

## Status mapping for Markdown

- `[x]` = `pass`
- `[ ]` = `fail`
- `[?]` = `unknown`
- `[-]` = `not_applicable`
- `[!]` = `blocked`

## Notes

- evidence が無い `pass` は禁止。
- design doc / Excel台帳 / テスト仕様が必要なのに入力に無い場合は `unknown`。
- diffの行番号が不明な場合でも、可能な限り file と evidence summary を記録する。
- severityはruleの `severity_on_fail` を基本にし、影響が限定的なら `warning`、情報整理なら `info` にする。
