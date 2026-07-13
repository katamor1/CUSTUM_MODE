# Bob Evidence Scope Phase 3 検証記録

- test-only commit: `916d0df9a0d579f3b2ea28f1976c3b2b11c5db8f`
- GREEN implementation anchor: `0962c4af7d9cec69673117fd3e8c3e970bf3598e`
- code-consistency-review-scaffold run: `29200318548`
- extensions-quality run: `29200318583`

## TDD RED

Phase 3 の test-first 対象は `test/projectRulePack.test.js` である。

RED commit では既存の dependency、architecture、source、unused、audit、TypeScript compile が成功し、新規 Unit tests が次の未実装契約を検出した。

- `projectRulePackLoader` public module
- bounded read-only load と exact raw-byte SHA-256
- workspace escape / unsupported schema version の拒否
- project-authoritative rule merge
- pipeline report と manifest の rule-pack provenance
- rule-pack bytes のみが変わった場合の stale input hash 更新

失敗は production regression ではなく、新しい module/provenance contract が存在しないことによる期待どおりの RED であった。

## Focused GREEN

`projectRulePack.test.js` の4テストが成功した。

```text
# tests 4
# pass 4
# fail 0
```

検証した behavior は次のとおり。

### Loader boundary

- workspace-local `.yaml` を mode `r` で読み込む
- source bytes が読み込み前後で同一
- source path を POSIX 形式の workspace-relative path として保持
- SHA-256 が exact source bytes と一致
- configured `maxBytes` より大きい pack を `maxDocumentBytes` diagnostic で拒否
- `../outside.yaml` を拒否
- `schema_version: 2` を拒否
- schema error に source path を含める

### Rule semantics

- project rule pack を authoritative とする
- inline-only ID は追加する
- duplicate inline ID は project rule を維持する
- duplicate warning は決定論的に整列する

### Pipeline / stale detection

- `context-budget-report.json.rule_source` が pack path を指す
- report に ID、version、source path、SHA-256 を記録する
- applicable rule に pack rule が含まれる
- manifest に rule-pack provenance を記録する
- rule-pack bytes のみの変更で report hash が変わる
- rule-pack bytes のみの変更で manifest `input_hash` が変わる
- raw rule-pack body を report に格納しない

## Full suite

GitHub Actions `code-consistency-review-scaffold` run `29200318548` で次を実行した。

```bash
cd extensions/bob-code-consistency-review
npm test
```

結果:

```text
# tests 215
# suites 0
# pass 215
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Phase 1/2 の evidence scope、既存 preprocessing、Bob output、traceability、VCS、workflow provider、package freshness を含む全215テストが成功した。

同じ job で次も成功した。

- dependency policy
- architecture policy
- source policy
- unused dependency report
- production dependency audit
- TypeScript compile
- VSIX package
- VSIX policy

scaffold typecheck、unit tests、smoke tests も成功した。

## Linux / Windows extension validation

`extensions-quality` run `29200318583` では Phase 3 対象の `bob-code-consistency-review` が次を完了した。

- Linux dependency / architecture / source / unit / package / VSIX policy
- Linux Extension Host smoke
- Windows dependency / architecture / source / unit / package / VSIX policy
- Windows Extension Host smoke

いずれも成功した。

同じ multi-extension workflow 内の別拡張 `workflow-register` は、最初の Linux unit-test attempt が一度失敗した。Phase 3 対象拡張と scaffold は同一 commit で成功しており、branch 更新により rerun attempt が途中 cancel されたため、この attempt は Phase 3 acceptance evidence には使用しない。最終 branch head は改めて全 workflow を実行し、PR 本文へ conclusion を同期する。

## Schema parity

次の pair は byte-identical である。

- runtime / documentation `evidence-scope-rule-pack.schema.json`
- runtime / documentation `review-input.schema.json`

checksum manifest で byte size と SHA-256 の一致を確認する。

## Privacy / security verification

- workspace boundary と realpath/symlink boundary を既存 path helper で強制
- read-only file handle
- `maxDocumentBytes` の read 前後検査と oversize regression test
- exact raw bytes の SHA-256
- raw rule-pack body 非出力
- no credential storage
- no new npm dependency

## Temporary artifacts

一時 manifest/diagnostic workflow と raw diagnostic log は final branch から削除した。永続成果物は implementation record、verification record、domain contract、plan、schema、source、tests、checksum manifest のみである。
