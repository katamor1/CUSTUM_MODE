# timeout 制御要求書

- document_id: DOC-REQ-SAMPLE-001
- version: 1.0
- updated_at: 2026-06-29

## REQ-123 timeout 発生時の異常終了

制御処理で timeout が発生した場合、処理は正常終了してはならない。

timeout 発生時は、戻り値として `ERR_TIMEOUT` を返し、上位処理が異常終了として扱えるようにする。

## REQ-124 timeout カウンタ

timeout が発生した場合、診断用の timeout カウンタを 1 加算する。

## REQ-125 ログ出力

timeout の詳細ログは TS 側で出力する。RT 側ではファイル I/O を行わない。
