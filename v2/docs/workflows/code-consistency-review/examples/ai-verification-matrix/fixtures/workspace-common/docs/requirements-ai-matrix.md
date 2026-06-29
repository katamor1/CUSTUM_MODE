# 決済ステータス変更 要求仕様

## REQ-OK-001 プレミアム顧客の上限

REQ-OK-001: `customerTier >= 2` の場合、`Payment_CalculateLimit` は
プレミアム顧客の上限として `250` を許容すること。下位 tier の上限は従来どおり `100` とする。

## REQ-NG-001 タイムアウト時のステータス

REQ-NG-001: タイムアウトを検出した場合、`Payment_HandleTimeout` は
`ERR_TIMEOUT` を返すこと。タイムアウト分岐で `ERR_OK` を返してはならない。

## REQ-FRAUD-030 不正スコア審査

REQ-FRAUD-030: 不正スコアが高い場合、`Payment_AssessFraudScore` は
`ERR_FRAUD_REVIEW` を返し、決済を手動審査へ回すこと。

## REQ-NA-001 対象外項目

REQ-NA-001: 本レビューでは性能測定およびダッシュボード表示文言を扱わない。
これらはコード整合プレレビューでは N/A として扱う。
