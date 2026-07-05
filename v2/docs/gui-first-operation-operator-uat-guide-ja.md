# GUIファースト操作 Operator / UAT ガイド

- 対象: GUI-00 から GUI-07
- 対象拡張: `workflow-register`, `bob-bazaar-review`, `bob-code-consistency-review`
- 前提: 主要操作は Command Palette ではなく Bob Operation Hub と各 GUI から開始する。既存 command は互換用に残す。

## 1. 起動

1. VS Code で対象 workspace を開く。
2. Explorer の `Bob Operation Hub` を開く。
3. `セットアップ` で `.bob`, workflow, MCP, traceability の状態を確認する。
4. 目的に応じて次の入口を使う。

| 目的 | GUI 入口 |
|---|---|
| Bazaar レビュー | `Bob Operation Hub` > `Bazaar レビューを開始` |
| 整合プレレビュー | `Bob Operation Hub` > `整合プレレビューを開始` |
| workflow 実行 | `Bob Operation Hub` > `ワークフロー一覧` > `開始` |
| 中断 run の再開 | `Bob Operation Hub` > `Run Monitor` |
| Bob 出力取り込み | 各 Review GUI > `Result Capture` |
| 採否判断 | 各 Review GUI > `Human Triage` |

## 2. Bazaar レビュー UAT

対象: `bob-bazaar-review`

1. `Bob Operation Hub` から `Bazaar レビューを開始` を押す。
2. `Wizard v2` の手順を確認する。
3. Bazaar workspace を選択する。
4. `1リビジョン`, `リビジョン範囲`, `TOPリビジョンと未コミット差分` のいずれかを選ぶ。
5. `対象情報を取得` を押し、変更ファイル一覧が出ることを確認する。
6. `レビューして Bob に追加` を押す。
7. `Result Capture を開く` から Bob 出力 JSON を貼り付け、保存前 validation が走ることを確認する。
8. `Human Triage を開く` から campaign / review_id を入力し、triage 雛形、decision 保存、summary 生成を確認する。

合格条件:

- Command Palette を使わず review packet 作成まで進める。
- invalid review-result JSON は保存されない。
- triage decision が `.bob-review-records` 配下に保存される。
- 既存 `bobBazaar.*` command も引き続き利用できる。

## 3. 整合プレレビュー UAT

対象: `bob-code-consistency-review`

1. `Bob Operation Hub` から `整合プレレビューを開始` を押す。
2. `Consistency Review Wizard` で VCS、base/head、変更種別を確認する。
3. `Evidence Picker` の文書候補を選ぶ。
4. `Review Focus` を選ぶ。
5. 必要に応じて `Traceability Prep を開く` で proposed item を承認する。
6. `選択内容から review-input を生成` を押し、`review-input.yaml` が画面操作から生成されることを確認する。
7. `Bob 用パッケージを作成` を押し、`Package Preview` が更新されることを確認する。
8. `Result Capture` で Bob output YAML を貼り付け、schema / evidence ref validation を確認する。
9. `Human Triage` で `triage-result.yaml` を生成し、finding / question の decision を保存する。

合格条件:

- 標準ケースで `review-input.yaml` を手編集しない。
- workspace 外 path は選択・保存できない。
- evidence ref error がある Bob output は validation error になる。
- `triage-result.yaml` に decision / owner / reason が保存される。

## 4. Run Monitor UAT

対象: `workflow-register`

1. `Bob Operation Hub` を開く。
2. `ワークフロー一覧` から任意の workflow を開始する。
3. 実行中または停止中 run が `Run Monitor` に表示されることを確認する。
4. 状態に応じて `承認して次へ`, `再試行`, `再開`, `手順を開く`, `詳細`, `成果物を開く` の表示を確認する。

合格条件:

- run state は `.bob/workflows/runs` の内容と一致する。
- GUI action は既存 `workflowRegister.*` command だけを呼ぶ。
- workspace 外 artifact は開けない。

## 5. Sandbox Smoke

次の launcher を使い、各 GUI が sandbox workspace で開けることを確認する。

```powershell
docs\workflows\bazaar-project-rule-review\integration\launch-bob-bazaar-review-sandbox.ps1
docs\workflows\code-consistency-review\integration\launch-bob-code-consistency-sandbox.ps1
docs\workflows\process-workflows\integration\launch-process-workflows-sandbox.ps1
```

UAT 実施時は次を記録する。

| 項目 | 記録内容 |
|---|---|
| workspace | sandbox path |
| VSIX | 3 拡張の package 結果 |
| 操作 | Hub から開始した導線 |
| 成果物 | review-input, review-package, bob-output, triage, summary |
| 失敗 | validation error, missing setup, recovery action |

## 6. Regression Gate

UAT 前に次を実行する。

```powershell
cd extensions\workflow-register
npm.cmd test
npm.cmd run architecture:policy
npm.cmd run source:policy
npm.cmd run package
npm.cmd run package:policy

cd ..\bob-bazaar-review
npm.cmd test
npm.cmd run architecture:policy
npm.cmd run source:policy
npm.cmd run package
npm.cmd run package:policy

cd ..\bob-code-consistency-review
npm.cmd test
npm.cmd run architecture:policy
npm.cmd run source:policy
npm.cmd run package
npm.cmd run package:policy
```

すべて成功してから UAT を開始する。
