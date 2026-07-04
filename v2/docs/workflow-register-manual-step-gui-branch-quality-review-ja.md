# workflow-register manual step GUI 追加差分レビュー

作成日: 2026-07-05

## 対象範囲

- 対象 worktree: `C:\Users\stell\source\repos\bob_builtin_analyze_manual_step_gui`
- 対象 branch: `codex/workflow-register-manual-step-gui`
- 対象 commit: `d9973a89 feat: add manual step action panel`
- 差分範囲: `HEAD^..HEAD`
- 対象外: `HEAD^` 以前の既存コード、および現在別ブランチで進行中の main 側レビュー指摘修正

## レビュー観点別サマリ

| 観点 | 結論 |
| --- | --- |
| コードサイズ | 追加は `src +563/-17`、`test +520/-1`。機能追加としては過大ではないが、`manualStepPanel.ts` が 1 ファイルに controller/view model/HTML/CSS/script を持つため、今後の拡張時は分割候補。 |
| ファイルサイズと責務分割 | 新規 `manualStepPanel.ts` は 271 行、11,226 bytes。初期実装としては許容範囲だが、UI 表示・host message 処理・HTML escape が同居している。 |
| モジュール分割 | 新規 panel は `workflowRegisterService` から 1 方向に呼ばれており、fan-in/fan-out は小さい。`workflowRegisterService.ts` は 440 行まで増えたため、手動 step panel command の肥大化には注意。 |
| 依存パッケージ・bundle サイズ | `dependencies` / `devDependencies` 変更なし。新規 compiled JS は `out/webview/manualStepPanel.js` で 9,666 bytes。bundle 増は主にこの新規 module 分。 |
| 未使用コード | 明確な未使用 runtime 関数は見つからない。ただし `manualStepPanel.ts` の interface 群は export されているが外部 module からは使われておらず、公開面が広い。 |
| 循環依存 | `HEAD^` と `HEAD` はどちらも 1 件で、今回差分による新規循環は 0 件。既存の `workflowBuilderHelpCatalog.ts` <-> `workflowBuilderHelpCatalogExtended.ts` は本レビュー対象外。 |
| 暗黙依存 | 完了確認と完了結果判定に Webview payload / 文字列 prefix への暗黙依存がある。下記 R1/R2。 |
| union/mapped type など型定義量 | mapped type 追加なし。新規 union は `ManualStepActionViewModel.status` 程度で軽い。一方で新規 file の export interface 数が多い。 |
| barrel export 集中度 | 新規 barrel export はなし。集中度悪化は見つからない。 |
| 自動テスト密度 | 追加 test は 520 行、追加 test case は 20 件、assert は 83 件。密度は高いが、Webview message 改変・run/step mismatch・完了結果 structured failure の負例が不足。 |

## 指摘

### R1: Webview payload を trust boundary の内側として扱っている

重要度: P2

該当箇所:

- `extensions/workflow-register/src/webview/manualStepPanel.ts:111`
- `extensions/workflow-register/src/webview/manualStepPanel.ts:161`
- `extensions/workflow-register/src/webview/manualStepPanel.ts:186`
- `extensions/workflow-register/src/bobStepRuntime.ts:66`

`ManualStepPanelController.handleMessage` は Webview から来た `confirmOnComplete` / `confirmMessage` をそのまま使って確認ダイアログの有無を決めている。また、受信 message の検証は `activeKey` の存在確認だけで、`this.current.run.runId` / `this.current.step.id` との照合がない。

このため、手動 step の `userAction.confirmOnComplete: true` は workflow 定義上の意味であるにもかかわらず、Webview 側 payload を変えられると確認を迂回できる。さらに、計画書の「完了ボタン押下では active key / runId / stepId の整合を host 側で確認する」という条件ともずれている。

推奨修正:

- `handleMessage` では `this.current` から `buildManualStepActionViewModel(this.current)` を再計算し、`confirmOnComplete` / `confirmMessage` は host 側で決める。
- `message.activeKey` と現在の `viewModel.activeKey` を比較する。
- `completeStepByKey` に expected run/step を渡せるようにするか、既存の `completeCurrentStep({ expectedRunId, expectedStepId })` 相当の照合経路へ寄せる。
- 回帰テストとして、Webview payload が `confirmOnComplete: false` を送っても host 側定義が true なら確認が出ること、run/step mismatch では完了しないことを追加する。

### R2: 完了成功判定が `Completed:` 文字列 prefix に依存している

重要度: P3

該当箇所:

- `extensions/workflow-register/src/webview/manualStepPanel.ts:124`
- `extensions/workflow-register/src/webview/manualStepPanel.ts:129`
- `extensions/workflow-register/src/webview/manualStepPanel.ts:130`

Panel 側は `completeStepByKey` の戻り値文字列が `Completed:` で始まるかどうかで UI status を `completed` / `error` に分岐している。これは `StepRuntime` の human-readable message 文言に対する暗黙依存で、文言変更・翻訳・詳細メッセージ変更で UI state が変わる。

推奨修正:

