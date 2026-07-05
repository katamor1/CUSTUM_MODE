# 2026-07-05 review findings tracking

更新日: 2026-07-05

この表は、`14397ffca35b5fe8f71122800926a8c43a79b34c` から `7063ef4cca4bc77547d6b000bb29dbb1b997b6f0` までに追加されたレビュー指摘の対応状態を管理する。

## Scope

| item | value |
| --- | --- |
| 対象範囲 | `14397ffca35b5fe8f71122800926a8c43a79b34c..7063ef4cca4bc77547d6b000bb29dbb1b997b6f0` のレビュー文書 |
| primary 管理件数 | 67 |
| supplemental 構造項目 | 3 |
| 状態 | `done`, `verified-local`, `partial`, `backlog` |
| done 条件 | 対応コミット、または現行 tree の検証証跡がある |
| backlog 条件 | 不具合修正ではなく継続的な構造・運用改善として残す |

## Reviewed Documents

| document | primary items | status |
| --- | ---: | --- |
| [workflow-register-review-2026-07-05-350010e.md](workflow-register-review-2026-07-05-350010e.md) | 13 | done / verified-local |
| [workflow-register-size-architecture-review-2026-07-05-350010e7.md](workflow-register-size-architecture-review-2026-07-05-350010e7.md) | 16 | mixed |
| [bob-code-consistency-review-code-doc-test-review-2026-07-05-350010e.md](bob-code-consistency-review-code-doc-test-review-2026-07-05-350010e.md) | 8 | done / partial |
| [bob-code-consistency-review-size-architecture-review-2026-07-05-350010e7.md](bob-code-consistency-review-size-architecture-review-2026-07-05-350010e7.md) | 11 | mixed |
| [bob-bazaar-review-comprehensive-review-2026-07-05.md](bob-bazaar-review-comprehensive-review-2026-07-05.md) | 15 | done |
| [bob-bazaar-review-size-architecture-review-2026-07-05-350010e.md](bob-bazaar-review-size-architecture-review-2026-07-05-350010e.md) | 4 | done |

## Current Summary

| status | count | meaning |
| --- | ---: | --- |
| done | 42 | 実装修正・仕様同期・テスト更新・現行検証で完了 |
| verified-local | 1 | ローカル検証済み。外部 CI 実行結果の確認は別途 |
| partial | 8 | 一部対応済みだが、広い構造改善は継続対象 |
| backlog | 16 | 将来の構造・運用改善として管理 |
| total | 67 | primary 管理件数 |

## Primary Findings

