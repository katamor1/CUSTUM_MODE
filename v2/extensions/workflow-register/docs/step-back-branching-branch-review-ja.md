# Step-back branching branch hygiene review

作成日: 2026-07-05

対象: `codex/step-back-branching` の `main...HEAD` 差分のうち `extensions/workflow-register` 配下のみ。

対象外: `main` 以前から存在する実装、別ブランチで対応中の既存レビュー指摘、今回の差分で触っていない構造問題。

## サマリ

今回の差分は 34 ファイル、2424 insertions / 44 deletions。実装追加は core branching runtime、schema/parser/validator、workflow builder、branch checkpoint command、sample/test に分かれている。

依存パッケージ追加、lockfile 変更、barrel export 追加、追加ファイル起点の循環依存は見つからなかった。一方で、`entryStep` の意味が runtime で強制されないこと、branching 関連型が `model.ts` に集中していること、webview の JSON 編集と global script 依存が強いこと、command/API/manifest のテスト密度に偏りがあることは残リスクとして扱う。

## 実測メトリクス

| 項目 | 結果 |
| --- | --- |
| 差分境界 | `git diff main...HEAD -- extensions/workflow-register` |
| 差分量 | 34 files changed, 2424 insertions, 44 deletions |
| src 追加行 | 1339 insertions |
| test 追加行 | 708 insertions |
| 追加 test case | 10 件 |
| 依存追加 | なし。`package.json` は command/activation/contribution 追加のみ |
| lockfile 変更 | なし |
| 追加 file 起点の循環依存 | 0 件 |
| barrel export 追加 | なし |
| VSIX 実測 | `vsce package` が local `node_modules` の transitive 欠損で失敗したため未確定 |
| 配布下限増分の目安 | 新規 compiled branching/manual files + sample + schema で約 46KB |

## Findings

### P2: `entryStep` が validation-only metadata になっている

`WorkflowBranchLoopDefinition.entryStep` は schema/model で必須化され、validator は存在確認をしている。しかし runtime は branch 適用時に `transition.goto` と `decision.loop` だけを使い、`goto` が loop の `entryStep` と一致するかを確認しない。

そのため、workflow author から見ると `entryStep` が loop の戻り先を制約しているように見えるが、実際には違う step に `goto` しても loop count/checkpoint が進む。これは暗黙依存として危険で、loop 定義の責務が不明瞭になる。

参照:

- `src/core/model.ts:97-103`
- `src/core/workflowSchema.ts:82-88`
- `src/core/workflowValidator.ts:180-184`
- `src/core/engine/branchTransitions.ts:63-67`

推奨:

- `decision.loop` がある backward transition では `decision.goto === loop.entryStep` を validator で error にする。
- もし `entryStep` が説明用 metadata なら、必須をやめて名前を変える。

### P2: Branch transition runtime の責務が 1 ファイルに集まり始めている

`src/core/engine/branchTransitions.ts` は 242 行で、現時点では巨大ではない。ただし責務は多い。

- transition の解決結果適用
- checkpoint 到達時の run mutation
- checkpoint approve/abort
- run.branching 初期化
- reset 範囲の step attempt archive
- produced state cleanup / lastValues backup
- branch history 記録

Phase 4/5 の manual form/approval UX や diagnostics 統合が入ると、このファイルにさらに状態遷移・監査・UI 用データ整形が増えやすい。

参照:

- `src/core/engine/branchTransitions.ts:21-115`
- `src/core/engine/branchTransitions.ts:117-154`
- `src/core/engine/branchTransitions.ts:157-172`
- `src/core/engine/branchTransitions.ts:175-228`
- `src/core/engine/branchTransitions.ts:230-254`

推奨:

- 次の実装前に `branchState.ts`、`branchCheckpoint.ts`、`branchReset.ts` へ分割する。
- `applyStepTransition` は orchestration に寄せ、個別 mutation を小さい関数に閉じ込める。

### P2: 型定義が `model.ts` に集中し、transition default の union が実質 `string`

今回の追加で branching definition、transition definition、manual form/approval、run branching state、checkpoint state、history record が `src/core/model.ts` にまとまって追加された。`model.ts` は core の中心型置き場なので一定の集中は自然だが、今回の増分で public schema 型と run-time persisted state 型が同じファイルにさらに寄った。

また `WorkflowTransitionDefaultAction = "next" | "end" | "fail" | string` は TypeScript 上は実質 `string` であり、union としての制約は効かない。実際の予約語判定は validator/resolver の runtime logic に分散している。

参照:

- `src/core/model.ts:92-153`
- `src/core/model.ts:116`
- `src/core/model.ts:351-390`
- `src/core/workflowValidator.ts:223-226`

推奨:

