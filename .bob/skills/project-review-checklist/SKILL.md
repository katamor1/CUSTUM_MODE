# Project Review Checklist Skill

このSkillは、Bazaar revision/range のコードレビューで、プロジェクト独自規約を確認するために使用する。

## 目的

Bobは通常の不具合レビューに加えて、`.bob/review/checklist.json` の全ルールを評価する。レビュー結果は、自然文だけでなく、`review-result.schema.json` に従う正規化JSONを正本として出力する。

## 必須方針

1. `checklist.json` の全 rule を確認対象にする。
2. 明らかに関係しない rule は `not_applicable` にする。
3. 判断材料が不足している rule は `unknown` にする。推測で `pass` にしない。
4. `pass` と `fail` には evidence を付ける。
5. `fail` には同じ `rule_id` の finding を作る。
6. Markdown `[x]` チェックリストは表示用であり、正本はJSONとする。
7. 変更を勝手に修正しない。レビューと指摘に徹する。

## Context policy

コンテキストウィンドウを使いすぎない範囲で、必要最小限の追加調査を許可する。

許可する調査:

- 変更ファイル、追加ファイル、削除/rename対象ファイルの必要範囲を読む。
- 差分に出た関数名、構造体名、型名、macro名、global/static変数名を対象に限定検索する。
- Tree-sitter、symbol search、outlineなどの構文解析を使い、変更箇所の関数境界、定義位置、参照箇所、呼び出し関係を絞って確認する。
- 追加ファイルに重要そうな宣言、公開関数、構造体定義、global変数がある場合は、既存コード側の同名/類似名を限定検索する。
- 必要なら `bazaar_cat_revision` で対象revisionのファイル内容を読む。

制限する調査:

- リポジトリ全体の無条件な読み込みは避ける。
- 検索を使う場合は、検索語と対象ディレクトリまたは拡張子を絞る。
- 設計書、台帳、テスト仕様を読む場合も、関連ファイル名や変更識別子で絞る。
- 追加調査でコンテキストが大きくなりすぎる場合は `unknown` とし、必要な追加資料や検索条件を明記する。

## Review focus

特に以下を重点確認する。

- RT周期処理での重い処理や待ち処理の混入
- 動的メモリ確保、ファイルアクセス、ログ出力など周期処理に不向きな処理
- 外部I/F構造体の互換性
- 共有メモリIFの読み書き方向と更新順序
- global/static変数の初期化順序、排他、状態遷移
- NULL、配列範囲外、文字列終端、バッファサイズ、型変換
- エラー処理、タイムアウト、リトライ
- 基本設計、詳細設計、IF台帳、エラー台帳、メッセージ台帳、翻訳台帳との不整合
- 単体テスト・機能テスト観点の不足

## Required output order

必ず以下の順で出力する。

1. `review_result_json` という名前の fenced JSON block
2. Markdown checklist summary

## Status mapping for Markdown

- `[x]` = `pass`
- `[ ]` = `fail`
- `[?]` = `unknown`
- `[-]` = `not_applicable`
- `[!]` = `blocked`

## Notes

- evidence が無い `pass` は禁止。
- 必要な設計資料、台帳、テスト仕様が入力に無い場合は `unknown`。
- diffの行番号が不明な場合でも、可能な限り file と evidence summary を記録する。
- 追加調査に検索やTree-sitterを使った場合は、確認したsymbolや範囲を evidence summary に簡潔に残す。
