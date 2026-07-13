# Workflow Platform Phase 0 完了証跡

## 1. 判定

| 項目 | 判定 |
| --- | --- |
| ローカル Phase 0 | **PASS** |
| 製品リリース | **NO-GO（外部ゲート待ち）** |
| Branch | `codex/workflow-platform-remediation` |
| Base | `76aaa663b4e65314fdad75d13c8dfa2a43e17944` |
| Phase 0 code head | `0105c92a4cc7e25430a5994a8e03c2b1e8da6a32` |
| 環境 | Windows / Node.js `v22.17.0` / npm `11.3.0` |
| GitHub書込み | なし（push、merge、PR更新なし） |

Phase 0 のP0 correctness freeze、契約一貫性、runtime競合防止、operator mutation保護、および決定論的E2Eはローカルで完了した。実機・CI・配布経路の確認は未完了のため、これは製品リリース許可ではない。

## 2. タスク完了記録

| Task | 主な成果 | 主commit / checkpoint evidence |
| ---: | --- | --- |
| 1 | Bob review gateを人間判断まで保持し、accept/abortを単一解決にした | `8f39341d`〜`88a1da56`; focused 32、当時full 409 |
| 2 | held/checkpoint/pause、対向判断、永続化順序を同期した | `f0afe430`〜`07e7fb0f`; focused 52、当時full 429 |
| 3 | provider成果物のownershipとatomic commitを確立した | `f9816816`〜`c9b7dcff`; focused 18、当時full 447 |
| 4 | direct/Bob/Operation Hubで展開済みpromptを共有した | `ff433a19`〜`24ecf1ac`; focused 60、当時full 448 |
| 5 | validation/registrationを単一compilerとstable diagnosticsへ統一した | `3afbd312`〜`d644be37`; parity 13、contracts 7、当時full 461 |
| 6 | process workflowのReject後に記録・集計へ進まないようにした | `902cf36a`〜`d8b7832c`; focused 102、contracts 23、当時full 551 |
| 7 | Operation Hub、Builder、traceability更新をtransactional/CAS化した | `121a2c9b`〜`3975306e`; workflow累積 597、bob-code 199 |
| 8 | P0 E2E、物理path境界、multi-root routing、run排他・再入防止、全体レビューを閉じた | `94379a6a`、`5c9744f8`、`4f938a43`、`0105c92a`; 最終full 654/654 |

## 3. 最終テスト証跡

### 3.1 workflow-register

`npm.cmd test` は最終code headでcompileを含め **654 passed / 0 failed**。所要約53.5秒、Node test本体は約39.3秒だった。

P0専用E2Eは次の5ケースを含み、最終fullでもすべてPASSした。

1. Bob approveがdurable acceptanceまでpendingを保持し、1回だけ解決する。
2. Rejectがrecord/campaign summaryの副作用より前に停止する。
3. provider成果物欠落時にstate/hooksをcommitせず失敗する。
4. invalid definitionのvalidation/registration diagnosticsが一致する。
5. Operation Hub `runNextStep`がstandaloneと同じ展開済みpromptを使う。

追加の競合回帰では、artifact importと`runNext`/Bob同期保存の直列化、同一run single-flight、physical-root alias、directおよび`A -> B -> A`間接再入のfail-fast、失敗後のlock解放を確認した。独立focused再確認は65/65、最終レビュアーの独立実行は63/63だった。

### 3.2 高負荷時のfull-equivalent規則とraw履歴

operator指示により、固定wall-clockに依存するfull失敗は、関連ソースを変更しないまま全失敗ケースをisolatedでgreenにした場合に限りfull-equivalent PASSへ合成する。raw command自体の失敗はPASSへ読み替えない。

| 対象 | raw結果 | isolated補完 | 最終判定 |
| --- | --- | --- | --- |
| workflow-register 最終 | 654/654 | 不要 | raw full PASS |
| workflow-register 中間checkpoint | 603/604、640/643、186/187 | stale source-shape assertionを対象fileでgreen化。最終fullで全件再実行 | 最終654/654が上書き証跡 |
| bob-bazaar-review | 159/160 | 3秒固定の外部process timing case 1/1、同file 9/9。関連ソース不変 | cumulative 160/160 |
| bob-code-consistency-review | 199/199 | 不要 | raw full PASS |
| workflow contracts | 23/23 | 不要 | PASS |
| scaffold | typecheck PASS、unit 6/6、smoke PASS | 不要 | PASS |

