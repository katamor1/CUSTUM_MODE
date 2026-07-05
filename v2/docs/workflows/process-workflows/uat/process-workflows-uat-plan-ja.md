# UAT Plan

## 事前準備

`docs/workflows/process-workflows/integration/launch-process-workflows-sandbox.ps1 -NoLaunch` で sandbox workspace を生成します。実機確認時は `-NoLaunch` を外し、VS Code/Bob を起動します。

## 6 workflow smoke

少なくとも次の 6 workflow を実行します。

- process-code-doc-investigation
- process-qa-intake-analysis
- process-common-review
- process-code-precheck
- process-unit-test-design
- process-functional-test-design

各 workflow で `process-input.yaml` を指定し、human gate で承認して次へ進みます。

## 確認項目

- Bob UI に 14 workflow が表示される。
- `schemaVersion: workflow-register/v1` の parse error がない。
- `.bob-process-runs/<runId>/evidence-index.json` と `review-result.yaml` が生成される。
- `.bob-process-records/campaigns/<campaign>/records/<runId>/record.yaml` が生成される。
- `.bob-process-records/campaigns/<campaign>/summary.yaml` の recordCount が増える。
- `process-code-precheck` で Phase 2 validateOutput と triage の結果が `phase2Handoff` に残る。
