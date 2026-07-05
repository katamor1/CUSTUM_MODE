# Review findings tracking table

更新日: 2026-07-05

この表は、`docs/` にある 2026-07-04 のレビュー結果文書から、後続修正で追跡する対象をまとめたものです。

2026-07-05 に追加されたレビュー指摘の対応状態は、別表 [review-findings-tracking-2026-07-05.md](review-findings-tracking-2026-07-05.md) で管理する。

## 運用ルール

- `source` は元レビュー文書と該当行を示す。
- `canonical id` は修正・テスト・コミットの追跡単位に使う。
- 横断レビューの短縮 ID は深掘りレビューと番号が衝突するため、`extensions-review:<ID>` として扱い、`canonical id` に紐付ける。
- 状態は `open`、`in_progress`、`done`、`partial`、`duplicate`、`backlog` を使う。
- `done` にするときは、対応コミットと実行したテストまたは検証コマンドを追記する。

## Reviewed documents

| document | kind | tracking scope | current status | notes |
| --- | --- | --- | --- | --- |
| [workflow-register-deep-review-2026-07-04-14afe83c.md](workflow-register-deep-review-2026-07-04-14afe83c.md) | deep review | `WFR-01` to `WFR-15` | done | `WFR-01` から `WFR-15` まで対応済み。 |
| [workflow-register-maintainability-review-2026-07-04-14afe83c.md](workflow-register-maintainability-review-2026-07-04-14afe83c.md) | maintainability review | `WFR-MAINT-*` | done | High / Medium / Low backlog まで対応済み。ID 付き deep review と重なるものは canonical 側を優先する。lockfile / `npm ci` / dependency policy / VSIX policy、core 段階分割まで対応済み。 |
| [bob-bazaar-review-deep-review-2026-07-04-14afe83c.md](bob-bazaar-review-deep-review-2026-07-04-14afe83c.md) | deep review | `BBR-01` to `BBR-20` | done | `BBR-01` から `BBR-20` まで対応済み。 |
| [bob-bazaar-review-maintainability-review-2026-07-04-14afe83c.md](bob-bazaar-review-maintainability-review-2026-07-04-14afe83c.md) | maintainability review | `BBR-MAINT-*` | done | High / Medium / Low backlog まで対応済み。MCP tool contract 分離、template size budget、`export *` 禁止 rule も対応済み。 |
| [bob-code-consistency-review-deep-review-2026-07-04-14afe83c.md](bob-code-consistency-review-deep-review-2026-07-04-14afe83c.md) | deep review | `CCR-01` to `CCR-16` | done | `CCR-01` から `CCR-16` まで対応済み。 |
| [bob-code-consistency-review-maintainability-review-2026-07-04-14afe83c.md](bob-code-consistency-review-maintainability-review-2026-07-04-14afe83c.md) | maintainability review | `CCR-MAINT-*` | done | High / Medium / Low backlog まで対応済み。path boundary、revision validation、size limits は deep review 側と重なる。runtime dependency / VSIX CI / VSIX policy、extractor / analyzer / command 分割まで対応済み。 |
| [extensions-review-2026-07-04-14afe83c.md](extensions-review-2026-07-04-14afe83c.md) | cross-extension review | `extensions-review:<ID>` | done / duplicate | canonical ID への対応表を下に置く。重複指摘は canonical 側ですべて対応済み。 |
| [extensions-maintainability-review-2026-07-04-14afe83c.md](extensions-maintainability-review-2026-07-04-14afe83c.md) | cross-extension maintainability review | `EXT-MAINT-*` | done | 3 拡張共通の CI、bundle、依存、README、source policy、metrics、schema drift policy まで対応済み。 |

## Canonical findings

### workflow-register

