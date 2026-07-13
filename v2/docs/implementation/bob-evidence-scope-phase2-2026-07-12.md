# `bob-evidence-scope` Phase 2 実装記録

実装日: 2026-07-12  
対象: `extensions/bob-code-consistency-review`  
実装ブランチ: `codex/execute-shared-plan-6a53743e`  
実装検証 anchor: `f2625ed3f6717b13aa826c609ed5b8409c93f062`

## 1. 目的

Phase 1 で独立ドメインとして実装した `bob-evidence-scope` を、既存の `preprocessReview` と review-package 生成へ接続しました。

Phase 2 では、変更されたコード、依存影響、適用規約、文書 evidence を token budget 内で選ぶ決定結果を、次の監査可能な成果物として毎回生成します。

```text
review-package/context-budget-report.json
```

この report は AI に渡す raw context そのものではなく、「何を採用し、何を除外し、なぜそうしたか」を次工程へ渡す handoff artifact です。

## 2. Pipeline 順序

`preprocessReview` の処理順は次のとおりです。

1. `review-input.yaml` を schema 検証する。
2. VCS の base/head を immutable commit SHA に解決し、差分を取得する。
3. 文書 evidence を抽出する。
4. コード変更と symbol/call graph evidence を解析する。
5. `buildReviewContextBudget` で evidence scope を決定する。
6. traceability を構築する。
7. review package と `context-budget-report.json` を生成する。
8. scope warning を `preprocessReview` の戻り値へ統合する。

既存の `PreprocessReviewInput` と `PreprocessResult` の public shape は変更していません。

## 3. 設定入口

Phase 2 の rule pack 設定入口は次です。

```yaml
bob_options:
  evidence_scope_rules:
    - id: public-api-compatibility
      title: Public API compatibility
      evaluation: ai
      estimated_tokens: 120
      priority: required
      applies_when:
        paths:
          - src/public/**
        languages:
          - cpp
        symbol_kinds:
          - function
        risk_tags:
          - compatibility
        interface_change: true
  evidence_scope_include_low_priority: false
```

`review-input.schema.json` は、この2項目のコンテナ型だけを検証します。各 rule の詳細な妥当性は `parseProjectRules` が検証し、不正 rule を処理全体の例外にはせず、rule ID を含む deterministic warning として返します。

schema を緩くした理由は、domain parser の warning 契約を schema hard failure で無効化しないためです。`bob_options` の未知項目を無制限に許可したわけではなく、追加した2項目以外は引き続き `additionalProperties: false` で拒否します。

## 4. Budget と dependency depth

Scope token budget は既存の `maxBobInputBytes` から次の式で導出します。

```text
max(1, floor(maxBobInputBytes / 4))
```

Phase 1 adapter の evidence 見積りは次です。

```text
ceil(text.length / 4)
```

これは課金 token ではなく、決定論的な比較・選定用の概算値です。

依存展開深度は `analysis_options.max_call_depth` を使い、未指定時は `1` です。変更 symbol は `required`、直接依存は `high`、2-hop 以降は `medium` として扱います。解決不能な dynamic edge は削除せず `unknown_impact` に残します。

## 5. `context-budget-report.json`

出力には次を含みます。

- `schema_version: 1`
- `selection_policy: bob-evidence-scope-v1`
- immutable SHA range の `source_revision`
- `scope_fingerprint`
- token 見積り方針
- rule source
- selected code identities
- applicable rule metadata
- selected document identities
- unknown impact
- budget selected/excluded entries
- warning

report は raw source body、raw unified diff、文書本文、code-slice Markdown を複製しません。選定 ID、優先度、見積り、理由、locator 相当の参照情報だけを持ちます。

## 6. Managed output と鮮度

`context-budget-report.json` を `MANAGED_PACKAGE_OUTPUTS` に登録しました。

そのため、review package の再生成時には前回 report を必ず削除してから現在の artifact を書きます。`buildReviewPackage` を scope artifact なしで直接呼んだ場合も stale report は残りません。

ユーザーが同じ出力ディレクトリへ置いた管理外ファイルは、従来どおり削除しません。

## 7. Manifest handoff

Scope artifact が存在する場合、`manifest.yaml` の `inputs` に次を記録します。

```yaml
inputs:
  review_package: .bob-review/review-package
  evidence_count: 12
  context_budget_report: .bob-review/review-package/context-budget-report.json
```

`buildReviewPackage` が scope artifact なしで呼ばれた場合、この行は出力しません。これにより、既存の低レベル API 呼び出しとの互換性を維持します。

## 8. Warning 伝播

次の warning を sort・deduplicate して scope artifact に保存し、さらに `preprocessReview` の戻り値へ統合します。

- invalid rule
- duplicate rule ID
- missing changed/dependency symbol
- required evidence の budget 超過
- Phase 1 scope warning

不正 rule があっても、有効な rule とコード・文書 evidence の選定は継続します。

## 9. 変更ファイル

### 新規

- `src/evidenceScope/reviewContextBudget.ts`
- `test/evidenceScopePipeline.test.js`
- `docs/superpowers/plans/2026-07-12-bob-evidence-scope-phase2.md`
- 本実装記録
- Phase 2 検証記録
- Phase 2 manifest

### 更新

- `src/evidenceScope/index.ts`
- `src/core/pipeline.ts`
- `src/core/reviewPackageBuilder.ts`
- `resources/schemas/review-input.schema.json`
- `docs/workflows/code-consistency-review/schemas/review-input.schema.json`
- `docs/evidence-scope-domain-contract-ja.md`

## 10. Phase 3 境界

Phase 3 では、inline `bob_options.evidence_scope_rules` だけでなく、project rule pack ファイルの read-only 読込、schema/version、SHA-256 rule-pack hash、source path、stale 判定入力を実装します。

Phase 2 では、外部 rule pack の探索、UNC/AD アクセス、credential 保存、artifact ledger への横断索引は行いません。
