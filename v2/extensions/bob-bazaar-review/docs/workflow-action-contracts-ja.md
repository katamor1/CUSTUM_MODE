# Bob workflow action contract

`bob-bazaar-review` が workflow-register に公開する action provider ID のローカル contract です。

| Provider ID | Contract |
| --- | --- |
| `bobBazaar.openReviewGui` | Bazaar review GUI を開く。 |
| `bobBazaar.collectReviewContext` | review target、変更ファイル、packet summary を収集する。 |
| `bobBazaar.loadReviewRules` | `.bob/review/checklist.json` と `.bob/review/review-result.schema.json` を読み込む。 |
| `bobBazaar.captureReviewResult` | Bob 出力から review-result JSON を取り込み、検証して保存する。 |