| canonical id | source | severity | summary | status | done commits / next action | verification |
| --- | --- | --- | --- | --- | --- | --- |
| `WFR-01` | `workflow-register-deep-review...:49` | High | `vscode.executeCommand` の実 command ID が guardrail 対象外 | done | `4b7ebb0f`, `e4daab04` | `extensions/workflow-register`: `npm.cmd test`; `git diff --check` |
| `WFR-02` | `workflow-register-deep-review...:50` | High | `guardrails.requireApproval` が engine で enforcement されない | done | `b2404b8c` | `extensions/workflow-register`: `npm.cmd run compile; node --test test\workflowEngineCommandAgent.test.js test\workflowAuthoringAdvancedSections.test.js`; `npm.cmd test`; `git diff --check` |
| `WFR-03` | `workflow-register-deep-review...:51` | High | singleStep 実行時に前段 `reviewing` step が暗黙 accepted される | done | `30e0264f` | `extensions/workflow-register`: `npm.cmd test`; `git diff --check` |
| `WFR-04` | `workflow-register-deep-review...:52` | High | retry/recovery が古い assistant 出力を再利用する可能性 | done | `83049480` | `extensions/workflow-register`: `npm.cmd run compile; node --test test\workflowRunRecovery.test.js test\runtimeWiring.test.js`; `npm.cmd test`; `git diff --check` |
| `WFR-05` | `workflow-register-deep-review...:53` | High | task snapshot の機密情報リスク | done | `8bef221a` | `extensions/workflow-register`: `npm.cmd run compile; node --test test\taskSnapshots.test.js test\workflowRegister.test.js`; `npm.cmd test`; `git diff --check` |
| `WFR-06` | `workflow-register-deep-review...:54` | Medium | `requires.files` / `preflight.files` が workspace 外の存在確認に使える | done | `ba88d772` | `extensions/workflow-register`: `npm.cmd test`; `git diff --check` |
| `WFR-07` | `workflow-register-deep-review...:55` | Medium | state / command result の prompt injection 境界が弱い | done | `0692e045` | `extensions/workflow-register`: `npm.cmd run compile; node --test test\agentStep.test.js test\bobWorkflowMessages.test.js test\runtimeWiring.test.js`; `npm.cmd test`; `git diff --check` |
| `WFR-08` | `workflow-register-deep-review...:56` | Medium | template renderer の暗黙 JSON key 解決が予測しづらい | done | `236d8a83` | `extensions/workflow-register`: `npm.cmd run compile; node --test test\workflowEngineCore.test.js test\workflowAuthoring.test.js`; `npm.cmd test`; `git diff --check` |
| `WFR-09` | `workflow-register-deep-review...:57` | Medium | GUI edit / AI repair の上書き対象 boundary | done | `ce7f6ae1` | `extensions/workflow-register`: `npm.cmd run compile; node --test test\workflowDocumentPath.test.js test\workflowRegister.test.js`; `npm.cmd test`; `git diff --check` |
| `WFR-10` | `workflow-register-deep-review...:58` | Medium | legacy workflow に definition hash がない | done | `3a6e76e4` | `extensions/workflow-register`: `npm.cmd run compile; node --test test\workflowParserV1.test.js`; `npm.cmd test`; `git diff --check` |
| `WFR-11` | `workflow-register-deep-review...:59` | Medium | schema の permissiveness と step-specific field 制約 | done | `9acda46b` | `extensions/workflow-register`: `npm.cmd run compile; node --test test\workflowParserV1.test.js test\workflowDefinitionLoader.test.js test\workflowRegister.test.js`; `npm.cmd test`; `git diff --check` |
| `WFR-12` | `workflow-register-deep-review...:60` | Medium | `maxResultBytes` が byte ではなく文字数 | done | `6c94c7e1` | `extensions/workflow-register`: `npm.cmd test`; `git diff --check` |
| `WFR-13` | `workflow-register-deep-review...:61` | Low | IBM Bob dependency の扱いが曖昧 | done | `2e6eb4c3` | `extensions/workflow-register`: `npm.cmd run compile; node --test test\workflowRegister.test.js`; `npm.cmd test`; `git diff --check` |
| `WFR-14` | `workflow-register-deep-review...:62` | Low | Workspace Trust gating がない | done | `8d341e72` | `extensions/workflow-register`: `npm.cmd run compile; node --test test\actionRegistry.test.js test\resultSinkRegistry.test.js test\runtimeWiring.test.js`; `npm.cmd test`; `git diff --check` |
| `WFR-15` | `workflow-register-deep-review...:63` | Low | run id 採番の競合余地 | done | `e3d5c971` | `extensions/workflow-register`: RED `node --test test\workflowRunRecovery.test.js`; `npm.cmd run compile; node --test test\workflowRunRecovery.test.js`; `npm.cmd test`; `git diff --check` |

### bob-bazaar-review