- `completeStepByKey` または panel controller に渡す callback の戻り値を `{ ok: boolean; message: string }` のような構造化結果にする。
- 既存 command 向けに文字列 API を残す場合は、panel 用の薄い adapter で構造化する。
- 回帰テストは「成功 message の文言変更で completed 表示が崩れない」形にする。

### R3: `manualStepPanel.ts` の型 export が内部実装に対して広い

重要度: P3

該当箇所:

- `extensions/workflow-register/src/webview/manualStepPanel.ts:5`
- `extensions/workflow-register/src/webview/manualStepPanel.ts:21`
- `extensions/workflow-register/src/webview/manualStepPanel.ts:28`
- `extensions/workflow-register/src/webview/manualStepPanel.ts:34`
- `extensions/workflow-register/src/webview/manualStepPanel.ts:41`
- `extensions/workflow-register/src/webview/manualStepPanel.ts:53`
- `extensions/workflow-register/src/webview/manualStepPanel.ts:63`

新規 file は 7 個の interface と 1 class、2 helper function を export しているが、実利用は `WorkflowRegisterService` が `ManualStepPanelController` を import し、test が `buildManualStepActionViewModel` / `renderManualStepHtml` を import する程度だった。interface 群は現状 external module から直接使われていない。

推奨修正:

- 外部から必要な `ManualStepPanelController` と、テスト seam として必要な helper だけを export する。
- `ManualStepPanelHost` などは module 内 private type に下げ、公開 API 面を狭くする。
- 将来テストで型を直接使う必要が出た場合は、その時点で明示的に export する。

### R4: `manualStepPanel.ts` は初期版としては許容だが、次の拡張で分割した方がよい

重要度: P3

該当箇所:

- `extensions/workflow-register/src/webview/manualStepPanel.ts`

271 行の中に、panel lifecycle、message handling、ViewModel 生成、HTML/CSS/script 生成、escape/safe JSON が入っている。今回の追加量ではまだ破綻していないが、追加ボタンや状態表示、resume 導線を増やすと責務が重くなる。

推奨分割案:

- `manualStepViewModel.ts`: `buildManualStepActionViewModel`
- `manualStepPanelHtml.ts`: `renderManualStepHtml` / escape / safeJson
- `manualStepPanelController.ts`: WebviewPanel lifecycle と host message 処理

ただし、現時点で即時分割が必須というより、R1/R2 の修正時に合わせて切るのがよい。

## 機械集計

### 差分量

`git diff --stat HEAD^..HEAD`:

- 38 files changed
- 1,135 insertions
- 21 deletions

分類別:

| 分類 | ファイル数 | 追加 | 削除 |
| --- | ---: | ---: | ---: |
| src | 24 | 563 | 17 |
| test | 9 | 520 | 1 |
| docs | 3 | 34 | 3 |
| config/schema | 2 | 18 | 0 |

### 新規ファイル

| ファイル | 行数 | bytes | 追加行 |
| --- | ---: | ---: | ---: |
| `extensions/workflow-register/src/webview/manualStepPanel.ts` | 271 | 11,226 | 270 |
| `extensions/workflow-register/test/manualStepPanel.test.js` | 148 | 4,917 | 147 |
| `extensions/workflow-register/test/bobStepRuntimeManualPanel.test.js` | 88 | 2,677 | 87 |
| `extensions/workflow-register/test/workflowAuthoringUserAction.test.js` | 82 | 3,210 | 81 |
| `extensions/workflow-register/test/workflowUserActionSchema.test.js` | 84 | 2,884 | 83 |

### import graph

`HEAD^` と `HEAD` の TypeScript import graph を比較した結果:

- `HEAD^`: cycles 1
- `HEAD`: cycles 1
- 今回 commit で増えた cycle: 0

主な追加/変更 module の依存度:

| module | fan-out | fan-in | 備考 |
| --- | ---: | ---: | --- |
| `webview/manualStepPanel.ts` | 3 | 1 | `workflowRegisterService.ts` からのみ使用。依存は `bobWorkflowTypes.ts` / `model.ts` / `templateRenderer.ts`。 |
| `workflowRegisterService.ts` | 14 | 1 | command orchestration の中心。今回 `manualStepPanel` 依存が増えた。 |
| `bobStepRuntime.ts` | 4 | 3 | `completeStepByKey` / `getActiveStep` の追加で panel completion の seam になった。 |
| `workflowRuntimeFactory.ts` | 12 | 1 | `stepRuntime` を外へ出す seam が増えた。 |

### テスト密度

追加 test:

- 追加 test 行: 520
- 追加 test case: 20
- 追加 assert: 83

主な coverage:

- `completeStepByKey` の対象 active step 完了、missing key
- ViewModel template 展開、fallback、HTML escape、read-only/completed footer
- workflow control block の manual panel link
- package/extension command wiring
- schema/parser/serializer/loader/template/userAction validation

不足している負例:

- Webview payload が `confirmOnComplete` を偽装した場合の host 側再確認
- active key と current run/step の mismatch
- `completeStepByKey` の文言が変わっても UI status が壊れない structured result

## 実行した確認

- `npm.cmd run test` in `extensions/workflow-register`
  - 結果: 216/216 pass
- `git diff HEAD^..HEAD --check`
  - 結果: exit 0
