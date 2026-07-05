# Phase 3 工程別 Bob ワークフロー

この配下は Phase 3 の工程別 workflow を、CODEX と実機 UAT の両方で実行できるようにするための運用資産です。

対象 workflow は `.bob/workflows/process-*` の 14 件です。

- process-code-doc-investigation
- process-qa-intake-analysis
- process-external-spec-design
- process-external-spec-review
- process-internal-spec-design
- process-internal-spec-review
- process-coding-plan
- process-code-precheck
- process-unit-test-design
- process-unit-test-execution-review
- process-functional-test-design
- process-functional-test-execution-review
- process-integration-test-design
- process-common-review

実行の入口は `process-input.yaml` です。生成物は `.bob-process-runs/`、工程記録と集計は `.bob-process-records/` に保存されます。これらは生成物なので git では追跡しません。

詳細は `schema-contracts-ja.md`、`uat/process-workflows-uat-plan-ja.md`、`rollout-guide-ja.md`、`metrics/process-workflows-metrics-ja.md` を参照してください。