| canonical id | source | severity | summary | status | done commits / next action | verification |
| --- | --- | --- | --- | --- | --- | --- |
| `BBR-01` | `bob-bazaar-review-deep-review...:48` | High | MCP tools が任意 `cwd` を信頼し allowed root を検証しない | done | `80f5ccf7` | `extensions/bob-bazaar-review`: `npm.cmd test`; `git diff --check` |
| `BBR-02` | `bob-bazaar-review-deep-review...:49` | High | `project_rules_init` write tool と read-only 認識のズレ | done | `15704007` | `extensions/bob-bazaar-review`: `npm.cmd test`; `git diff --check` |
| `BBR-03` | `bob-bazaar-review-deep-review...:50` | High | `bobBazaar.bzrPath` による任意 executable 実行面 | done | `768bf8dd` | `extensions/bob-bazaar-review`: `npm.cmd test`; `git diff --check` |
| `BBR-04` | `bob-bazaar-review-deep-review...:51` | High | diff size 設定と `truncateUtf8()` の異常値処理 | done | `d668a0fc` | `extensions/bob-bazaar-review`: `npm.cmd test`; `git diff --check` |
| `BBR-05` | `bob-bazaar-review-deep-review...:52` | High | review-result validation が project schema / rule ID set と十分連動しない | done | `68b8cb45` | `extensions/bob-bazaar-review`: `npm.cmd test`; `git diff --check` |
| `BBR-06` | `bob-bazaar-review-deep-review...:53` | High | raw diff/log/added file content の fence break / prompt injection | done | `aad8feb6` | `extensions/bob-bazaar-review`: `npm.cmd test`; `git diff --check` |
| `BBR-07` | `bob-bazaar-review-deep-review...:54` | Medium | `collectReviewContext` の packet 選択が曖昧 | done | `ec4f2234` | `extensions/workflow-register`: `npm.cmd test`; `extensions/bob-bazaar-review`: `npm.cmd test`; `git diff --check` |
| `BBR-08` | `bob-bazaar-review-deep-review...:55` | Medium | GUI 後の workflow step 自動完了が run/step を照合しない | done | `da66b8f7` | `extensions/workflow-register`: `npm.cmd test`; `extensions/bob-bazaar-review`: `npm.cmd test`; `git diff --check` |
| `BBR-09` | `bob-bazaar-review-deep-review...:56` | Medium | project rules 付き CLI command が default checklist へ fallback し得る | done | `6f1db85c` | `extensions/bob-bazaar-review`: `npm.cmd test`; `git diff --check` |
| `BBR-10` | `bob-bazaar-review-deep-review...:57` | Medium | review-result artifact の上書き | done | `25719710` | `extensions/bob-bazaar-review`: `npm.cmd test`; `git diff --check` |
| `BBR-11` | `bob-bazaar-review-deep-review...:58` | Medium | MCP stdio reader に最大 Content-Length がない | done | `b21ff2d2` | `extensions/bob-bazaar-review`: `npm.cmd test`; `git diff --check` |
| `BBR-12` | `bob-bazaar-review-deep-review...:59` | Medium | `.bob` 初期化時の workflow template 上書き | done | `828e22c1`, `a0fceb5a` | `extensions/bob-bazaar-review`: `npm.cmd run compile; node --test test\templateRefresh.test.js test\workflowBridge.test.js`; `npm.cmd test`; `git diff --check` |
| `BBR-13` | `bob-bazaar-review-deep-review...:60` | Medium | review packet の privacy leak | done | `934ecce3` | `extensions/bob-bazaar-review`: `npm.cmd test`; `git diff --check` |
| `BBR-14` | `bob-bazaar-review-deep-review...:61` | Medium | revision validation の強化 | done | `8c86eb05` | `extensions/bob-bazaar-review`: `npm.cmd test`; `git diff --check` |
| `BBR-15` | `bob-bazaar-review-deep-review...:62` | Medium | Bazaar diff parser の rename / binary coverage | done | `b668b76d` | `extensions/bob-bazaar-review`: `npm.cmd test`; `git diff --check` |
| `BBR-16` | `bob-bazaar-review-deep-review...:63` | Medium | config clamp と packet size 上限 | done | `d668a0fc` | `extensions/bob-bazaar-review`: `npm.cmd test`; `git diff --check` |
| `BBR-17` | `bob-bazaar-review-deep-review...:64` | Medium | MCP config 書き込みの堅牢性 | done | `05ebd74e` | `extensions/bob-bazaar-review`: `npm.cmd test`; `git diff --check` |
| `BBR-18` | `bob-bazaar-review-deep-review...:65` | Low | Webview nonce が `Date.now()` | done | `fae99b40` | `extensions/bob-bazaar-review`: `npm.cmd test`; `git diff --check` |
| `BBR-19` | `bob-bazaar-review-deep-review...:66` | Low | workflow-register provider registration の retry が弱い | done | `b42ac217` | `extensions/bob-bazaar-review`: `npm.cmd test`; `git diff --check` |
| `BBR-20` | `bob-bazaar-review-deep-review...:67` | Low | MCP text encoding config が GUI / command とずれる | done | `c085b107` | `extensions/bob-bazaar-review`: `npm.cmd test`; `git diff --check` |

### bob-code-consistency-review