- 定義型は `branchingDefinitions.ts`、run state 型は `branchingState.ts` のように分離する。
- `WorkflowTransitionDefaultAction` は単なる `string` にするか、`{ kind: "next" | "end" | "fail" } | { kind: "goto"; stepId: string }` のような区別可能 union にする。

### P2: Webview field event script の暗黙 global 依存と JSON 編集面が増えている

workflow builder は既存方針として script fragment を `String.raw` で組み立て、global な `model` / `selectedStep()` / `requestPreview()` / `render()` に依存している。今回の差分では manual form、manual approval、transition decisions JSON の編集が `workflowBuilderFieldEventsScript.ts` に増えた。

問題は、JSON parse 失敗を握りつぶすことと、型付き editor ではなく raw JSON textarea で `form.fields` / `transition.decisions` を編集すること。GUI 上では保存前 preview に任せる作りだが、入力時点では壊れた JSON が silently ignored され、ユーザーは変更が反映されなかった理由を把握しにくい。

参照:

- `src/webview/workflowBuilderFieldEventsScript.ts:32-42`
- `src/webview/workflowBuilderFieldEventsScript.ts:44-60`
- `src/webview/workflowBuilderStepRendererScript.ts:60-71`

推奨:

- JSON textarea は一時的な詳細編集に限定し、loop/decision/form field は row-based editor に寄せる。
- JSON parse error を preview diagnostics へ明示する。
- branch/form/approval の editor state を webview script 内の専用 helper に分離する。

### P3: 外部向け extension API に branch checkpoint command が露出していない

`workflowRegister.approveBranchCheckpoint`、`workflowRegister.abortBranchCheckpoint`、`workflowRegister.inspectBranching` は VS Code command として登録されているが、`WorkflowRegisterApi` の返却 object には追加されていない。companion extension が branch checkpoint を扱う場合、型付き API ではなく command id 文字列に戻る必要がある。

これは現時点で即時バグではないが、branch checkpoint を public workflow runtime 能力として扱うなら API surface が片手落ちになる。

参照:

- `src/extension.ts:11-64`
- `src/extension.ts:95-97`
- `src/extension.ts:110-118`

推奨:

- public API に approve/abort/inspect を追加するか、明示的に command-only として docs に書く。
- 追加するなら `WorkflowRegisterApi` の互換性方針も docs に残す。

### P3: 追加 command の manifest coverage が薄い

`package.json` には branch checkpoint command の activation/contribution/menu が追加されている。一方、`workflowRegister.test.js` の command manifest loop は既存 runtime command までで、追加 branch command は source regex 登録確認だけになっている。

そのため、`extension.ts` に command registration が残っていれば、`package.json` contribution が欠落しても一部テストは通る。

参照:

- `package.json:38-43`
- `package.json:75-80`
- `package.json:171-176`
- `test/workflowRegister.test.js:62-77`

推奨:

- `assertContributesCommand` の対象に branch checkpoint command 3 件を追加する。
- activationEvents と contributes.commands の両方が一致する helper に寄せる。

### P3: 不要に外部 export されている追加 helper がある

以下は今回追加された export だが、現在の参照は同一ファイル内か近接 module に閉じている。

- `resolveStateValue`: `conditionEvaluator.ts` 内からのみ利用。
- `normalizeStepTransition`: `normalizers.ts` 内からのみ利用。
- `normalizeManualForm`: `normalizers.ts` 内からのみ利用。
- `normalizeManualApproval`: `normalizers.ts` 内からのみ利用。

小さい問題だが、今後の API 読み取り時に public helper と internal helper の区別が曖昧になる。

参照:

- `src/core/branching/conditionEvaluator.ts:25`
- `src/core/parser/normalizers.ts:201`
- `src/core/parser/normalizers.ts:231`
- `src/core/parser/normalizers.ts:251`

推奨:

- テストから直接使う予定がない helper は non-export にする。
- parser normalizer の external seam は `normalizeBranching` / `normalizeEngineStep` までに絞る。

## 観点別レビュー

### コードサイズ

今回の src 追加は 1339 行。最大の増分は validator 150 行、field events 148 行、model 115 行、normalizers 99 行、workflow service 88 行、new `branchTransitions.ts` 254 行。

単体で 300 行を超える新規ファイルはないが、既存大ファイルへ追加した結果、`workflowRegisterService.ts` 422 行、`engine.ts` 405 行、`workflowValidator.ts` 391 行、`model.ts` 377 行になっている。今後の追加は既存大ファイルへの追記ではなく、分割先を先に作る方が追跡しやすい。

### ファイルサイズと責務分割

良い点:

- condition evaluation と transition resolution は `src/core/branching/` に分かれている。
- engine 本体への追加は `applyStepTransition` 呼び出しに抑えられている。
- parser/schema/validator/authoring serializer の責務は既存構造に沿っている。

懸念:

