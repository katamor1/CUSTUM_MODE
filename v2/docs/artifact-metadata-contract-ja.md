# Bob artifact metadata contract

この文書は Bob 連携拡張が生成する成果物 metadata の共通 contract です。metadata は監査・再現・人間確認のために追加するもので、既存成果物の破壊的 schema 変更ではない。

## Common fields

| Field | Required | Meaning |
| --- | --- | --- |
| `producer_extension` | yes | 成果物を生成した VSIX 名。例: `bob-code-consistency-review`、`bob-bazaar-review`。 |
| `producer_version` | yes | 生成した拡張の package version。 |
| `workflow_run_id` | yes | `workflow-register` から渡された run ID。workflow 外実行では空文字列にする。 |
| `source_vcs` | yes | 入力差分の VCS。例: `git`、`bazaar`。 |
| `source_revision` | yes | 生成対象の revision / range。例: `HEAD~1..HEAD`、`2`、`1..2`。 |
| `input_hash` | yes | metadata を除いた主要入力の `sha256:<hex>`。 |
| `contains_sensitive_context` | yes | source code、社内文書、raw diff、Bob output など機微文脈を含み得る場合は `true`。 |
| `human_review_required` | yes | 正式判断前に人間確認が必要な成果物では `true`。 |

## bob-code-consistency-review

`bob-code-consistency-review` は `.bob-review/review-package/manifest.yaml` に additive section として `artifact_metadata` を追加します。既存 field は削除・改名しません。

```yaml
artifact_metadata:
  producer_extension: bob-code-consistency-review
  producer_version: 0.1.0
  workflow_run_id: run-...
  source_vcs: git
  source_revision: HEAD~1..HEAD
  input_hash: sha256:...
  contains_sensitive_context: true
  human_review_required: true
```

## bob-bazaar-review

`bob-bazaar-review` は review-result JSON 本体に metadata を混ぜません。project schema 互換性を守るため、metadata は sidecar JSON として `.bob/review/results/<review_id>.artifact-metadata.json` に保存します。

```json
{
  "producer_extension": "bob-bazaar-review",
  "producer_version": "0.3.0",
  "workflow_run_id": "run-...",
  "source_vcs": "bazaar",
  "source_revision": "2",
  "input_hash": "sha256:...",
  "contains_sensitive_context": true,
  "human_review_required": true
}
```

## Compatibility

- metadata の追加は additive であり、既存 JSON / YAML field の削除、rename、意味変更はしません。
- `bob-bazaar-review` の review-result JSON は project schema 検証対象なので、metadata は必ず sidecar に分離します。
- `bob-code-consistency-review` の manifest は review-package の管理 metadata なので、`artifact_metadata` section を同一ファイルに追加します。
