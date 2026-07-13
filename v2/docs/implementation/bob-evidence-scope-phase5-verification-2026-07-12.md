# Bob Evidence Scope Phase 5 検証記録

## 対象

- immutable Git blob based repository-index producer
- deterministic stable symbol/reference extraction
- source-free file fragment cache
- changed/new/deleted file invalidation
- global re-link after fragment reuse
- preprocess build-and-consume mode
- path/revision/dirty/resource boundaries
- public API と Phase 4 consumer compatibility

## RED evidence

Original test-contract commit: `4c94f5ab8dcd79fff9a38b6c10c04f345d7a53ad`。

Current-branch recovery RED checkpoint: `28b00c634a367540eb6ddd3a500cb5a4fdb28750`。

この checkpoint では compile が `repositoryIndexCache` / `repositorySourceExtractor` 不在と未定義 path kind を検出し、focused suite は build-mode schema/pipeline 未接続を検出した。既存 Phase 1–4 contract ではなく Phase 5 の欠落による失敗である。

## Focused GREEN

```text
# tests 9
# pass 9
# fail 0
```

確認項目:

1. stable symbol ID と deterministic ordering
2. import/test/call/type relationship
3. raw source sentinel の index/cache 非格納
4. full cache hit
5. changed blob だけの partial rebuild
6. deleted fragment/edge eviction
7. reused fragment を含む global re-link
8. option/encoding invalidation
9. corrupt cache fallback
10. stale revision、dirty source、unsafe path の拒否
11. file-count/per-file/aggregate limit
12. preprocess build-and-consume
13. unsupported language warning
14. nested Git root
15. explicit public export

## Full regression suite

```text
# tests 232
# suites 0
# pass 232
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

## Policy、audit、package

```text
dependency:policy    2/2 passed
architecture:policy 90 TypeScript files, no import cycles
source:policy       90 TypeScript files, no export-star violation
unused:report       exit 0
audit:prod          0 production vulnerabilities
package             exit 0; VSIX generated
package:policy      3,687,686 bytes / 1,910 entries
```

Package verification command:

```bash
npm run package
npm run package:policy
```

両方とも exit `0`。VSIX budget は `11,000,000` bytes 以内である。

## Determinism、security、privacy

- same commit + same options は同じ canonical index bytes
- cache reuse key は immutable Git object ID と producer option identity
- global reference resolution は毎回再計算
- output path と symlink containment を fail closed
- Git command timeout/output、file count/bytes、schema count を bounded
- index/cache/report に raw source body と credentials を保存しない
- exact index bytes を SHA-256 hash
- runtime/documentation review-input schemas は同じ build/cache contract

## Remote checkpoint

Phase 5 GREEN implementation:

```text
178e2290145364e859007c0ef900923070dd418d
```

Phase 5 record checkpoint:

```text
9f873616508ed5169054575dc73bbbefa994e375
```

bot-authored implementation commit の pull-request workflow は GitHub により `action_required` となり jobs が作成されなかった。これは test failure ではない。この人間 authored verification update を正式 Linux/Windows matrix の trigger とし、run IDs と結論は完了後に PR #72 および最終 Phase 6 verification recordへ同期する。


## Authoritative remote matrix

- verified source head: `3abc4473637fd000b7940b0007e7e4ed45ba27ae`
- `code-consistency-review-scaffold` run `29209078322`: `success`
- `extensions-quality` run `29209078319`: `success`
- Linux and Windows `bob-code-consistency-review` completed through Extension Host smoke.
- Linux and Windows `workflow-register` and `bob-bazaar-review` completed through Extension Host smoke.
