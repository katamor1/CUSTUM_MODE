# 要求仕様 LIVE-001

## REQ-RS001-PAY-0001 プレミアム顧客の上限

REQ-RS001-PAY-0001: プレミアム顧客は一日の基本上限 `baseLimit` に 10000 を加算した値まで利用できる。
通常顧客は `baseLimit` を超えた場合に `ERR_LIMIT_EXCEEDED` を返す。

## REQ-RS001-PAY-0002 タイムアウト扱い

REQ-RS001-PAY-0002: 決済ステータス確認で `timeoutDetected` が真の場合、`ERR_TIMEOUT` を返す。
タイムアウトを正常完了の `ERR_OK` として扱ってはならない。

## REQ-RS001-FRAUD-0001 不正スコア審査

REQ-RS001-FRAUD-0001: `fraudScore` が 80 以上の場合、決済を自動承認せず `ERR_FRAUD_REVIEW` を返す。
しきい値を変更する場合はリスクオーナーの承認とテスト仕様の更新を必要とする。

## REQ-RS001-RT-0001 RT 経路の副作用制約

REQ-RS001-RT-0001: リアルタイムキャッシュ更新経路では `printf`、ファイル I/O、同期ログ出力を行わない。
必要な計測は非同期 trace buffer に記録する。
