# 詳細設計 LIVE-001

## DD-DD001-PAY-0001 プレミアム上限の実装

DD-DD001-PAY-0001: `Payment_CalculateLimit` は `context->isPremium` が真の場合に `limit += 10000` を実行する。
判定後に `dailyAmount > limit` なら `ERR_LIMIT_EXCEEDED`、それ以外は `ERR_OK` を返す。

## DD-DD001-PAY-0002 タイムアウト分岐

DD-DD001-PAY-0002: `Payment_HandleTimeout` は `timeoutDetected` が真なら即時に `ERR_TIMEOUT` を返す。
この分岐で `ERR_OK` を返す実装は要求違反である。

## DD-DD001-FRAUD-0001 不正スコア分岐

DD-DD001-FRAUD-0001: `Payment_AssessFraudScore` は `fraudScore >= 80` を条件に `ERR_FRAUD_REVIEW` を返す。
しきい値を 80 から変更する場合は、要求とテスト仕様の更新を同時に行う。

## DD-DD001-RT-0001 RT 経路の禁止 API

DD-DD001-RT-0001: `Payment_UpdateRealtimeCache` では `printf`、`fprintf`、ファイル書き込み、同期ログ出力を使わない。
障害解析用の値は lock-free な trace buffer に残す。