| canonical id | source | severity | summary | status | done commits / next action | verification |
| --- | --- | --- | --- | --- | --- | --- |
| `CCR-01` | `bob-code-consistency-review-deep-review...:48` | High | workspace path boundary が一貫しない | done | `14067e27` | `extensions/bob-code-consistency-review`: RED `node --test test\pathBoundary.test.js`; `npm.cmd run compile`; `node --test test\pathBoundary.test.js test\reviewPipeline.test.js test\reviewOutputTriage.test.js test\reviewInputAiDraftProvider.test.js test\traceabilityAiDraftProvider.test.js test\traceabilityCatalogStore.test.js test\bobOutputCaptureCanonicalize.test.js`; `npm.cmd test`; `git diff --check` |
| `CCR-02` | `bob-code-consistency-review-deep-review...:49` | High | Git / Bazaar revision validation が弱い | done | `e4707581` | `extensions/bob-code-consistency-review`: RED `node --test test\vcsValidation.test.js`; `npm.cmd run compile`; `node --test test\vcsValidation.test.js`; `node --test test\vcsValidation.test.js test\reviewPipeline.test.js test\reviewInputAiDraftProvider.test.js test\traceabilityAiDraftProvider.test.js test\traceabilityCommandWiring.test.js`; `npm.cmd test`; `git diff --check` |
| `CCR-03` | `bob-code-consistency-review-deep-review...:50` | High | `bzrPath` を workflow args で上書きできる | done | `e4707581` | `extensions/bob-code-consistency-review`: RED `node --test test\vcsValidation.test.js`; `npm.cmd run compile`; `node --test test\vcsValidation.test.js`; `npm.cmd test`; `git diff --check` |
| `CCR-04` | `bob-code-consistency-review-deep-review...:51` | High | Bob output canonicalizer が補正しすぎる | done | `844ef634` | `extensions/bob-code-consistency-review`: RED `node --test test\bobOutputCaptureCanonicalize.test.js`; `npm.cmd run compile`; `node --test test\bobOutputCaptureCanonicalize.test.js`; `node --test test\bobOutputCaptureCanonicalize.test.js test\reviewOutputTriage.test.js test\bobOutputPresentation.test.js`; `npm.cmd test`; `git diff --check` |
| `CCR-05` | `bob-code-consistency-review-deep-review...:52` | High | generated artifacts の機密情報リスク | done | `af705863` | `extensions/bob-code-consistency-review`: RED `node --test test\privacyArtifacts.test.js`; `npm.cmd run compile`; `node --test test\privacyArtifacts.test.js`; `node --test test\privacyArtifacts.test.js test\reviewPipeline.test.js test\workflowProviderRegistration.test.js test\integrationSandboxScript.test.js`; `npm.cmd test`; `git diff --check` |
| `CCR-06` | `bob-code-consistency-review-deep-review...:53` | Medium | 文書抽出・diff・Bob input のサイズ上限不足 | done | `74c5c4b1` | `extensions/bob-code-consistency-review`: RED `node --test test\sizeLimits.test.js`; `npm.cmd run compile`; `node --test test\sizeLimits.test.js`; `node --test test\sizeLimits.test.js test\documentExtraction.test.js test\reviewPipeline.test.js test\privacyArtifacts.test.js test\workflowProviderRegistration.test.js test\vcsValidation.test.js`; `node --test test\traceabilityCommandWiring.test.js test\sizeLimits.test.js`; `npm.cmd test`; `git diff --check` |
| `CCR-07` | `bob-code-consistency-review-deep-review...:54` | Medium | hand-written artifact path の workspace 内確認がない | done | `14067e27` | `extensions/bob-code-consistency-review`: `node --test test\pathBoundary.test.js`; `npm.cmd test`; `git diff --check` |
| `CCR-08` | `bob-code-consistency-review-deep-review...:55` | Medium | traceability AI draft の永続化前検証が浅い | done | `7a2e7d45` | `extensions/bob-code-consistency-review`: RED `node --test test\traceabilityAiDraftProvider.test.js`; `npm.cmd run compile`; `node --test test\traceabilityAiDraftProvider.test.js`; `node --test test\traceabilityAiDraftProvider.test.js test\traceabilityCatalog.test.js test\traceabilityCatalogStore.test.js test\traceabilityPrepController.test.js test\traceabilityCommandWiring.test.js test\traceabilityPrepWebview.test.js test\traceabilityPrepWebviewAssets.test.js`; `npm.cmd test`; `git diff --check` |
| `CCR-09` | `bob-code-consistency-review-deep-review...:56` | Medium | `docsRoot` の workspace escape | done | `14067e27` | `extensions/bob-code-consistency-review`: `node --test test\pathBoundary.test.js`; `npm.cmd test`; `git diff --check` |
| `CCR-10` | `bob-code-consistency-review-deep-review...:57` | Medium | Bob output fallback が stale output を拾い得る | done | `298d35f3` | `extensions/bob-code-consistency-review`: RED `node --test test\reviewOutputTriage.test.js`; `npm.cmd run compile`; `node --test test\reviewOutputTriage.test.js`; `node --test test\reviewOutputTriage.test.js test\bobOutputCaptureCanonicalize.test.js test\bobOutputPresentation.test.js test\reviewPipeline.test.js`; `npm.cmd test`; `git diff --check` |
| `CCR-11` | `bob-code-consistency-review-deep-review...:58` | Medium | C/C++ analyzer の basename fallback | done | `060114c7` | `extensions/bob-code-consistency-review`: RED `node --test test\cCppChangeAnalyzer.test.js`; `npm.cmd run compile`; `node --test test\cCppChangeAnalyzer.test.js`; `node --test test\cCppChangeAnalyzer.test.js test\reviewPipeline.test.js test\sizeLimits.test.js`; `npm.cmd test`; `git diff --check` |
| `CCR-12` | `bob-code-consistency-review-deep-review...:59` | Medium | package 出力先の stale files | done | `a2c87da4` | `extensions/bob-code-consistency-review`: RED `node --test test\reviewPackageFreshness.test.js`; `npm.cmd run compile`; `node --test test\reviewPackageFreshness.test.js`; `node --test test\reviewPackageFreshness.test.js test\reviewPipeline.test.js test\sizeLimits.test.js test\privacyArtifacts.test.js`; `npm.cmd test`; `git diff --check` |
| `CCR-13` | `bob-code-consistency-review-deep-review...:60` | Medium | AI draft / Bob output 抽出ロジックの曖昧さ | done | `9133fe43` | `extensions/bob-code-consistency-review`: RED `node --test test\reviewInputAiDraftProvider.test.js test\traceabilityAiDraftProvider.test.js test\reviewOutputTriage.test.js`; `npm.cmd run compile`; `node --test test\reviewInputAiDraftProvider.test.js test\traceabilityAiDraftProvider.test.js test\reviewOutputTriage.test.js`; `node --test test\reviewInputAiDraftProvider.test.js test\traceabilityAiDraftProvider.test.js test\reviewOutputTriage.test.js test\bobOutputCaptureCanonicalize.test.js test\traceabilityCatalog.test.js test\traceabilityCommandWiring.test.js`; `npm.cmd test`; `git diff --check` |
| `CCR-14` | `bob-code-consistency-review-deep-review...:61` | Medium | workflow inputs と trusted command options が混ざっている | done | `87a173f5` | `extensions/bob-code-consistency-review`: RED `node --test test\workflowUserOptions.test.js test\workflowOptions.test.js`; `npm.cmd run compile`; `node --test test\workflowUserOptions.test.js test\workflowOptions.test.js test\workflowProviderRegistration.test.js`; `node --test test\workflowUserOptions.test.js test\workflowOptions.test.js test\workflowProviderRegistration.test.js test\vcsValidation.test.js test\traceabilityCommandWiring.test.js test\reviewPipeline.test.js test\reviewOutputTriage.test.js`; `npm.cmd test`; `git diff --check` |
| `CCR-15` | `bob-code-consistency-review-deep-review...:62` | Low | notification が軽すぎる | done | `ebfb268d` | `extensions/bob-code-consistency-review`: RED `node --test test\notificationBehavior.test.js`; `npm.cmd run compile`; `node --test test\notificationBehavior.test.js`; `node --test test\notificationBehavior.test.js test\reviewPipeline.test.js test\traceabilityCatalogStore.test.js test\traceabilityCommandWiring.test.js test\traceabilityCatalog.test.js`; `npm.cmd test`; `git diff --check` |
| `CCR-16` | `bob-code-consistency-review-deep-review...:63` | Low | dependency / CI policy が弱い | done | `e561177` | `extensions/bob-code-consistency-review`: RED `node --test test\dependencyPolicy.test.js`; `npm.cmd run compile`; `npm.cmd run dependency:policy`; `npm.cmd test`; `npm.cmd run package`; `git diff --check`; local `npm.cmd run audit:prod` は registry certificate error で失敗（CI step は追加済み） |