| id | source | summary | status | evidence / next action |
| --- | --- | --- | --- | --- |
| `WFR-20260705-CODING-01` | `workflow-register-review...:33` | Webview script 埋め込みの workspace 由来データ安全化 | done | `b73b7a12`; `extensions/workflow-register`: `npm.cmd test` 329/329 |
| `WFR-20260705-CODING-02` | `workflow-register-review...:55` | Git 既定 profile に Bazaar 専用 prompt supplement を入れない | done | `b73b7a12`; `extensions/workflow-register`: `npm.cmd test` 329/329 |
| `WFR-20260705-CODING-03` | `workflow-register-review...:80` | input default の number / boolean / null round-trip | done | `b73b7a12`; `extensions/workflow-register`: `npm.cmd test` 329/329 |
| `WFR-20260705-CODING-04` | `workflow-register-review...:104` | workflow 生成の部分成功を防ぐ | done | `283d37e0`; `extensions/workflow-register`: `npm.cmd test` 329/329 |
| `WFR-20260705-CODING-05` | `workflow-register-review...:126` | 書き込み時の symlink escape 検出 | done | `283d37e0`; `extensions/workflow-register`: `npm.cmd test` 329/329 |
| `WFR-20260705-CODING-06` | `workflow-register-review...:150` | GUI 候補を template metadata と連動 | done | `b73b7a12`; `extensions/workflow-register`: `npm.cmd test` 329/329 |
| `WFR-20260705-CODING-07` | `workflow-register-review...:175` | `artifactOutputRoot` の意味と置換範囲を同期 | done | `b73b7a12`; `extensions/workflow-register`: `npm.cmd test` 329/329 |
| `WFR-20260705-DOC-01` | `workflow-register-review...:200` | README / 基本設計 / 詳細設計を Template Customization Studio に追従 | done | `3fa1c445`; `extensions/workflow-register`: `npm.cmd test` 329/329 |
| `WFR-20260705-DOC-02` | `workflow-register-review...:223` | `taskSnapshots.includeMessages` 既定値の文書矛盾を解消 | done | `3fa1c445`; `extensions/workflow-register`: `npm.cmd test` 329/329 |
| `WFR-20260705-TEST-01` | `workflow-register-review...:245` | 単体テスト仕様に Template Customization Studio / template command を追加 | done | `3fa1c445`; `extensions/workflow-register`: `npm.cmd test` 329/329 |
| `WFR-20260705-TEST-02` | `workflow-register-review...:273` | Webview panel message handling の振る舞い保証 | partial | `283d37e0` で生成安全性は補強。pure handler 化した behavior test は `WFR-20260705-SIZE-H04` として backlog 管理 |
| `WFR-20260705-TEST-03` | `workflow-register-review...:294` | 実機テスト仕様と UAT 文書の接続 | done | `3fa1c445`; `extensions/workflow-register`: `npm.cmd test` 329/329 |
| `WFR-20260705-CI-01` | `workflow-register-review...:314` | 対象 commit の CI 実行結果を確認可能にする | verified-local | ローカルで `workflow-register` 329/329、`bob-code-consistency-review` 115/115、`bob-bazaar-review` 129/129 を確認。remote CI 確認は別途 |
| `WFR-20260705-SIZE-H01` | `workflow-register-size...:534` | `WorkflowEngine` が肥大化する前の責務境界固定 | backlog | review / branch / artifact completion helper 境界の設計固定を次の engine refactor で実施 |
| `WFR-20260705-SIZE-H02` | `workflow-register-size...:535` | TS schema と JSON schema の drift test | done | 現行 `schema:policy`; `extensions/workflow-register`: `npm.cmd test` 329/329 |
| `WFR-20260705-SIZE-H03` | `workflow-register-size...:536` | layer policy 追加 | backlog | import cycle は検査済み。方向性 rule は未導入 |
| `WFR-20260705-SIZE-H04` | `workflow-register-size...:537` | `TemplateCustomizationStudioPanel` を薄くする | partial | 現行テストは拡充済み。message routing / VS Code side effects の完全分離は backlog |
| `WFR-20260705-SIZE-H05` | `workflow-register-size...:538` | `vscode.executeCommand` command ID regression test 拡充 | done | guardrail 系回帰テストあり。`extensions/workflow-register`: `npm.cmd test` 329/329 |
| `WFR-20260705-SIZE-M01` | `workflow-register-size...:542` | `WorkflowRunCommandService` の UI / use-case / reporting 分離 | partial | 既存分割済み。追加分離は service 成長時に継続 |
| `WFR-20260705-SIZE-M02` | `workflow-register-size...:543` | `processCommands.ts` / `templateCommands.ts` の command 単位分割 | backlog | 次の command 増加時に分割 |
| `WFR-20260705-SIZE-M03` | `workflow-register-size...:544` | `CoreWorkflowDefinition` の Parsed / Loaded / Runtime 分割 | done | 既存 model 分割と current tests で確認 |
| `WFR-20260705-SIZE-M04` | `workflow-register-size...:545` | unused report 保存と依存系 fail gate 化 | partial | `unused:report` は CI 実行。workflow-register の `unused:policy` fail gate は未導入 |
| `WFR-20260705-SIZE-M05` | `workflow-register-size...:546` | VSIX entry list と size diff の CI artifact / PR comment | partial | source metrics は CI summary/PR comment。VSIX file list artifact は未導入 |
| `WFR-20260705-SIZE-M06` | `workflow-register-size...:547` | internal code の direct type module import 方針を文書化 | backlog | README または `src/core/README.md` への追記待ち |
| `WFR-20260705-SIZE-L01` | `workflow-register-size...:551` | `noUnusedLocals` 段階導入 | backlog | TypeScript compiler option 未導入 |
| `WFR-20260705-SIZE-L02` | `workflow-register-size...:552` | template/process 機能の feature root / 別 extension 化検討 | backlog | 機能増加時の構造判断として管理 |
| `WFR-20260705-SIZE-L03` | `workflow-register-size...:553` | webview script の pure function / DOM adapter 分離 | backlog | Webview behavior test 拡充時に実施 |
| `WFR-20260705-SIZE-L04` | `workflow-register-size...:554` | run state / snapshot schema migration policy docs | backlog | migration policy 文書化待ち |
| `WFR-20260705-SIZE-L05` | `workflow-register-size...:555` | package-lock diff の reviewer 向け docs | backlog | reviewer guide 追加待ち |
| `CCR-20260705-F01` | `bob-code-consistency-review-code-doc-test...:54` | Excel 依存記述と実装・依存ポリシーの矛盾 | done | `87e46350`; `extensions/bob-code-consistency-review`: `npm.cmd test` 115/115 |
| `CCR-20260705-F02` | `bob-code-consistency-review-code-doc-test...:70` | processing limit 系設定の README / 詳細設計追記 | done | `87e46350`; `extensions/bob-code-consistency-review`: `npm.cmd test` 115/115 |
| `CCR-20260705-F03` | `bob-code-consistency-review-code-doc-test...:93` | 単体テスト仕様の Git / Bazaar CLI 実態同期 | done | `87e46350`; `extensions/bob-code-consistency-review`: `npm.cmd test` 115/115 |
| `CCR-20260705-F04` | `bob-code-consistency-review-code-doc-test...:109` | CCR-UT ID と実テスト traceability | done | `87e46350`; `extensions/bob-code-consistency-review`: `npm.cmd test` 115/115 |
| `CCR-20260705-F05` | `bob-code-consistency-review-code-doc-test...:133` | Traceability Prep Webview 実機テスト仕様の過剰期待修正 | done | `87e46350`; `extensions/bob-code-consistency-review`: `npm.cmd test` 115/115 |
| `CCR-20260705-F06` | `bob-code-consistency-review-code-doc-test...:148` | Webview HTML escaping 契約の明文化と XSS regression | done | `87e46350`; `extensions/bob-code-consistency-review`: `npm.cmd test` 115/115 |
| `CCR-20260705-F07` | `bob-code-consistency-review-code-doc-test...:164` | Webview message / workflow provider runtime test の source regex 偏重 | partial | 仕様同期済み。mock panel / mock workflow-register API の behavior test は継続対象 |
| `CCR-20260705-F08` | `bob-code-consistency-review-code-doc-test...:178` | README の古い実装分割説明 | done | `87e46350`; `extensions/bob-code-consistency-review`: `npm.cmd test` 115/115 |
| `CCR-20260705-SIZE-H01` | `bob-code-consistency-review-size...:581` | `normalizeChangedFilePathStrict()` で diff fixture / VCS path を統一検証 | done | `dd6451f0`; `extensions/bob-code-consistency-review`: `npm.cmd test` 115/115 |
| `CCR-20260705-SIZE-H02` | `bob-code-consistency-review-size...:582` | `resolveWorkspaceContainedPath()` を strict / realpath resolver に置換 | done | `dd6451f0`; `extensions/bob-code-consistency-review`: `npm.cmd test` 115/115 |
| `CCR-20260705-SIZE-H03` | `bob-code-consistency-review-size...:583` | `code-slices` / `tables` 個別 size limit と `review-package-size-report.json` | backlog | package size detail report は未導入 |
| `CCR-20260705-SIZE-M01` | `bob-code-consistency-review-size...:587` | `core/` の workspace / vcs / package / bobOutput / traceability 分割 | partial | 既存分割あり。完全な feature root 分割は継続 |
| `CCR-20260705-SIZE-M02` | `bob-code-consistency-review-size...:588` | `traceabilityCommands.ts` / `workflowProviderRegistration.ts` 追加分割 | backlog | 次の command 増加時に分割 |
| `CCR-20260705-SIZE-M03` | `bob-code-consistency-review-size...:589` | VSIX size / file list / node_modules size の CI artifact と docs/metrics 履歴 | backlog | bob-code-consistency-review には `package:metrics` 未導入 |
| `CCR-20260705-SIZE-M04` | `bob-code-consistency-review-size...:590` | coverage または test count / LOC ratio の CI summary | partial | extension metrics job はあり。coverage は未導入 |
| `CCR-20260705-SIZE-L01` | `bob-code-consistency-review-size...:594` | `EvidenceRef.type` の known / extension 分離 | backlog | schema/type refinement 待ち |
| `CCR-20260705-SIZE-L02` | `bob-code-consistency-review-size...:595` | `ReviewInput.artifacts` を schema-derived type に寄せる | backlog | schema-derived type 化待ち |
| `CCR-20260705-SIZE-L03` | `bob-code-consistency-review-size...:596` | `noUnusedLocals` 段階導入 | backlog | TypeScript compiler option 未導入 |
| `CCR-20260705-SIZE-L04` | `bob-code-consistency-review-size...:597` | facade module の行数・export 数 budget | backlog | module budget test 未導入 |
| `BBR-20260705-REV-001` | `bob-bazaar-review-comprehensive...:29` | GUI packet metadata 見出しを workflowBridge が解析可能にする | done | `a9c69dae`; `extensions/bob-bazaar-review`: `npm.cmd test` 129/129 |
| `BBR-20260705-REV-002` | `bob-bazaar-review-comprehensive...:69` | direct `reviewRange` に追加ファイル本文・metadata・log を含める | done | `a9c69dae`; `extensions/bob-bazaar-review`: `npm.cmd test` 129/129 |
| `BBR-20260705-REV-003` | `bob-bazaar-review-comprehensive...:104` | Webview message `mode` の whitelist 検証 | done | `a9c69dae`; `extensions/bob-bazaar-review`: `npm.cmd test` 129/129 |
| `BBR-20260705-REV-004` | `bob-bazaar-review-comprehensive...:130` | explicit root の marker 検証 | done | `a9c69dae`; `extensions/bob-bazaar-review`: `npm.cmd test` 129/129 |
| `BBR-20260705-REV-005` | `bob-bazaar-review-comprehensive...:157` | MCP `project_rules_init` 公開状態の docs / code 同期 | done | `a9c69dae`, `eac8a20b`; `extensions/bob-bazaar-review`: `npm.cmd test` 129/129 |
| `BBR-20260705-REV-006` | `bob-bazaar-review-comprehensive...:187` | review record quality gate を実検証にする | done | `05f979bf`; `extensions/bob-bazaar-review`: `npm.cmd test` 129/129 |
| `BBR-20260705-REV-007` | `bob-bazaar-review-comprehensive...:213` | record / triage / summary command の設計書・テスト仕様補強 | done | `eac8a20b`; `extensions/bob-bazaar-review`: `npm.cmd test` 129/129 |
| `BBR-20260705-REV-008` | `bob-bazaar-review-comprehensive...:251` | docs の source layout 同期 | done | `eac8a20b`; `extensions/bob-bazaar-review`: `npm.cmd test` 129/129 |
| `BBR-20260705-REV-009` | `bob-bazaar-review-comprehensive...:293` | unit-test-spec と実テスト対応の補強 | done | `eac8a20b`; `extensions/bob-bazaar-review`: `npm.cmd test` 129/129 |
| `BBR-20260705-REV-010` | `bob-bazaar-review-comprehensive...:334` | real-machine-test-spec の command / MCP / record coverage 補強 | done | `eac8a20b`; `extensions/bob-bazaar-review`: `npm.cmd test` 129/129 |
| `BBR-20260705-REV-011` | `bob-bazaar-review-comprehensive...:365` | custom JSON Schema validation が subset であることを明記 | done | `eac8a20b`; `extensions/bob-bazaar-review`: `npm.cmd test` 129/129 |
| `BBR-20260705-REV-012` | `bob-bazaar-review-comprehensive...:387` | MCP allowed roots 未設定時の cwd 無制限許可を閉じる | done | `a9c69dae`; `extensions/bob-bazaar-review`: `npm.cmd test` 129/129 |
| `BBR-20260705-REV-013` | `bob-bazaar-review-comprehensive...:406` | review record path segment の cross-platform safety | done | `05f979bf`; `extensions/bob-bazaar-review`: `npm.cmd test` 129/129 |
| `BBR-20260705-REV-014` | `bob-bazaar-review-comprehensive...:424` | ドキュメント番号・章構成の古い編集痕 | done | `eac8a20b`; `extensions/bob-bazaar-review`: `npm.cmd test` 129/129 |
| `BBR-20260705-REV-015` | `bob-bazaar-review-comprehensive...:443` | version 文字列の重複管理 | done | `eac8a20b`; `extensions/bob-bazaar-review`: `npm.cmd test` 129/129 |
| `BBR-20260705-DEPS-01` | `bob-bazaar-review-size...:385` | 実測 VSIX size を文書・CI summary に残す | done | `59a65bc1`; VSIX `307135 / 350000` bytes, 87.8% |
| `BBR-20260705-UNUSED-01` | `bob-bazaar-review-size...:396` | unused checks を report-only から fail gate へ | done | `59a65bc1`; `extensions/bob-bazaar-review`: `npm.cmd run unused:policy` |
| `BBR-20260705-TYPE-01` | `bob-bazaar-review-size...:407` | 外部 protocol boundary の `any` を狭める | done | `0ab60733`; `extensions/bob-bazaar-review`: `npm.cmd test` 129/129 |
| `BBR-20260705-IMPLICIT-01` | `bob-bazaar-review-size...:418` | 暗黙依存一覧 drift の管理 | done | `eac8a20b`; docs / architecture contract tests |

