# ai-verification-matrix E2E サンプル

このサンプルは `bob-code-consistency-review` を実 AI に接続して検証するためのものです。
実プロジェクトで使う日本語仕様書に近い条件で評価できるよう、照合用ドキュメントと期待値は日本語で記述しています。
`simple-timeout-bugfix` より大きめの差分を使い、1 回の review package で OK、NG、N/A、確認質問の代表ケースをまとめて確認します。

ここでの OK/NG/N/A は Bob の最終承認ではありません。schema 上の出力形に合わせ、OK は `coverage_notes.checked`、NG は `findings`、N/A は `coverage_notes.out_of_scope` または `not_checked` として評価します。

## 構成

```text
ai-verification-matrix/
  README.md
  expected-outcomes.yaml
  bob-output.expected.sample.yaml
  fixtures/
    workspace-common/
      review-input.yaml
      docs/
        requirements-ai-matrix.md
        basic-design-ai-matrix.md
        detailed-design-ai-matrix.md
        test-spec-ai-matrix.md
        error-ledger-ai-matrix.md
        tickets-ai-matrix.md
    baseline/
      src/
      tests/
    head/
      src/
```

サンドボックス起動スクリプトは、これらの fixture から一時 Git リポジトリを作成します。

1. `workspace-common/` と `baseline/` をコピーする。
2. `main` に baseline を commit する。
3. `feature/ai-verification-matrix` に切り替える。
4. `head/` を上書きコピーする。
5. review 対象の差分を commit する。

`review-input.yaml` は `main..feature/ai-verification-matrix` を指定しているため、拡張機能は合成 diff fixture ではなく実 Git 差分を取得します。

## 期待ケース

| 区分 | シナリオ |
| --- | --- |
| OK | `Payment_CalculateLimit` がプレミアム顧客の上限を `250` に変更し、要求、基本設計、詳細設計、テスト仕様と整合している。 |
| NG | `Payment_HandleTimeout` がタイムアウト時に `ERR_OK` を返しており、要求、詳細設計、エラー台帳と不整合である。 |
| NG | `Payment_AssessFraudScore` がしきい値 `90` を使っているが、詳細設計は不正スコア `80` 以上で `ERR_FRAUD_REVIEW` を求めている。さらにテスト仕様に不正審査ケースがない。 |
| NG | `Payment_UpdateRealtimeCache` の RT 経路に `printf` が追加されている。 |
| N/A | 性能測定およびダッシュボード表示文言は `review.out_of_scope` で対象外としている。 |
| Question | `TICKET-AI-105` が不正スコアしきい値の版数確認を求めており、仕様意図の確認が必要である。 |

## 実 AI を使う手動 smoke

先に連携する 3 つの拡張機能を package します。

```powershell
cd extensions\workflow-register
npm.cmd run package
cd ..\bob-bazaar-review
npm.cmd run package
cd ..\bob-code-consistency-review
npm.cmd run package
```

隔離された Bob workspace を作成して起動します。

```powershell
cd C:\Users\stell\source\repos\bob_builtin_analyze
.\docs\workflows\code-consistency-review\integration\launch-bob-code-consistency-sandbox.ps1 -Sample ai-verification-matrix
```

workspace 作成と起動コマンド表示だけを確認する場合は `-NoLaunch` を付けます。

```powershell
.\docs\workflows\code-consistency-review\integration\launch-bob-code-consistency-sandbox.ps1 -Sample ai-verification-matrix -NoLaunch
```

Bob で `code-consistency-review` workflow を実行します。
AI step の出力は YAML のみとし、`final_approval: not_performed` を期待します。
出力は schema-valid かつ evidence-backed である必要がありますが、文章表現や順序はモデルにより変動してかまいません。

## 実 AI なしの決定的チェック

`bob-output.expected.sample.yaml` は、実 AI を呼ばずに capture、validate、triage の経路を確認するための代表出力です。
モデル文言の完全一致を求める golden file ではありません。
