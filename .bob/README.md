# .bob Project Review Template

この `.bob` テンプレートは、Bob Bazaar Review 拡張で Bazaar revision/range をプロジェクト規約付きレビューするための一式です。

## 配置

プロジェクト直下にこの `.bob` ディレクトリをコピーします。

```text
<project-root>/
  .bob/
    review/
      checklist.json
      review-result.schema.json
      examples/
        review-result.example.json
    skills/
      project-review-checklist/
        SKILL.md
    workflows/
      bazaar-project-rule-review.md
    custom_modes.yaml
    mcp.json.template
```

`mcp.json.template` はサンプルです。実際の `.bob/mcp.json` は VSCode/Bob IDE で次のコマンドを実行して生成するのが安全です。

```text
Bob Bazaar: Configure Bazaar MCP for Bob
```

## 基本フロー

1. `.bob/review/checklist.json` をプロジェクト規約に合わせて編集する。
2. Bob IDE で Bazaar ワークスペースを開く。
3. `Bob Bazaar: Configure Bazaar MCP for Bob` を実行する。
4. `Bob Bazaar: Review Bazaar Revision with Project Rules` または `Bob Bazaar: Review Bazaar Revision Range with Project Rules` を実行する。
5. Bobの出力JSONを `Bob Bazaar: Validate Project Review Result JSON` で検証する。

## 成果物方針

- 正本: `review_result_json` のJSON
- 表示用: Markdownチェックリスト
- `[x]` は人間向け表示であり、機械判定の正本にはしない

## Status

| status | Markdown | 意味 |
| --- | --- | --- |
| `pass` | `[x]` | 証跡ありで問題なし |
| `fail` | `[ ]` | 規約違反または高リスク |
| `unknown` | `[?]` | 入力不足で判断不能 |
| `not_applicable` | `[-]` | 今回変更には該当しない |
| `blocked` | `[!]` | tool / file / revision / checklist が取得できず評価不能 |
