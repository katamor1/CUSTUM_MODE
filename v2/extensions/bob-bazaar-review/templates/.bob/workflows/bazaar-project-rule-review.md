# Bazaar Project Rule Review Workflow

Bazaar revision/range をプロジェクト規約付きでレビューするための手順です。

## Inputs

- `repository_root`: Bazaar repository root
- `revision_mode`: `single` / `range` / `working_tree_since_revision`
- `revision`: single revision の場合
- `base_revision`: range または working tree review の場合
- `target_revision`: range の場合
- `checklist_path`: default `.bob/review/checklist.json`
- `schema_path`: default `.bob/review/review-result.schema.json`

## MCP tools

- `bazaar_root`
- `bazaar_log`
- `bazaar_diff_revision`
- `bazaar_diff_range`
- `bazaar_diff_working_tree`
- `bazaar_cat_revision`
- `project_rules_get_checklist`
- `project_rules_get_schema`
- `project_rules_validate_review_result`
- `project_rules_render_markdown`

## Allowed focused context tools

レビューに必要な場合、Bobのread系機能、限定検索、Tree-sitter、symbol search、outlineを使ってよい。

ただし、対象は以下に絞る。

- 変更ファイルと追加ファイル
- diffに出た関数、型、構造体、macro、変数
- 追加された公開関数や公開定義
- 外部I/F、共有メモリ、RT/TS境界に関係するsymbol

広範囲の無条件読み込みは避ける。必要な証跡が大きすぎる場合は `unknown` にする。

## Steps

1. Bazaar repository root を解決する。
2. `project_rules_get_checklist` で checklist を読み込む。
3. `project_rules_get_schema` で review result schema を読み込む。
4. Bazaar log/diff を取得する。
   - single: `bazaar_log` + `bazaar_diff_revision`
   - range: `bazaar_diff_range`
   - working tree: `bazaar_diff_working_tree`
5. 追加ファイルがある場合は、その内容または主要symbolを確認する。
6. 必要に応じて、限定検索やTree-sitterで関数境界、定義位置、参照箇所を確認する。
7. checklist の各 rule について、適用可否、証跡、status、severity、confidence を判断する。
8. `fail` の rule には同じ `rule_id` を持つ finding を作る。
9. status ごとに summary を集計する。
10. `review_result_json` fenced block としてJSONを出力する。
11. `project_rules_validate_review_result` で検証する。
12. Markdown checklist summary を出力する。

## Output order

1. `review_result_json` fenced JSON block
2. Markdown checklist summary

JSONを正本とし、Markdown `[x]` は表示用にする。

## Status policy

- `pass`: 証跡ありで問題なし。
- `fail`: 規約違反または高リスク。
- `unknown`: 入力資料不足で判断不能。
- `not_applicable`: 今回変更には該当しない。
- `blocked`: tool、revision、file、checklist、schema を取得できない。

## Example user instruction

```text
Bazaar revision 1234 を project-rule-reviewer mode でレビューしてください。
.bob/review/checklist.json の全ルールを確認し、必要ならTree-sitterと限定検索で関連symbolを確認し、正規化JSONとMarkdownチェックリストを出してください。
```
