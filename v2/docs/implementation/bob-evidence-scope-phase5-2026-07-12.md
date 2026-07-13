# Bob Evidence Scope Phase 5 実装記録

## 概要

Phase 5 は Phase 4 で確立した repository symbol/reference index consumer 契約の背後に、Git repository から index を生成する組込み producer と、file fragment 単位の増分 cache を追加した。

review 時に workspace 全体を無条件に読み直すのではなく、immutable Git commit の tracked blob を入力とし、変化していない blob は source body を含まない過去 fragment を再利用する。生成した v1 index は同じ `preprocessReview` 呼出内で Phase 4 loader によって再検証され、そのまま evidence scope に利用される。

## 設定

```yaml
analysis_options:
  repository_symbol_index_mode: build
  repository_symbol_index_path: .bob/evidence-scope/repository-symbol-index.json
  repository_symbol_index_cache_path: .bob/evidence-scope/repository-symbol-index.cache.json
```

- mode は `consume` または `build`。未指定時は `consume`。
- `build` は index path を必須とする。
- cache path は build mode だけで使用できる。
- cache path 未指定時は index path から `.cache.json` を導出する。
- built-in producer は Git 専用。Bazaar や高精度 semantic producer は Phase 4 の external producer contract を利用できる。

## Immutable Git snapshot

producer は working-tree file を解析 source として直接読まない。

1. `sourceRevision` が40桁 commit SHAであることを確認する。
2. repository `HEAD` と `sourceRevision` の一致を確認する。
3. `git ls-tree -r -l -z <sha>` から tracked blob path、object ID、byte size を列挙する。
4. 対象 source の dirty state を `git diff --name-only -z <sha> --` で拒否する。
5. 新規・変更 fragment だけを `git cat-file blob <object-id>` で読む。

これにより checkout の改行変換、mtime、sparse working tree の表示形式に依存せず、同じ commit と同じ producer options から同じ source bytes を得る。

## Source-free lexical fragment

`repositorySourceExtractor` は raw source を artifact/cache に保持せず、各 file から stable symbol metadata、import/include/test/call/type-use candidate、local warning を抽出する。

代表的な stable ID:

```text
file:src/payment/api.ts
function:src/payment/api.ts#authorize
type:src/payment/api.ts#Request
```

対応 language は C/C++、TypeScript/JavaScript、Python、C#、Java、Go、Rust。抽出は conservative lexical policy であり、曖昧な name reference は resolved edge にしない。

## Incremental cache と global re-link

cache は producer ID/version、option hash、revision、path、Git object ID、exact blob SHA-256、byte count、language、source-free fragment を記録する。

- object ID、language、byte count が一致する file は再利用する。
- 変更・追加 file だけを再抽出する。
- 削除 file は cache/index から除外する。
- language、encoding、extractor policy が変われば全 fragment を invalidate する。
- cache が missing/corrupt/oversize/incompatible の場合は warning と full rebuild に fallback する。
- fragment を再利用しても、repository 全体の path/name reference は毎回再リンクする。

このため target file の追加、削除、rename により relation が変わる場合にも、再利用済み caller fragment の edge が最新 graph に追随する。

## Path、resource、atomic-write boundary

index/cache output は次だけを許可する。

```text
.bob/evidence-scope/*.json
.bob/evidence-scope/*.cache.json
.custom/*.json
.custom/*.cache.json
```

absolute path、`..`、control character、workspace/symlink escape を拒否する。Git command timeout/output buffer、source file count、per-file bytes、aggregate bytes、schema symbol/edge countを上限化する。index/cache は canonical JSON + trailing newline とし、temporary file + rename で置換する。

## Pipeline integration

`preprocessReview` は immutable diff/head 解決後、build mode なら producer を実行する。生成 index は document/code analysis と context budget の前に配置され、Phase 4 consumer が同じ呼出内で schema、semantic graph、revision、SHA-256 を再検証する。

`PreprocessResult.repositoryIndexBuild` は index/cache path、revision/hash、symbol/edge count、scanned/reused/rebuilt/removed file count、cache status、warnings を返す。unsupported review language は除外し、deterministic warning を残す。

## Privacy と互換性

- raw source body、credentials、environment values を index/cache/review package に保存しない。
- index/cache body を review package に複製しない。
- consume-only mode、index 未設定 mode、external producer contract を維持する。
- new npm dependency は追加しない。

## TDD と回復実装

Original RED contract commit:

```text
4c94f5ab8dcd79fff9a38b6c10c04f345d7a53ad
```

現行 branch の recovery RED checkpoint `28b00c634a367540eb6ddd3a500cb5a4fdb28750` では、producer test と producer 本体は存在したが、cache/source extractor、path policy、schema mirror、pipeline wiring が未完成だった。compile は missing module/path-kind error、focused suite は module/schema integration error で失敗した。

GREEN implementation commit:

```text
178e2290145364e859007c0ef900923070dd418d
```

この commit は不足していた cache/extractor と integration を追加し、一時 payload/export workflow を同時に削除した。

## 最終フェーズ境界

Phase 5 は producer/cache の生成契約までを担当する。最終フェーズでは、producer artifact と review package artifact の record、dependency lineage、stale-state propagation を artifact ledger として追加する。raw source や artifact body は ledger に保存しない。