## Cross-review mapping

| source id | source | canonical id | status | notes |
| --- | --- | --- | --- | --- |
| `extensions-review:WR-01` | `extensions-review...:48` | `WFR-01` | duplicate / done | deep review の `WFR-01` として対応済み。 |
| `extensions-review:WR-02` | `extensions-review...:49` | `WFR-05` | duplicate / done | snapshot privacy は `WFR-05` として対応済み。 |
| `extensions-review:WR-03` | `extensions-review...:56` | `WFR-09` | duplicate / done | workflow builder edit boundary は `WFR-09` として対応済み。 |
| `extensions-review:WR-04` | `extensions-review...:58` | `WR-04` | done | `d44cb69d`。Windows reserved name / trailing dot 対応。deep review に同一 ID なし。 |
| `extensions-review:BBR-01` | `extensions-review...:50` | `BBR-01`, `BBR-02` | duplicate / done | MCP allowed root と write tool capability は対応済み。 |
| `extensions-review:BBR-02` | `extensions-review...:54` | `BBR-04`, `BBR-16` | duplicate / done | runtime clamp と packet size clamp は対応済み。 |
| `extensions-review:BBR-03` | `extensions-review...:55` | `BBR-07` | duplicate / done | packet 選択の曖昧さは `BBR-07` として対応済み。 |
| `extensions-review:BBR-04` | `extensions-review...:57` | `BBR-18` | duplicate / done | Webview nonce は対応済み。 |
| `extensions-review:CCR-01` | `extensions-review...:51` | `CCR-02` | duplicate / done | revision validation は canonical 側で対応済み。 |
| `extensions-review:CCR-02` | `extensions-review...:52` | `CCR-01`, `CCR-07`, `CCR-09` | duplicate / done | path boundary は canonical 側で対応済み。 |
| `extensions-review:CCR-03` | `extensions-review...:53` | `CCR-06` | duplicate / done | document / diff size limits は canonical 側で対応済み。 |
| `extensions-review:CCR-04` | `extensions-review...:268` | `CCR-05` | duplicate / done | review package privacy は canonical 側で対応済み。 |

## Maintainability backlog rollup

