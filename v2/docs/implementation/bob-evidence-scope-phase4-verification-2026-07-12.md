# Bob Evidence Scope Phase 4 検証記録

## 対象

Phase 4 は workspace-local repository symbol/reference index を read-only で読み込み、変更 file 外の caller、callee、type、global、test impact を既存 evidence-scope engine へ統合する。

検証対象は次である。

- repository-symbol-index v1 schema
- bounded read-only loader
- source-revision freshness check
- graph semantic validation
- unstable analysis ID と stable repository ID の対応付け
- current-analysis-authoritative merge
- repository-wide bounded expansion
- report / manifest provenance
- package input-hash stale detection
- Linux / Windows line-ending portability

## TDD RED

Test-only RED commit:

```text
1f307870e6269ef418a70a63e97908d62a5efc6e
```

`code-consistency-review-scaffold` run `29201433661` では、dependency、architecture、source、unused、production audit、TypeScript compile、scaffold typecheck / tests / smoke が成功した後、新規 unit tests が repository-index loader / adapter 未実装のため失敗した。

この順序により、既存基盤の failure ではなく Phase 4 contract の欠如を検出していることを確認した。

## GREEN implementation

Initial implementation anchor:

```text
8ddee71561bbb6d8f8ef48589da2e2cc85eaad7a
```

実装は次を追加した。

- strict JSON schema と byte-identical documentation mirror
- workspace confinement、read-only bounded load、exact-byte SHA-256
- immutable head revision matching
- duplicate / dangling graph rejection
- current analysis と repository graph の deterministic merge
- external caller / callee / type / global / test expansion
- report / manifest provenance と stale input hash
- explicit public API

## Functional coverage

`test/repositorySymbolIndex.test.js` の8テストは次を検証する。

1. workspace-local file の bounded read-only load
2. exact raw bytes の SHA-256 と source bytes 非変更
3. path escape と stale revision の拒否
4. duplicate symbol、dangling target、duplicate edge の拒否
5. external caller / callee / type / global / test の direct impact 選定
6. index input array orderを反転しても同じ selection / fingerprint
7. current analysis symbol の優先
8. 一時 analysis ID を一意な `(path, name, kind)` で stable repository ID へ昇格
9. current name-based call edge の stable-ID 解決と duplicate edge replacement
10. report / manifest provenance
11. index bytes のみの変更による report hash / package input hash 更新
12. raw index sentinel の artifact 非格納
13. explicit public API export

## Windows failure investigation

初回 `extensions-quality` run `29201914409` では Linux `bob-code-consistency-review` と他の Linux / Windows jobs が成功した一方、`Windows / bob-code-consistency-review` unit tests が失敗した。同じ commit の個別再実行でも同じ段階で失敗したため flaky failure ではないと判断した。

### Root cause 1: CRLF-sensitive fixture update

Windows diagnostic は provenance test で次を記録した。

```text
Cannot read properties of undefined (reading 'content_hash')
```

fixture の `review-input.yaml` が CRLF の場合、LF 固定の文字列置換が一致せず `repository_symbol_index_path` が挿入されていなかった。

修正は入力 line ending を検出し、`/analysis_options:\r?\n/` で replacement point を選び、元の EOL を維持する。Linux 上で fixture を意図的に CRLF へ変換した focused suite を実行し、8/8 success を確認した。

### Root cause 2: analysis ID / stable ID boundary

追加した regression test は、changed-file analyzer の `FUNC-0001` と repository index の `stable:api` が同じ `(path, name, kind)` を持っても、exact ID merge だけでは external caller edge へ接続できないことを検出した。

修正後の adapter は次を実施する。

- exact ID を最優先
- 正規化済み `(path, name, kind)` が一意な場合だけ stable ID へ昇格
- ambiguous match は current ID を維持し warning
- current call edge も stable alias へ remap
- canonical duplicate edge は current analysis reason で上書き

これにより、一時 ID を seed にした review でも repository-wide edge を安定して辿れる。

## Local complete verification

最終ソース export に対し、次を実行した。

```bash
npm test
npm run dependency:policy
npm run architecture:policy
npm run source:policy
npm run unused:report
npm run audit:prod
npm run package
npm run package:policy
```

### Full suite

```text
# tests 223
# suites 0
# pass 223
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

### CRLF-focused suite

```text
# tests 8
# pass 8
# fail 0
```

### Policy / package

```text
dependency:policy  2/2 passed
architecture:policy  87 TypeScript files, no import cycles
source:policy  87 TypeScript files, no export-star violation
unused:report  exit 0
audit:prod  0 production vulnerabilities
package  VSIX generated
package:policy  3,660,812 bytes / 1,900 entries
```

## Schema and artifact checks

- runtime / documentation repository-index schemas are byte-identical
- runtime / documentation review-input schemas are byte-identical
- index content hash is `sha256:<64 lowercase hex>`
- report contains provenance but not raw index JSON
- manifest contains index path / ID / revision / hash / symbol count / edge count
- package input hash changes when only index bytes change
- current analysis overrides stale index metadata and duplicate edge reasons
- unknown edges preserve target hint and remain human-visible
- no temporary diagnostic logs or Phase 4 helper workflows remain in the final diff

## Final CI

最終 user-authored commit に対し、次を確認する。

- `code-consistency-review-scaffold`
  - dependency / architecture / source / unused / audit
  - compile / 223 unit tests
  - package / VSIX policy
  - scaffold typecheck / unit tests / smoke tests
- `extensions-quality`
  - Linux / Windows `bob-code-consistency-review` through Extension Host smoke
  - workflow-register Linux / Windows
  - bob-bazaar-review Linux / Windows
  - source metrics

最終 run ID と conclusion は PR #72 本文へ同期する。
