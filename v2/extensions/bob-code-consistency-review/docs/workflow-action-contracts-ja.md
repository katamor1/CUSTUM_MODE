# Bob workflow action contract

`bob-code-consistency-review` が workflow-register に公開する action provider ID のローカル contract です。

| Provider ID | Contract |
| --- | --- |
| `bobCodeConsistency.prepareAiTraceabilityDraft` | traceability AI draft 用 prompt を作成する。 |
| `bobCodeConsistency.applyAiTraceabilityDraft` | AI draft JSON を catalog に反映する。 |
| `bobCodeConsistency.openTraceabilityPrep` | Traceability Prep Webview を開く。 |
| `bobCodeConsistency.validateTraceabilityCatalog` | traceability catalog gate を検証する。 |
| `bobCodeConsistency.createReviewInputFromTraceability` | catalog から `review-input.yaml` を生成する。 |
| `bobCodeConsistency.preprocess` | review package を生成する。 |
| `bobCodeConsistency.captureBobOutput` | Bob output YAML を取り込む。 |
| `bobCodeConsistency.validateOutput` | Bob output YAML を検証する。 |
| `bobCodeConsistency.triage` | 人間確認用 triage 成果物を生成する。 |