- `branchTransitions.ts` は runtime mutation が集まり始めている。
- `workflowRegisterService.ts` に checkpoint command と branch inspect report が追加され、service の command orchestration 責務が広がっている。
- webview は raw script fragment 内の global state mutation が増えた。

### モジュール分割

core branching の読み方向はおおむね一方向。

`engine.ts -> engine/branchTransitions.ts -> branching/transitionResolver.ts -> branching/conditionEvaluator.ts -> model.ts`

この分割は循環を作っていない。次の分割候補は `branchTransitions.ts` 内の checkpoint / reset / history。

### 依存パッケージ・bundle サイズ

`package.json` 差分は command/activation/contribution の追加のみで、dependencies/devDependencies の追加はない。lockfile の差分もない。

`vsce package` は local `node_modules` の transitive 欠損で実測できなかった。`.vscodeignore` は今回変更なしで、`src/**` と `test/**` は VSIX 除外対象。配布に乗る可能性が高い今回追加分の下限は、新規 compiled branching/manual files、sample、schema で約 46KB。docs の追記も VSIX に含まれる設定なので、ドキュメント追加が続く場合は docs/samples の配布方針を別途決める価値がある。

### 未使用コード

追加 runtime export の主要経路は参照されている。

- `evaluateTransitionCondition` -> `transitionResolver`
- `resolveStepTransition` -> `branchTransitions`
- `applyStepTransition` -> `engine`
- `approveBranchCheckpointTransition` / `abortBranchCheckpointTransition` -> `engine`

一方で internal helper 相当の export が残っている。P3 finding 参照。

### 循環依存

簡易 import graph 検査では、今回変更された TS ファイルから到達可能な cycle は 0 件。

ただし webview script は import graph ではなく文字列連結と global 関数で接続されるため、TypeScript の依存グラフでは検出できない暗黙依存が残る。

### 暗黙依存

主な暗黙依存は 3 点。

- `entryStep` の意味が runtime で強制されず、validator と author の期待に依存する。
- branch reset は `workflow.engineSteps[index]` と `run.steps[index]` の順序一致に依存する。
- webview field event script は global `model` / `selectedStep()` / `requestPreview()` / `render()` に依存し、JSON parse error を UI state として保持しない。

### union/mapped type などの型定義量

mapped type の過剰利用はない。union は既存 `EngineStep` / `ResultSourceDefinition` の延長で自然。ただし `WorkflowTransitionDefaultAction` は union 風だが実質 `string` で、型の意味が薄い。

branching definition と run branching state が `model.ts` に集中したため、次に型を増やすならファイル分割が望ましい。

### barrel export の集中度

今回の差分で `export *` や新しい barrel module は増えていない。既存の re-export 集約点は `bobWorkflowRunner.ts` と `core/parser.ts` / `core/parser/index.ts` だが、今回の branching 追加による集中悪化はない。

### 自動テスト密度

量としては src 1339 行に対して test 708 行、追加 test case 10 件で悪くない。core engine/schema/parser/serializer/sample validation は十分に厚い。

不足:

- Bob UI runner 経由の manual form/approval capture。
- Command Palette fallback の structured input/approval。
- workflow builder で loop 定義を GUI 作成する経路。
- branch checkpoint command の package manifest contribution。
- `entryStep` と actual backward target の整合性。

## 実行した確認

- `git diff --shortstat main...HEAD -- extensions/workflow-register`
- `git diff --numstat main...HEAD -- extensions/workflow-register`
- `git diff --name-status main...HEAD -- extensions/workflow-register`
- `git diff main...HEAD -- extensions/workflow-register/package.json`
- 追加 TS ファイル起点の簡易 import cycle 検査
- 追加 export の参照 grep
- `npm.cmd pack --dry-run --json`
- `npm.cmd ls --omit=dev --depth=0`
- `npm.cmd ls --depth=0`
- `npm.cmd run package -- --out %TEMP%/...`
- `npm.cmd install --no-package-lock --ignore-scripts --no-save --strict-ssl=false`
- `npm.cmd test`

補足:

- `npm.cmd pack --dry-run --json` は `.vscodeignore` を見ないため、VSIX サイズ根拠としては採用しない。
- 初回の `npm.cmd ls` はローカル `node_modules` の extraneous/invalid 状態で `ELSPROBLEMS` を返した。`npm.cmd install --no-package-lock --ignore-scripts --no-save --strict-ssl=false` 後の `npm.cmd ls --omit=dev --depth=0` は runtime dependency として `ajv` と `js-yaml` のみを表示した。
- `npm.cmd run package` は `@vscode/vsce` 経由で `xmlbuilder` の `./XMLDOMImplementation` を解決できず失敗した。今回の review では VSIX 実サイズは未確定。
- `npm.cmd test` は 206 tests / 206 pass。

## 次の修正候補

