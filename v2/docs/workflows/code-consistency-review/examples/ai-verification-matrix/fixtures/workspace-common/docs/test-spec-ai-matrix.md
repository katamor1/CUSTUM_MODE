# 決済ステータス変更 テスト仕様

## TC-OK-010 プレミアム顧客の上限

TC-OK-010: `requestedAmount = 120` かつ `customerTier = 2` の場合、
`Payment_CalculateLimit` は `250` を返すこと。

## TC-TIMEOUT-020 タイムアウトステータス

TC-TIMEOUT-020: `timeoutDetected = true` の場合、`Payment_HandleTimeout` は
`ERR_TIMEOUT` を返すこと。

## 不正審査カバレッジ注記

`REQ-FRAUD-030` および `DD-FRAUD-030` に対応するテストケースは、現時点では定義されていない。