| tracking id | source | priority | summary | status | notes |
| --- | --- | --- | --- | --- | --- |
| `WFR-MAINT-H` | `workflow-register-maintainability-review...:401` | High | model 分割、source map 方針、madge、command ID guardrail、`type-fixes.d.ts` 撤去 | done | command ID guardrail は `WFR-01`、`out/**/*.map` 非同梱方針は `5befb9dd`、import cycle gate は `7e1658e4`、`type-fixes.d.ts` 撤去は `61768663`、model 分割は `53d18349` で対応済み。 |
| `WFR-MAINT-M` | `workflow-register-maintainability-review...:409` | Medium | lockfile / `npm ci`、unused checks、service 分割、parser re-export 整理、VSIX budget | done | `59a34c5b` で lockfile、`npm ci`、dependency policy、production audit、test、VSIX package の CI gate、`5befb9dd` で VSIX contents / size policy、`36c458f9` で report-only unused checks、`02bbd22b` で parser re-export 整理、`494b5d55` で run command service 分割を対応済み。 |
| `WFR-MAINT-L` | `workflow-register-maintainability-review...:417` | Low | core 段階分割、README 追記、PR metrics | done | README の生成物、VSIX サイズ、暗黙依存、必要 CLI、Trusted Workspace は `0ddb0415`、PR metrics は `6d0c788c`、core 段階分割は `47d0f06f` で対応済み。 |
| `BBR-MAINT-H` | `bob-bazaar-review-maintainability-review...:452` | High | MCP allowed roots、MCP server 分割、runtime clamp、VSIX budget、madge | done | MCP allowed roots は `BBR-01`、runtime clamp は `BBR-04` / `BBR-16`、VSIX contents / size policy は `5befb9dd`、import cycle gate は `7e1658e4`、MCP server 分割は `834e2a8b` で対応済み。 |
| `BBR-MAINT-M` | `bob-bazaar-review-maintainability-review...:460` | Medium | src 構造整理、extension composition root 化、packet URI/state 化、unused checks、lockfile | done | `59a34c5b` で lockfile、`npm ci`、dependency policy、production audit、test、VSIX package の CI gate を追加済み。packet URI/state は `BBR-07`、report-only unused checks は `36c458f9`、extension composition root 化は `9c85153d`、workspace root-resolution module 整理は `c18290c9`、review GUI module 整理は `ebaec621`、workflow integration module 整理は `00cde5b7`、Bazaar domain module 整理は `b3b1ea2d`、root entrypoint 化は `448e399e` で対応済み。 |
| `BBR-MAINT-L` | `bob-bazaar-review-maintainability-review...:468` | Low | MCP tool 型分離、README、template / prompt / schema size budget、`export *` 禁止 | done | `0ddb0415` で README の生成物、VSIX サイズ、暗黙依存、必要 CLI、Trusted Workspace を追記済み。`b98ecf65` で MCP tool contract を `toolTypes.ts` / `toolSchemas.ts` に分離し、template artifact size policy と `export *` 禁止 rule を追加済み。 |
| `CCR-MAINT-H` | `bob-code-consistency-review-maintainability-review...:460` | High | strict path resolver、revision validation、size limits、runtime dependency、VSIX CI | done | strict path resolver は `CCR-01` / `CCR-07` / `CCR-09`、revision validation は `CCR-02` / `CCR-03`、size limits は `CCR-06`、runtime dependency / VSIX CI は `CCR-16`、VSIX contents / size policy は `5befb9dd` で対応済み。 |
| `CCR-MAINT-M` | `bob-code-consistency-review-maintainability-review...:468` | Medium | extractor / analyzer / command 分割、unused checks、madge | done | import cycle gate は `7e1658e4`、report-only unused checks と `xlsx` production dependency 除去は `36c458f9`、extractor / analyzer / command 分割は `b2a18d78` で対応済み。 |
| `CCR-MAINT-L` | `bob-code-consistency-review-maintainability-review...:476` | Low | domain type 分割、traceability facade 分離、README、`.gitignore` helper | done | `.gitignore` helper は `CCR-05`、README の生成物、VSIX サイズ、暗黙依存、必要 CLI、Trusted Workspace は `0ddb0415`、domain type 分割と traceability facade 分離は `900d501f` で対応済み。 |
| `EXT-MAINT-H` | `extensions-maintainability-review...:519` | High | 3 拡張共通の madge、VSIX contents、source map 方針、heavy dependency lazy loading、workflow model 方針 | done | `5befb9dd` で 3 拡張共通の VSIX contents / size policy と `out/**/*.map` 非同梱方針、`7e1658e4` で 3 拡張共通の import cycle gate、`53d18349` で workflow model 分割方針、`95074c6e` で heavy dependency lazy loading を追加済み。 |
| `EXT-MAINT-M` | `extensions-maintainability-review...:527` | Medium | unused checks、lockfile / `npm ci`、README、size budget | done | `59a34c5b` で 3 拡張共通の lockfile、`npm ci`、dependency policy、production audit、test、VSIX package の CI gate、`5befb9dd` で VSIX size budget、`36c458f9` で 3 拡張共通の report-only unused checks、`0ddb0415` で 3 拡張 README の生成物、VSIX サイズ、暗黙依存、必要 CLI、Trusted Workspace の保守・配布ポリシーを追加済み。 |
| `EXT-MAINT-L` | `extensions-maintainability-review...:534` | Low | re-export shim 限定、LOC/file count PR comment、schema / TypeScript drift check | done | `6d0c788c` で 3 拡張共通の `source:policy`、PR metrics comment job、workflow-register の `schema:policy` を追加済み。 |

## Additional verification checks

