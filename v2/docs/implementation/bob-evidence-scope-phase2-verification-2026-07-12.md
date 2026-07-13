# `bob-evidence-scope` Phase 2 検証記録

検証日: 2026-07-12  
対象ブランチ: `codex/execute-shared-plan-6a53743e`  
Pull Request: `#72`  
実装検証 anchor: `f2625ed3f6717b13aa826c609ed5b8409c93f062`

## 1. TDD RED

### Test-only commit

```text
ba84a6ffd093210bc5979adff93cd00518ad9cdb
```

追加した test:

- `preprocessReview emits the evidence scope budget report and manifest handoff`
- `buildReviewPackage removes a stale context budget report when no current artifact is supplied`

GitHub Actions run `29198054689` では、dependency / architecture / source / unused / audit / compile が成功し、Unit tests だけが失敗しました。

失敗理由は期待どおりでした。

1. `preprocessReview` が `context-budget-report.json` を生成していない。
2. `buildReviewPackage` が stale `context-budget-report.json` を managed output として削除していない。

これにより、追加 test が既存動作を追認するだけでなく、Phase 2 の未実装契約を検出することを確認しました。

## 2. Root-cause investigation

### Schema boundary

最初の実装後、TypeScript compile は成功しましたが pipeline test が失敗しました。

原因は `review-input.schema.json` の `bob_options.additionalProperties: false` です。Phase 1 の domain parser は `evidence_scope_rules` を warning 付きで検証する設計でしたが、その前段の JSON Schema が新項目を拒否していました。

修正では `bob_options` 全体を開放せず、次の2項目だけを追加しました。

- `evidence_scope_rules`: array
- `evidence_scope_include_low_priority`: boolean

rule entry の詳細検証は引き続き `parseProjectRules` が担当します。

### Immutable revision contract

schema 修正後の残りの失敗は、test が `source_revision` に branch 名を期待していたことでした。

実装の `collectGitDiff` は、安全性と再現性のため base/head を `git rev-parse --verify <ref>^{commit}` で 40 桁 SHA に解決します。production code を branch 名記録へ弱めず、test を次の契約へ修正しました。

```text
^[0-9a-f]{40}\.[0-9a-f]{40}$
```

## 3. GREEN

Implementation/test anchor:

```text
f2625ed3f6717b13aa826c609ed5b8409c93f062
```

GitHub Actions `code-consistency-review-scaffold` run:

```text
29198683817
```

結果:

- Validate VS Code extension: success
- dependency policy: success
- architecture policy: success
- source policy: success
- unused dependency report: success
- production dependency audit: success
- compile: success
- unit tests: success
- package: success
- VSIX policy: success
- Validate scaffold: success
- scaffold typecheck: success
- scaffold unit tests: success
- scaffold smoke tests: success

拡張 test suite は Phase 1 の 209 tests に Phase 2 の2 testsを追加し、211 tests が通過する構成です。

## 4. 機能検証項目

### Report emission

- `review-package/context-budget-report.json` が存在する。
- `schema_version` は `1`。
- `selection_policy` は `bob-evidence-scope-v1`。
- `source_revision` は immutable SHA range。
- `scope_fingerprint` は `scope-` + 8 hex。
- budget は default `maxBobInputBytes` から `524288` として算出される。

### Rule behavior

- TypeScript symbol に language rule が適用される。
- invalid `broken-rule` は除外される。
- invalid rule warning が report と `preprocessReview().warnings` の両方へ伝播する。
- unknown `bob_options` は schema で拒否され続ける。

### Package freshness

- `context-budget-report.json` は managed output。
- artifact なしの `buildReviewPackage` 呼出でも stale report が削除される。
- artifact があるときだけ manifest に handoff path が追加される。

### Privacy

JSON serialization を検査し、次の property を report に含めないことを確認しています。

- `text`
- `markdown`

report は raw source、raw diff、raw document body を重複保存しません。

## 5. Schema synchronization

次の2 schema は同一内容へ更新しました。

- `extensions/bob-code-consistency-review/resources/schemas/review-input.schema.json`
- `docs/workflows/code-consistency-review/schemas/review-input.schema.json`

拡張 runtime と公開 scaffold/documentation の schema drift を防ぎます。

## 6. Broad CI の扱い

`extensions-quality` は concurrency で新しい PR head を優先するため、実装 anchor `f2625ed...` の一部 Windows job は後続の documentation commit により cancelled になりました。

一方、同 run では対象の Linux `bob-code-consistency-review` job が unit/package/VSIX/Extension Host smoke まで success でした。最終成果物 commit の head で、Linux/Windows を含む全 matrix を改めて確認してから完了とします。

## 7. 結論

Phase 2 の実装契約は test-first で検証され、pipeline、schema、package freshness、manifest handoff、warning、privacy の各境界が自動 test で保護されています。

最終完了条件は、成果物 manifest を含む最終 PR head に対する以下2 workflow の成功です。

- `code-consistency-review-scaffold`
- `extensions-quality`
