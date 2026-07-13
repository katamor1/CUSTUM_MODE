# Bob Evidence Scope Phase 5 Design

## 1. 目的

Phase 5 は Phase 4 で確定した repository symbol/reference index の consumer 契約に、最初の built-in producer と増分 cache を追加する。レビューごとに repository 全体を解析し直すのではなく、immutable Git revision の source blob から決定論的な index を生成し、変更されていない file の抽出結果を再利用する。

成功条件は次のとおり。

- `analysis_options.repository_symbol_index_mode: build` で index を生成し、同一 preprocess 内で直ちに Phase 4 consumer が読み込む。
- 同じ revision、producer option、source blob では byte-identical index を生成する。
- source file の追加・変更・削除に応じて必要な fragment だけを再構築する。
- cache を再利用しても repository 全体の reference 解決は毎回やり直す。
- index と cache は workspace 内の限定 path にだけ書き込む。
- raw source body を index、cache、review package に保存しない。
- 既存の consume mode と外部 producer を壊さない。

## 2. 範囲

### 対象

- Git repository の tracked source blob
- C/C++、TypeScript/JavaScript、Python、C#、Java、Go、Rust の lightweight lexical extraction
- file、function、type/class/interface/enum、global の stable ID
- import/include/test/call/type-use relationship
- file fragment cache と global link 再計算
- preprocess pipeline の build/consume mode
- build result の scan/reuse/rebuild/remove metrics

### 対象外

- Bazaar repository の built-in producer
- language server、compiler database、semantic compiler API の起動
- method overload や dynamic dispatch の完全解決
- cache の共有サーバー化
- artifact ledger 全体への stale propagation
- source body の永続化

Bazaar と高精度 semantic index は Phase 4 の external producer contract を引き続き利用できる。

## 3. 設定契約

```yaml
analysis_options:
  repository_symbol_index_mode: build
  repository_symbol_index_path: .bob/evidence-scope/repository-symbol-index.json
  repository_symbol_index_cache_path: .bob/evidence-scope/repository-symbol-index.cache.json
  language:
    - typescript
    - cpp
```

- `repository_symbol_index_mode` は `consume` または `build`。
- 未指定時は従来どおり `consume`。
- `build` では index path が必須。
- cache path を指定する場合は `build` が必須。
- cache path 未指定時は index path の `.json` を `.cache.json` に置換する。
- build mode は Git 専用。Bazaar では明示 error とする。
- review の language list に producer 非対応言語が含まれる場合、その言語だけを除外して deterministic warning を返す。

## 4. Architecture

### 4.1 Immutable Git snapshot reader

producer は working-tree file を解析 source として読まない。`git ls-tree -r -l -z <source_revision>` で tracked blob、object ID、byte size、path を列挙し、再構築が必要な blob だけを `git cat-file blob <object_id>` で読む。

この方式により、Windows の checkout 改行変換、sparse checkout、working-tree encoding 変換に左右されず、同じ commit から同じ raw bytes を得られる。

producer は次を確認する。

1. source revision が 40 桁 SHA である。
2. repository root の checked-out `HEAD` と一致する。
3. 対象 tracked source に uncommitted 差分がない。
4. source count、per-file bytes、aggregate bytes が上限内である。

### 4.2 Per-file lexical extractor

各 source blob から、raw text を保持しない `RepositorySourceFragment` を作る。

```ts
type RepositorySourceFragment = {
  path: string
  language: string
  symbols: RepositoryIndexSymbolRecord[]
  edges: RepositoryIndexEdgeRecord[]
  references: RepositoryReferenceCandidate[]
}
```

stable ID は path と宣言名を使用する。

```text
file:src/api.ts
function:src/api.ts#api
type:src/api.ts#Request
```

同一 file 内に同 kind/name が複数ある場合は deterministic occurrence suffix `@1`, `@2` を付ける。

抽出器は conservative な lexical producer であり、曖昧な name reference は resolved edge にしない。path import は repository 内で解決できる場合だけ resolved とし、repository-relative target が解決できない場合は unknown edge と target hint を残す。

### 4.3 Incremental fragment cache

cache は producer private schema v1 とする。

- producer ID/version
- option hash
- source revision
- file path
- Git object ID
- exact blob SHA-256
- byte count
- language
- source body を除いた fragment

cache compatibility は producer identity と option hash で判定する。option hash には repository root、対象言語、text encoding、extractor policy version を含める。

再実行時は Git object ID、language、byte count が一致する file fragment を再利用する。変更・追加 file だけを再抽出し、削除 file は cache から除外する。cache revision が古くても、file object ID が同じなら安全に再利用できる。

cache は untrusted derived input として読み、構造、path、symbol、edge、reference を検証する。parse/validation/size error は review を停止せず、cache を無視して full rebuild し warning を残す。

### 4.4 Global linker

fragment を再利用した場合でも、全 fragment の reference candidates を毎回集約し直す。

- path reference は repository file set に対して再解決する。
- name reference は allowed kind 内で一意な場合だけ解決する。
- canonical edge identity が同じ場合は deterministic order の後勝ちで統合する。
- symbols と edges は stable key 順に sort する。

これにより、target file の追加・削除・rename によって既存 fragment の relation が変わる場合も index が追従する。

### 4.5 Pipeline integration

処理順は次のとおり。

1. review input validation
2. immutable diff/base/head resolution
3. build mode の場合、repository index producer 実行
4. document extraction
5. changed-file code analysis
6. Phase 4 repository index loader/consumer
7. scope、traceability、review package 生成

producer result は `PreprocessResult.repositoryIndexBuild` に返す。

```ts
{
  cacheStatus: "miss" | "partial" | "hit",
  scannedFiles: number,
  reusedFiles: number,
  rebuiltFiles: number,
  removedFiles: number
}
```

## 5. Security / Privacy

- output path は `.bob/evidence-scope/*.json` または `.custom/*.json`。
- cache path は `.bob/evidence-scope/*.cache.json` または `.custom/*.cache.json`。
- absolute path、`..`、control character、realpath/symlink escape を拒否する。
- Git command は shell を使わず argument array で実行する。
- command timeout、output buffer、file count、file bytes、total bytes を bounded にする。
- atomic temp-file write を使い、Windows replace error は限定 code だけ retry する。
- index/cache は source text、credential、environment value を含めない。
- review package は Phase 4 と同様、index provenance と selected IDs だけを保存する。

## 6. Error policy

Fatal:

- build mode with non-Git VCS
- source revision / checked-out HEAD mismatch
- dirty tracked source
- unsafe output/cache path
- source count/size limit overflow
- Git command failure/timeout/cancellation
- producer-generated duplicate symbol
- schema maximum overflow

Recoverable warning:

- missing cache
- corrupt/oversize/incompatible cache
- producer unsupported review language
- unresolved repository-relative reference

## 7. Testing

Focused tests cover:

- deterministic index and stable IDs
- import/test/call relationship
- cache hit, partial rebuild, deletion
- global re-link after fragment reuse
- option/encoding invalidation
- corrupt cache fallback
- stale/dirty revision rejection
- output path and size limits
- nested Git root
- preprocess build-and-consume
- explicit public API

Acceptance requires full unit suite, dependency/architecture/source policies, unused report, production audit, VSIX package, VSIX policy, and Linux/Windows GitHub Actions matrix.
