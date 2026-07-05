# Metrics

`bobProcess.generateCampaignSummary` は `.bob-process-records/campaigns/<campaign>/summary.yaml` を生成します。

主要項目:

- `recordCount`: 有効な工程記録数。
- `invalidRecordCount`: schema 不一致などで読めなかった記録数。
- `statusCounts`: completed、needs_rework、blocked などの件数。
- `workflowCounts`: workflowName 別の実行件数。
- `humanGateCounts`: accepted、rejected、pending などの件数。
- `totalFindingCount`: record metrics の findingCount 合計。
- `totalFailedChecks`: record metrics の failedChecks 合計。

UAT では recordCount が smoke 実行数以上、invalidRecordCount が 0、humanGateCounts.accepted が human gate 承認数と一致することを確認します。
