# 基本設計 LIVE-001

## BD-BD001-PAY-0001 上限計算

BD-BD001-PAY-0001: `Payment_CalculateLimit` は顧客区分を判定し、プレミアム顧客だけ `baseLimit + 10000` を上限とする。
上限超過時は `ERR_LIMIT_EXCEEDED`、範囲内は `ERR_OK` を返す。

## BD-BD001-PAY-0002 タイムアウト返却

BD-BD001-PAY-0002: `Payment_HandleTimeout` は `timeoutDetected` を最初に確認する。
真の場合は他の状態更新を行わず `ERR_TIMEOUT` を呼び出し元へ返却する。

## BD-BD001-FRAUD-0001 不正審査判定

BD-BD001-FRAUD-0001: `Payment_AssessFraudScore` は `fraudScore >= 80` を審査対象とし、`ERR_FRAUD_REVIEW` を返す。
未満の場合だけ `ERR_OK` とする。

## BD-BD001-RT-0001 リアルタイムキャッシュ

BD-BD001-RT-0001: `Payment_UpdateRealtimeCache` は共有状態の更新だけを行う。
RT タスクから呼ばれるため、同期 I/O と標準出力は禁止する。
