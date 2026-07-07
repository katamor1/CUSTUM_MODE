# Phase 1 Bazaar レビュー実績 campaign テンプレート

このローカルテンプレートは、bob-bazaar-review extension 単体のテストで利用する UAT contract です。

## 成果物

```text
.bob-review-records/
  campaigns/<campaign_id>/
    campaign.yaml
    targets.yaml
    records/<review_id>/
      record.yaml
      triage.yaml
    summary.json
    summary.md
```

## UAT ケース

- BZR-RT-036: campaign 初期化で `.bob-review-records` を用意する。
- BZR-RT-043: campaign summary から報告 Markdown を作成する。

## Human triage decision

- accepted
- rejected
- needs_investigation
- deferred