| tracking id | scope | check | status | done commits / next action | verification |
| --- | --- | --- | --- | --- | --- |
| `ENC-01` | `extensions/workflow-register`, `extensions/bob-bazaar-review`, `extensions/bob-code-consistency-review` | Git tracked text files are valid UTF-8 without BOM | done | `c17cbb34` | `extensions/bob-bazaar-review`: `npm.cmd test`; ad-hoc scan result: 343/343 `utf8`, 0 mismatches |
| `VSIX-01` | `extensions/workflow-register`, `extensions/bob-bazaar-review`, `extensions/bob-code-consistency-review` | Packaged VSIX files stay within baseline size budgets and exclude extension `out/**/*.map` files | done | `5befb9dd` | `npm.cmd run package && npm.cmd run package:policy` in each extension; `npm.cmd test` in each extension |
| `ARCH-01` | `extensions/workflow-register`, `extensions/bob-bazaar-review`, `extensions/bob-code-consistency-review` | `src` relative TypeScript imports are acyclic and checked in CI | done | `7e1658e4` | `npm.cmd run architecture:policy`; `npm.cmd test`; `npm.cmd run package && npm.cmd run package:policy` in each extension |
| `MODEL-01` | `extensions/workflow-register` | `core/model.ts` is only a compatibility shim and workflow model types are split into schema/provider/sink/runtime files | done | `53d18349` | RED `node --test test\sourceLayoutPolicy.test.js`; `npm.cmd run compile`; `npm.cmd run architecture:policy`; `npm.cmd run dependency:policy`; `npm.cmd test`; `npm.cmd run package && npm.cmd run package:policy` |
| `MCP-01` | `extensions/bob-bazaar-review` | MCP server entrypoint delegates JSON-RPC plumbing and Bazaar/project-rules tool implementations to separate modules | done | `834e2a8b` | RED `node --test test\mcpSourceLayout.test.js`; `npm.cmd run compile`; `node --test test\mcpAllowedRoots.test.js test\mcpRequestLimit.test.js test\mcpWriteTools.test.js test\mcpServerVersion.test.js test\mcpSourceLayout.test.js`; `npm.cmd run architecture:policy`; `npm.cmd run dependency:policy`; `npm.cmd test`; `npm.cmd run package && npm.cmd run package:policy` |
| `LAZY-01` | `extensions/bob-code-consistency-review` | DOCX/XLSX extraction dependencies are loaded only when those formats are processed, not during extension activation | done | `95074c6e` | RED `node --test test\heavyDependencyLoading.test.js`; `node --test test\documentExtraction.test.js test\pathBoundary.test.js test\reviewInputAiDraftProvider.test.js test\traceabilityAiDraftProvider.test.js test\heavyDependencyLoading.test.js`; `npm.cmd run architecture:policy`; `npm.cmd run dependency:policy`; `npm.cmd test`; `npm.cmd run package && npm.cmd run package:policy` |
| `UNUSED-01` | `extensions/workflow-register`, `extensions/bob-bazaar-review`, `extensions/bob-code-consistency-review` | `knip` / `depcheck` / `ts-prune` run as report-only unused-code checks in local scripts and CI | done | `36c458f9` | RED `node --test test\dependencyPolicy.test.js` in each extension; `npm.cmd run unused:report` in each extension; `npm.cmd run dependency:policy`; `npm.cmd run architecture:policy`; `npm.cmd test`; `npm.cmd run package && npm.cmd run package:policy` in each extension |
| `PROD-AUDIT-01` | `extensions/workflow-register`, `extensions/bob-bazaar-review`, `extensions/bob-code-consistency-review` | Production dependency audit has no high vulnerabilities; code consistency XLSX reading no longer depends on vulnerable `xlsx` | done | `36c458f9` | `npm.cmd run audit:prod -- --strict-ssl=false` in each extension; `extensions/bob-code-consistency-review`: RED `node --test test\dependencyPolicy.test.js test\heavyDependencyLoading.test.js`; `npm.cmd test`; `npm.cmd run package && npm.cmd run package:policy` |

## Completed commit index

