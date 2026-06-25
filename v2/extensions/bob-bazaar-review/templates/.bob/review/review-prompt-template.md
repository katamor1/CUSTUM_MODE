# Bazaar Project Rule Review Prompt Template

以下のテンプレートをBob Chatへ投入するか、`Bob Bazaar: Review Bazaar Revision with Project Rules` で生成されるreview packetと合わせて使う。

```text
Bazaar revision <REVISION> を project-rule-reviewer mode でレビューしてください。

必ず以下を実施してください。

1. MCP tool `bazaar_log` と `bazaar_diff_revision` で対象revisionのlog/diffを取得する。
2. MCP tool `project_rules_get_checklist` で `.bob/review/checklist.json` を取得する。
3. MCP tool `project_rules_get_schema` で `.bob/review/review-result.schema.json` を取得する。
4. checklistの全ruleを評価する。
5. `pass` と `fail` には必ず evidence を付ける。
6. `fail` には同じ `rule_id` の finding を作る。
7. 判断材料が不足するruleは `unknown` にする。
8. 最初に `review_result_json` fenced block を出す。
9. 次にMarkdownチェックリストを出す。
```

Range reviewの場合:

```text
Bazaar revision range <BASE>..<TARGET> を project-rule-reviewer mode でレビューしてください。
`bazaar_diff_range` を使って差分を取得し、同じ出力契約でレビューしてください。
```
