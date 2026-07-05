# 単体テスト計画

- elapsed_ms が timeout_ms 未満なら OK。
- elapsed_ms が timeout_ms 以上なら ERR_TIMEOUT。
- timeout_ms が 0 の場合は ERR_TIMEOUT。