| commit | tracked ids | note |
| --- | --- | --- |
| `4b7ebb0f` | `WFR-01` | runtime command ID guardrail |
| `e4daab04` | `WFR-01` | public schema / test sync |
| `b2404b8c` | `WFR-02` | enforce approval guardrail holds before command execution and resume only after approval |
| `d668a0fc` | `BBR-04`, `BBR-16`, `extensions-review:BBR-02` | Bazaar review size clamp and truncate handling |
| `30e0264f` | `WFR-03` | block reviewed workflow steps until accepted |
| `83049480` | `WFR-04` | rerun generic agent retries and scope Bob recovery to the current step messages |
| `8bef221a` | `WFR-05`, `extensions-review:WR-02` | default task snapshots to no chat messages, redact secrets, and ignore workflow run artifacts |
| `aad8feb6` | `BBR-06` | dynamic Markdown fences for review packet content |
| `ba88d772` | `WFR-06` | workspace containment for preflight paths |
| `0692e045` | `WFR-07` | isolate workflow state and command result prompt data from executable instructions |
| `236d8a83` | `WFR-08` | add explicit JSON state template syntax and warnings for bare placeholders |
| `ce7f6ae1` | `WFR-09` | restrict GUI builder and AI repair overwrites to .bob workflow documents |
| `3a6e76e4` | `WFR-10` | add definition hashes to legacy workflow parsing |
| `9acda46b` | `WFR-11` | strict registration diagnostics, x- extension fields, and step-type field warnings |
| `6c94c7e1` | `WFR-12` | byte-safe command result truncation |
| `2e6eb4c3` | `WFR-13` | clarify IBM Bob as optional for authoring and required only for Bob UI registration |
| `8d341e72` | `WFR-14` | gate workflow execution, registration, command providers, and file sinks on Workspace Trust |
| `e3d5c971` | `WFR-15` | randomize workflow run IDs and retry transient run-state rename failures |
| `d44cb69d` | `extensions-review:WR-04` | avoid Windows reserved workflow names and trailing dot path segments |
| `14067e27` | `CCR-01`, `CCR-07`, `CCR-09`, `extensions-review:CCR-02` | enforce workspace containment for code consistency review paths |
| `e4707581` | `CCR-02`, `CCR-03`, `extensions-review:CCR-01` | validate Git/Bazaar revisions and reject workflow bzrPath overrides |
| `844ef634` | `CCR-04` | preserve raw Bob output, canonical validation, and canonicalization report |
| `af705863` | `CCR-05`, `extensions-review:CCR-04` | add generated artifact ignore helper and privacy notices |
| `74c5c4b1` | `CCR-06`, `extensions-review:CCR-03` | add configurable document, diff, workbook, excerpt, and Bob input size limits |
| `7a2e7d45` | `CCR-08` | validate traceability AI draft schema, field sizes, collection counts, and source paths before writing |
| `298d35f3` | `CCR-10` | disable silent review-package bob-output fallback for capture, validation, and triage |
| `060114c7` | `CCR-11` | skip ambiguous C/C++ source basename fallback candidates and warn instead |
| `a2c87da4` | `CCR-12` | clean managed review package outputs and add generation id to manifest |
| `9133fe43` | `CCR-13` | reject ambiguous or oversized AI draft JSON and Bob output YAML candidates |
| `87a173f5` | `CCR-14` | allowlist workflow provider user options and reject trusted execution key overrides |
| `ebfb268d` | `CCR-15` | add non-blocking Open Report notifications for review package and traceability gate reports |
| `e561177` | `CCR-16`, `CCR-MAINT-H` | require npm ci, dependency policy, production audit, tests, and VSIX packaging in CI |
| `59a34c5b` | `WFR-MAINT-M`, `BBR-MAINT-M`, `EXT-MAINT-M` | add shared extension CI and dependency policy gates for workflow-register and bob-bazaar-review |
| `5befb9dd` | `WFR-MAINT-H`, `WFR-MAINT-M`, `BBR-MAINT-H`, `CCR-MAINT-H`, `EXT-MAINT-H`, `EXT-MAINT-M`, `VSIX-01` | gate VSIX contents, baseline size budgets, and extension source map exclusion |
| `7e1658e4` | `WFR-MAINT-H`, `BBR-MAINT-H`, `CCR-MAINT-M`, `EXT-MAINT-H`, `ARCH-01` | gate relative TypeScript import cycles and split existing type-only cycles |
| `61768663` | `WFR-MAINT-H` | remove global `Object.title` type augmentation and add a regression policy |
| `53d18349` | `WFR-MAINT-H`, `EXT-MAINT-H`, `MODEL-01` | split workflow core model types into schema, provider, sink, and runtime files |
| `834e2a8b` | `BBR-MAINT-H`, `MCP-01` | split Bazaar MCP server JSON-RPC and tool implementations |
| `95074c6e` | `EXT-MAINT-H`, `LAZY-01` | lazy-load code consistency DOCX/XLSX extraction dependencies |
| `36c458f9` | `WFR-MAINT-M`, `BBR-MAINT-M`, `CCR-MAINT-M`, `EXT-MAINT-M`, `UNUSED-01`, `PROD-AUDIT-01` | add report-only unused dependency checks and replace vulnerable code consistency XLSX production dependency |
| `8c86eb05` | `BBR-14` | Bazaar revision validation |
| `fae99b40` | `BBR-18`, `extensions-review:BBR-04` | random GUI nonce |
| `c085b107` | `BBR-20` | pass text encoding to MCP config |
| `b668b76d` | `BBR-15` | parse Bazaar rename and binary diffs |
| `05ebd74e` | `BBR-17` | harden MCP config writes |
| `6f1db85c` | `BBR-09` | require project rules assets for project-rules Bazaar review entrypoints |
| `c17cbb34` | `ENC-01` | enforce UTF-8 without BOM for tracked extension text files |
| `25719710` | `BBR-10` | back up existing review-result JSON and Markdown before atomic overwrite |
| `b21ff2d2` | `BBR-11` | reject oversized MCP stdio requests and return JSON-RPC parse errors |
| `a0fceb5a` | `BBR-12` | preview and confirm workflow template refresh before overwriting existing files |
| `02bbd22b` | `WFR-MAINT-M` | consolidate workflow-register parser public export on the directory barrel |
| `494b5d55` | `WFR-MAINT-M` | split workflow-register standalone run command orchestration from registration service |
| `9c85153d` | `BBR-MAINT-M` | split bob-bazaar-review extension entrypoint into workflow provider, action, and workspace command modules |
| `c18290c9` | `BBR-MAINT-M` | move bob-bazaar-review workspace root resolution modules under `src/workspace` |
| `ebaec621` | `BBR-MAINT-M` | move bob-bazaar-review review GUI modules under `src/ui` |
| `00cde5b7` | `BBR-MAINT-M` | move bob-bazaar-review workflow integration modules under `src/workflow` |
| `b3b1ea2d` | `BBR-MAINT-M` | move bob-bazaar-review Bazaar domain modules under `src/bazaar` |
| `448e399e` | `BBR-MAINT-M` | keep bob-bazaar-review `src` root as the extension entrypoint |
| `94b0e38e` | `BBR-MAINT-M` | close bob-bazaar-review source layout item in tracking table |
| `0ddb0415` | `EXT-MAINT-M` | document generated artifacts, VSIX budgets, dependencies, CLI, and trust boundaries in extension READMEs |
| `b98ecf65` | `BBR-MAINT-L` | split MCP tool contracts and gate template artifact size / export-star policy |
| `900d501f` | `CCR-MAINT-L` | split core review types by domain and keep traceabilityCatalog as a facade |
| `6d0c788c` | `EXT-MAINT-L`, `WFR-MAINT-L` | add export-star source policy, workflow schema policy, and extension metrics PR reporting |
| `b2a18d78` | `CCR-MAINT-M` | split document extractors, C/C++ analyzer helpers, and review-input/workspace command modules |
| `47d0f06f` | `WFR-MAINT-L` | split workflow-register core schema, runtime, authoring, and snapshot implementation modules into stage directories |