4 packageの`npm ci`もPhase 0中にPASSした。Task 8終盤の変更は`workflow-register`内に限定され、他3対象のtest/contract/scaffoldソースは変更していない。

## 4. 静的・依存ゲート

| 対象 | 結果 |
| --- | --- |
| workflow-register dependency policy | 3/3 PASS |
| workflow-register architecture policy | 188 TypeScript files、import cycleなし |
| workflow-register source policy | 188 TypeScript files、export-star policy PASS |
| workflow-register schema policy | compile + 5/5 PASS |
| workflow-register unused report | knip / ts-prune / depcheck、exit 0 |
| workflow-register production audit | 0 vulnerabilities |
| bob-bazaar-review policies | dependency / architecture / source / unused / artifact / package policy PASS |
| bob-bazaar-review production audit | high閾値 exit 0。`js-yaml` 1 moderateは残存 |
| bob-code-consistency-review policies | dependency / architecture / source / package policy PASS |
| bob-code-consistency-review production audit | 0 vulnerabilities |
| repository diff checks | `git diff --check` PASS |
| whole-branch independent review | **Critical 0 / Important 0** |

## 5. VSIX成果物

| Artifact | Bytes / budget | SHA-256 | UTC生成時刻 |
| --- | ---: | --- | --- |
| `workflow-register-0.1.0.vsix` | 1,139,085 / 1,200,000 | `AECE3E98CFCD89579965B1216777D0E64F00DEC47BCECE847A8E80DFC808FDA7` | `2026-07-12T04:04:27.3107805Z` |
| `bob-bazaar-review-0.3.0.vsix` | 304,683 / 350,000 | `2113397ABA3E351E74B220347609124763265B1F2A19E1EAB0F49194BB6F93E1` | `2026-07-12T04:04:45.1573115Z` |
| `bob-code-consistency-review-0.1.0.vsix` | 3,639,916 / 11,000,000 | `F911BC132F26AB47C6ACB822B2F37780FBED7A926EB109384825C226DB23E6C5` | `2026-07-12T04:05:16.1371735Z` |

3成果物とも`package`と`package:policy`を順番に実行してPASSした。VSIXはgit-ignored local artifactである。

## 6. Phase 1以降へのrebaseline

### Contract v2 / single compiler

完了: validation、registration、workspace validation、current document validationのstrict policyとdiagnosticsを単一compilerへ寄せた。

残件: package v2 schema、明示version negotiation、migration/golden fixtures、互換性ポリシー。

### Reproducible runtime

完了: artifact hash/manifest、attempt保存、durable provider phase、provider-owned artifact、transactional batch commit、in-process run排他、physical-root identity、direct/indirect再入防止。

残件: immutable attempt/event log、process crash向けjournal/fsync、cross-process lock、AI timeout/cancel/token budget、model/prompt provenance、mutable `run.json`からの段階移行。

### Operator UX

完了: Operation Hub action single-flight、Builder入力保持と上書き確認、traceability CAS、root-scoped task/gate、multi-root focus、full Bob wrapper continuation。

残件: process-local queueの永続化、実Webview操作確認、IBM Bob実機でのTodo lifecycle、registry/task handleの長期cleanup。

## 7. 既知の残余リスク

- file transactionは同一process内ではrollback/serializeするが、OS crashと別process writerまでは保護しない。
- realpath確認からopen/renameまでの同一user TOCTOUを完全には排除していない。
- legacy custom `ResultSink`は任意の外部副作用をrollbackできない。
- `bob-bazaar-review`の`js-yaml` moderate advisoryは依存更新候補として追跡が必要。
- package file数が多く、bundle/ignore最適化はPhase 1候補である。

## 8. 製品リリースをNO-GOとする外部ゲート

次を最新head/VSIXで完了するまで製品リリースしない。

1. GitHub ActionsのUbuntu/Windows matrixをrunner step開始からgreenにする。
2. clean環境へ3 VSIXを導入し、VS Code Extension Host activation/UATを行う。
3. IBM Bob 2.0.1実機でapprove/reject/held/checkpoint/pause/full wrapperを確認する。
4. 実Bazaarを使い、timeout/cancel/path境界/Shift-JIS/`--no-aliases`を確認する。
5. multi-rootとworkspace aliasを実GUI操作で確認する。
6. 配布署名、Marketplace/社内配布、rollback手順を確定する。
