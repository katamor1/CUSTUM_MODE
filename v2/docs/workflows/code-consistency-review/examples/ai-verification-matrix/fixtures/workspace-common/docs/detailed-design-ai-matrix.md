# 決済ステータス変更 詳細設計

## DD-OK-001 Payment_CalculateLimit

DD-OK-001: `Payment_CalculateLimit(requestedAmount, customerTier)` は、
`requestedAmount > 0` かつ `customerTier >= 2` の場合に `250` を返す。
有効な下位 tier では `100` を返す。

## DD-NG-001 Payment_HandleTimeout

DD-NG-001: `Payment_HandleTimeout(timeoutDetected)` は、`timeoutDetected` が
true の場合に `ERR_TIMEOUT` を返す。`ERR_OK` を返してよいのはタイムアウトが発生していない場合のみである。

## DD-FRAUD-030 Payment_AssessFraudScore

DD-FRAUD-030: `Payment_AssessFraudScore(score)` は、`score >= 80` の場合に
`ERR_FRAUD_REVIEW` を返す。`80` 未満のスコアでは `ERR_OK` を返す。

## DD-RT-040 リアルタイムキャッシュ更新

DD-RT-040: `Payment_UpdateRealtimeCache` は RT ステータス更新経路で実行される。
この経路では、コンソール出力、ファイル I/O、sleep、メモリ確保、その他のブロッキング処理を実行してはならない。
