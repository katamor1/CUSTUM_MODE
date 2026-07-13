# `bob-evidence-scope` Phase 1 実装報告

日付: 2026-07-12
対象: `katamor1/bob_builtin_analyze` / `extensions/bob-code-consistency-review`

## 背景

共有計画では、`bob-document-evidence` と `bob-artifact-ledger` の前段に、今回見るべきコード・文書・プロジェクト規約を決定論的に選ぶ `bob-evidence-scope` が必要と整理されました。

Phase 1 では新しい VSIX を直ちに増やさず、既存拡張内に独立ドメイン境界を作りました。これにより、既存の analyzer 型と CI を再利用しつつ、後続 phase で pipeline 接続または別 VSIX 化できます。

## 実装内容

### 1. Change Scope Engine

- 変更 symbol を `required` seed として扱います。
- resolved edge を最大 depth まで breadth-first 展開します。
- direct dependency を `high`、2-hop 以降を `medium` とします。
- incoming / outgoing edge の両方向を impact として評価します。
- unresolved edge を `unknownImpact` に残します。
- 入力配列順に依存せず、unresolved edge の reason も含む `scopeFingerprint` を生成します。
- 非有限の dependency depth は 0 に正規化し、意図しない範囲展開を防ぎます。

### 2. Project Rule Pack Engine

- path、language、symbol kind、risk tag、interface change の構造化条件を評価します。
- `review-input.bob_options.evidence_scope_rules` 用 parser を追加しました。
- snake_case と TypeScript 側 camelCase の両方を受け付けます。
- 不正 rule と重複 ID を warning として返します。

### 3. Document Evidence adapter

- 文書取得を `DocumentEvidenceAdapter` の外部責務に分離しました。
- 参照実装は symbol link、risk/rule tag、keyword で候補を順位付けします。
- duplicate evidence ID は決定論的に一件へ統合します。

### 4. Context budget

- `required -> high -> medium -> low` の順で選びます。
- required evidence は budget 超過でも保持します。
- high / medium は残量に収まる場合だけ保持します。
- low は明示許可がない限り除外します。
- 採用・除外理由と概算 token 数を `ContextBudgetReport` に残します。

### 5. Existing analysis adapter

既存の次の結果を新ドメインへ変換します。

- `CodeAnalysisResult.changedSymbols`
- `functions`
- `callGraph`
- `codeSlices`
- `DocumentExtractionResult.evidence`

現行 call graph の symbol name を stable ID に解決できない場合、対象を捨てず unknown edge として保持します。

### 6. Artifact serializer

将来の `review-package/context-budget-report.json` 用に、schema version 1 の deterministic serializer を実装しました。source revision、selection policy、scope fingerprint、rules、documents、unknown impact、budget report、warnings を含みます。

## 変更ファイル

### Production code

- `src/evidenceScope/evidenceScopeTypes.ts`（既存 source-layout policy に従う domain-specific type module）
- `src/evidenceScope/contextBudgetPlanner.ts`
- `src/evidenceScope/rulePackEngine.ts`
- `src/evidenceScope/projectRuleConfig.ts`
- `src/evidenceScope/documentEvidenceAdapter.ts`
- `src/evidenceScope/changeScopeEngine.ts`
- `src/evidenceScope/reviewEvidenceAdapter.ts`
- `src/evidenceScope/contextBudgetArtifact.ts`
- `src/evidenceScope/index.ts`

### Test and documents

- `test/evidenceScope.test.js`
- `extensions/bob-code-consistency-review/docs/evidence-scope-domain-contract-ja.md`
- `docs/superpowers/plans/2026-07-12-bob-evidence-scope-phase1.md`
- `docs/implementation/bob-evidence-scope-phase1-2026-07-12.md`
- `docs/implementation/bob-evidence-scope-phase1-verification-2026-07-12.md`

## 依存関係

新しい npm dependency はありません。Node.js / TypeScript 標準機能だけを使います。完全な拡張ソースで 209 tests、dependency policy、import-cycle policy、export-star policy、production audit、VSIX package policy を通過しています。

## 安全性とプライバシー

- raw document の取得・複製は行いません。
- credential、UNC access、AD authentication は扱いません。
- low-priority raw context は標準で選定しません。
- unresolved dynamic impact を消さず、人間確認候補として残します。
- fingerprint は scope 比較用であり、security checksum としては使いません。

## Phase 1 の境界

この commit では、ドメイン API、adapter、artifact serializer、テスト、契約文書までを完了しています。既存 `preprocessReview` からの呼び出しと `review-package/context-budget-report.json` の実ファイル出力は、既存 package 出力の互換性を分離して検証するため次 phase とします。共有計画取得用の一時 workflow と smoke-test instrumentation は本変更で除去します。PR ブランチ上の `.codex/` capture 4 ファイルは、適用スクリプトが同じコミットへ取り込みます。

次 phase の最小変更は次の通りです。

1. `pipeline.ts` で `buildReviewEvidenceScope` を呼ぶ。
2. `reviewInput.bob_options.evidence_scope_rules` を `parseProjectRules` へ渡す。
3. `reviewPackageBuilder.ts` で `createContextBudgetArtifact` の結果を書き出す。
4. `reviewPipeline.test.js` で artifact の存在、schema version、source revision、除外理由を検証する。
