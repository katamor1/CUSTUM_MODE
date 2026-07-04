# テスト仕様 LIVE-001

## TC-TS001-PAY-0001 プレミアム上限加算

TC-TS001-PAY-0001: `isPremium = 1`、`baseLimit = 5000`、`dailyAmount = 14000` のとき `Payment_CalculateLimit` は `ERR_OK` を返す。
`dailyAmount = 16000` のときは `ERR_LIMIT_EXCEEDED` を返す。

## TC-TS001-PAY-0002 タイムアウト返却

TC-TS001-PAY-0002: `timeoutDetected = 1` のとき `Payment_HandleTimeout` は `ERR_TIMEOUT` を返す。
このケースでは `ERR_OK` を許容しない。
