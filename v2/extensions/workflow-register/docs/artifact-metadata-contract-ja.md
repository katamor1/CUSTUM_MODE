# Bob artifact metadata contract

この文書は、Bob 連携拡張が生成する成果物 metadata のローカル contract です。metadata の追加は additive であり、既存成果物の破壊的 schema 変更ではない。

## Common fields

- `artifact_metadata`
- `.artifact-metadata.json`
- `producer_extension`
- `producer_version`
- `workflow_run_id`
- `source_vcs`
- `source_revision`
- `input_hash`
- `contains_sensitive_context`
- `human_review_required`

## Extension-specific paths

- `bob-code-consistency-review`: `.bob-review/review-package/manifest.yaml` の `artifact_metadata`
- `bob-bazaar-review`: `.bob/review/results/<review_id>.artifact-metadata.json` の sidecar metadata
