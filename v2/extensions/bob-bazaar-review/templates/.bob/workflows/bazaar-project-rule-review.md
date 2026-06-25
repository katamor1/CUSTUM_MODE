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

## Steps

1. Bazaar repository root を解決する。
2. `project_rules_get_checklist` で checklist を読み込む。
3. `project_rules_get_schema` で review result schema を読み込む。
4. Bazaar log/diff を取得する。
   - single: `bazaar_log` + `bazaar_diff_revision`
   - range: `bazaar_diff_range`
   - working tree: `bazaar_diff_working_tree`
5. checklist の各 rule について、適用可否、証跡、status、severity、confidence を判断する。
6. `fail` の rule には同じ `rule_id` を持つ finding を作る。
7. status ごとに summary を集計する。
8. `review_result_json` fenced block としてJSONを出力する。
9. `project_rules_validate_review_result` で検証する。
10. Markdown checklist summary を出力する。

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
.bob/review/checklist.json の全ルールを確認し、正規化JSONとMarkdownチェックリストを出してください。
```