## Supplemental Structural Items

次の3件は primary 67 件には含めないが、`bob-bazaar-review-size-architecture-review-2026-07-05-350010e.md` の構造指摘として実装対応した。

| id | source | summary | status | evidence |
| --- | --- | --- | --- | --- |
| `BBR-20260705-SIZE-01` | `bob-bazaar-review-size...:342` | `reviewGuiHtml.ts` の inline asset 肥大化 | done | `41badfc1`; `reviewGuiHtmlAssets.ts` へ分離; `extensions/bob-bazaar-review`: `npm.cmd test` 129/129 |
| `BBR-20260705-SIZE-02` | `bob-bazaar-review-size...:356` | `resultCaptureCore.ts` の責務過多 | done | `41badfc1`; `resultCaptureArtifacts.ts` / `resultCaptureJson.ts` へ分離 |
| `BBR-20260705-SIZE-03` | `bob-bazaar-review-size...:371` | `records` subdomain の大機能化 | done | `41badfc1`; `reviewRecordSummary.ts` へ campaign summary を分離 |

## Commit Index

| commit | scope |
| --- | --- |
| `b73b7a12` | workflow-register coding review gaps |
| `a0b4cbbf` | code-consistency custom artifact paths |
| `05f979bf` | bazaar review record validation |
| `283d37e0` | template studio generation safety |
| `dd6451f0` | code-consistency strict path reads |
| `a9c69dae` | bazaar review runtime boundaries |
| `3fa1c445` | workflow-register template docs |
| `87e46350` | code-consistency review specs |
| `eac8a20b` | bazaar review specs and metadata version |
| `59a65bc1` | bazaar unused checks and VSIX metrics |
| `0ab60733` | bazaar MCP tool call boundary |
| `41badfc1` | bazaar large module split |

## Verification Snapshot

| command | result |
| --- | --- |
| `extensions/workflow-register`: `npm.cmd test` | 329/329 pass |
| `extensions/bob-code-consistency-review`: `npm.cmd test` | 115/115 pass |
| `extensions/bob-bazaar-review`: `npm.cmd test` | 129/129 pass |
| `extensions/bob-bazaar-review`: `npm.cmd run architecture:policy` | pass |
| `extensions/bob-bazaar-review`: `npm.cmd run source:policy` | pass |
| `extensions/bob-bazaar-review`: `npm.cmd run unused:policy` | pass |
| `extensions/bob-bazaar-review`: `npm.cmd run package && npm.cmd run package:policy && npm.cmd run package:metrics` | pass; `307135 / 350000` bytes |