1. `entryStep` と `decision.goto` の整合性を validator に追加する。
2. `WorkflowTransitionDefaultAction` を `string` に寄せるか、区別可能 union に変更する。
3. `branchTransitions.ts` を checkpoint/reset/history に分割する。
4. `workflowRegister.test.js` の manifest assertion に branch command 3 件を追加する。
5. internal helper export を削る。
6. GUI Builder の branching loop editor と JSON parse diagnostics を追加する。

## 対策実施結果

実施日: 2026-07-05

主要実装コミット:

- `bfeb4267` `Validate branch loop targets and future state`
- `d4c3874e` `Split branch transition runtime responsibilities`
- `01e783b7` `Wire structured manual completion prompts`
- `c8193d5b` `Expose branch checkpoint diagnostics and API`
- `56a6ef3e` `Add branching controls to workflow builder`

この最終レビュー文書更新コミットでは、上記対応の検証結果追記と internal helper export の整理を行った。

### Findings 別対応状況

| 指摘 | 対応 |
| --- | --- |
| `entryStep` が validation-only metadata | `decision.loop` 付き transition が loop の `entryStep` 以外へ戻る場合を validator error にした。future step が producer の `stateKey` 参照も error にした。 |
| `branchTransitions.ts` の責務集中 | `branchState.ts`、`branchReset.ts`、`branchHistory.ts`、`branchCheckpoint.ts` へ分割し、`branchTransitions.ts` は orchestration に縮小した。 |
| `WorkflowTransitionDefaultAction` が実質 `string` | 型定義を `string` に単純化し、予約 action の意味は runtime/validator 側へ寄せた。 |
| Webview JSON 編集の黙殺 | manual form fields、transition decisions、command extra args の JSON parse error を `editorDiagnostics` として Preview / Diagnostics に表示するようにした。 |
| branch checkpoint command が public API にない | `WorkflowRegisterApi` に `approveBranchCheckpoint`、`abortBranchCheckpoint`、`inspectBranching` を追加した。 |
| manifest coverage が薄い | branch checkpoint command 3 件を `assertContributesCommand` の対象に追加した。 |
| internal helper export | `resolveStateValue`、`normalizeStepTransition`、`normalizeManualForm`、`normalizeManualApproval` を internal function に戻した。 |

### 追加対応

- Bob UI / Command Palette / standalone engine の manual step completion で、structured form values と approval result を `ManualCompletionResult` として engine に返すようにした。
- `checkpoint` status を Bob runner の成功扱いに追加し、checkpoint 到達を Bob 側 failure として扱わないようにした。
- `inspectRunDiagnostics` に branch loops、checkpoint、branching history を統合し、`inspectBranching` と shared formatter を使うようにした。
- GUI Builder に Branching タブを追加し、loop id、entryStep、maxIterations、extensionSize、checkpoint title/message を編集できるようにした。
- Preview / Diagnostics に transition preview を追加し、backward transition と loop 指定を確認しやすくした。

### 再レビュー観点の結果

- コードサイズ: 追加対策後の分割により `branchTransitions.ts` は 103 行規模に縮小し、branch runtime の新規 module は 22-84 行に収まった。`bobStepRuntime.ts` は structured completion 対応で増加したが、prompt UI は `manualStepPrompt.ts` に分離した。
- ファイル責務: branch runtime、manual prompt、branch diagnostics formatter を分離し、service/webview への追記を最小化した。
- 依存・bundle: package dependency / lockfile の tracked 変更はない。VSIX は `workflow-register-step-back.vsix` として 858 files、1.12 MB で生成できた。
- 未使用コード: 既存指摘の internal helper export は解消した。
- 循環依存: 新規分割後も TypeScript compile が通り、追加 module 間の循環は作っていない。
- 暗黙依存: `entryStep`、future `stateKey`、JSON parse failure、checkpoint API surface の暗黙依存を明示的な validation/API/diagnostics に寄せた。
- 型定義: default action の実質 union を解消した。大きな型分割は今後の追加時の候補として残るが、今回の指摘対象は解消済み。
- barrel export: 新しい barrel export は追加していない。
- 自動テスト密度: 追加対策により full test は 206 件から 211 件へ増加した。manual completion、branch validation、API/manifest、diagnostics、GUI branching を regression test で固定した。

### 最終確認

- `npm.cmd test`: 211 tests / 211 pass。
- `git diff --check`: exit 0。
- `npm.cmd run package -- --out $env:TEMP\workflow-register-step-back.vsix`: success。VSIX は 858 files、1.12 MB。

補足: package gate の初回実行では local `node_modules` の dev dependency 展開欠損により、`xmlbuilder` と `asynckit` の missing module が発生した。`package.json` / lockfile は変更せず、対象 package を npm tarball から `node_modules` へ再展開して検証した。
