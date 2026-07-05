# 内部仕様

`sample_control_step` は timeout 検出時に `ERR_TIMEOUT` を返す。呼び出し元は戻り値が `OK` の場合だけ後続処理を実行する。
