# live-traceability-sidecar 実機テストデータ

このサンプルは、新しい `bob-code-consistency-review` を実機で確認するための固定データである。
`traceability sidecar -> review-input.yaml -> review-package -> Bob 出力取り込み -> triage` の流れを確認できる。

## 目的

- `.bob-trace/traceability-catalog.json` に承認済み traceability と未承認候補を混在させる。
- `traceability-ai-draft.input.json` と `traceability-ai-draft.proposed.json` で、sidecar catalog 作成前の入力も確認する。
- `main..feature/live-traceability-sidecar` の Git 差分から Bob 用 review package を生成する。
- OK、NG、確認質問、RT/TS ルール指摘の代表ケースを含める。

## ファイル構成

| path | 用途 |
|---|---|
| `traceability-ai-draft.input.json` | `prepareAiTraceabilityDraftPrompt` 相当の実行入力。 |
| `traceability-ai-draft.proposed.json` | AI が返す proposed-only draft。`applyAiTraceabilityDraft` に貼り付けて使える。 |
| `fixtures/workspace-common/.bob-trace/traceability-catalog.json` | 人間承認後の sidecar catalog。未承認候補も 1 件残している。 |
| `fixtures/workspace-common/review-input.yaml` | 承認済み catalog から生成した review-input の固定版。 |
| `fixtures/workspace-common/docs/` | 要求、基本設計、詳細設計、テスト仕様、台帳、レビュー指摘。 |
| `fixtures/baseline/` | `main` ブランチ相当のコード。 |
| `fixtures/head/` | `feature/live-traceability-sidecar` ブランチ相当のコード。 |
| `bob-output.expected.sample.yaml` | Bob 出力取り込み・検証用の代表 YAML。 |
| `expected-outcomes.yaml` | 人間が実機結果を照合する期待結果。 |

## 実機 sandbox で使う

repo root で次を実行する。

```powershell
.\docs\workflows\code-consistency-review\integration\launch-bob-code-consistency-sandbox.ps1 `
  -Sample live-traceability-sidecar
```

VS Code が開いたら Command Palette から以下を順に確認する。

1. `Bob Code Consistency Review: traceability AI draft 用プロンプトを作成`
2. `Bob Code Consistency Review: traceability AI draft JSON を catalog に反映`
3. `Bob Code Consistency Review: traceability prep を開く`
4. `Bob Code Consistency Review: traceability catalog を検証`
5. `Bob Code Consistency Review: traceability catalog から review-input.yaml を生成`
6. `Bob Code Consistency Review: 入力を前処理して Bob 用パッケージを作成`
7. Bob に `.bob-review/review-package/bob-input.md` を渡す
8. `Bob Code Consistency Review: Bob 出力 YAML を取り込む`
9. `Bob Code Consistency Review: Bob 出力 YAML を検証`
10. `Bob Code Consistency Review: 人間確認用 triage を生成`

オフラインで取り込みだけ確認する場合は、`bob-output.expected.sample.yaml` の内容を clipboard に入れて
`Bob 出力 YAML を取り込む` を実行する。

## traceability sidecar 作成入力

`traceability-ai-draft.input.json` は、実機で prompt を作るときの入力値である。
prompt 作成後、AI には生成された `.bob-trace/ai-traceability-draft/ai-draft-prompt.md` を渡す。

AI が返す JSON の固定サンプルとして `traceability-ai-draft.proposed.json` を用意している。
この JSON は全要素が `status: proposed` で、`id`、`from`、`to` を持たない。
Command Palette の `traceability AI draft JSON を catalog に反映` は clipboard から読むため、
このファイルの内容を clipboard に入れると sidecar 作成部分を単体で確認できる。

## 期待される代表結果

- `Payment_CalculateLimit`: プレミアム上限の仕様・設計・テストと整合する OK ケース。
- `Payment_HandleTimeout`: タイムアウト時に `ERR_OK` を返す NG ケース。
- `Payment_AssessFraudScore`: 不正スコアしきい値変更とテスト不足の確認質問ケース。
- `Payment_UpdateRealtimeCache`: RT 経路に `printf` が入る RT/TS ルール指摘ケース。
