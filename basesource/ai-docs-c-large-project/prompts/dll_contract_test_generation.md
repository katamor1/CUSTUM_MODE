# Prompt: DLL契約テスト観点生成

対象DLLの公開関数、共有状態、グローバル状態、既存コメント、呼び出し箇所から、契約テスト観点を生成してください。

## 出力形式

| Function | Precondition | Input | Expected Return | Expected State Change | Must Not Change | Error Case | Observation Method | Evidence | Confidence |
|---|---|---|---|---|---|---|---|---|---|

## 禁止事項

- 実装根拠のない期待値を断言しない。
- 不明なエラー仕様を推測で確定しない。
- 実機依存の観測方法を仮定しない。
