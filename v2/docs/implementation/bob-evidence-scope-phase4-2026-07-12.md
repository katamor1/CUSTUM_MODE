# Bob Evidence Scope Phase 4 実装記録

## 概要

Phase 4 は、変更ファイル内の解析結果だけでは見つけられない repository-wide impact を `bob-evidence-scope` へ渡すため、版付き symbol/reference index の consumer contract を追加した。

レビュー拡張自身が毎回 repository 全体を走査するのではなく、language server export、compiler database analyzer、専用 indexer などが生成した workspace-local JSON を read-only で受け取る。これにより producer を特定言語や解析器へ固定せず、レビュー時の latency、memory、token 使用量を bounded に保つ。

## 設定

`review-input.yaml` の `analysis_options` に次を指定する。

```yaml
analysis_options:
  repository_symbol_index_path: .bob/evidence-scope/repository-symbol-index.json
  max_call_depth: 2
```

設定は任意である。未指定時は Phase 3 までの処理と同じく、現在の diff と changed-file analysis だけで scope を作る。

## Repository symbol index v1

新しい runtime schema と documentation mirror を追加した。

- `extensions/bob-code-consistency-review/resources/schemas/repository-symbol-index.schema.json`
- `docs/workflows/code-consistency-review/schemas/repository-symbol-index.schema.json`

index document は次を持つ。

- `schema_version: 1`
- index ID
- immutable 40-character source revision
- optional generator metadata
- stable symbol records
- resolved / unknown dependency edge records

symbol は stable ID、name、workspace-relative path、kind、language、概算 token 数、visibility、interface change、risk tag、test marker を表現できる。edge kind は open string とし、`calls`、`reads`、`writes`、`uses-type`、`tests` などの producer 固有 relationship を schema revision なしで扱える。

## Loader boundary

`loadRepositorySymbolIndex` は次を実施する。

1. 設定値が non-empty workspace-relative `.json` path であることを確認する。
2. `..`、absolute path、control character、realpath/symlink escape を拒否する。
3. file を mode `r` で開く。
4. 読込前後に normalized `maxDocumentBytes` を超えていないことを確認する。
5. 読込中の file-size mutation を拒否する。
6. exact raw bytes を SHA-256 し、`sha256:<64 hex>` として保持する。
7. JSON parse と AJV v1 schema validation を実施する。
8. index source revision が resolved `diff.head` と完全一致することを確認する。
9. graph semantic validation を実施する。
10. source file を書き換えず、raw index body を review package へ複製しない。

source revision が異なる stale index は warning で続行せず preprocessing を停止する。repository-wide impact の誤った候補を正しいものとして扱う方が、index を使わない場合より危険なためである。

## Graph validation

loader は次を fatal error とする。

- duplicate symbol ID
- invalid symbol path
- edge source の欠損
- resolved edge target の欠損
- canonical edge duplicate
- unsupported schema version
- malformed revision
- oversize file

`is_test: true` の symbol には deterministic に `test-impact` risk tag を追加する。unknown edge は target を解決せず、`target_hint` と reason を既存 `unknown_impact` へ残す。

## Stable identity と merge precedence

`mergeRepositoryScopeData` は index graph と current analysis graph を統合する。changed-file analyzer の ID は処理順由来の `FUNC-0001` や `CODE-0001` になり得るため、repository index の stable ID と直接一致しない場合がある。

対応付けは次の順で行う。

1. analysis ID と index ID が完全一致する場合、その stable ID を使う。
2. 完全一致しない場合、正規化した `(path, name, kind)` が index 内で一意に一致するときだけ index stable ID へ昇格する。
3. 一致候補が複数ある場合は analysis ID を維持し、deterministic warning を残す。
4. 一致候補がない場合も analysis ID を維持する。

merge precedence は次のとおりである。

- index symbol を先に登録する。
- current analysis symbol は対応付け後の stable ID で index record を上書きする。
- index edge を先に登録する。
- current analysis call edge は merged alias table で stable ID へ解決する。
- current analysis edge が同じ canonical identity を持つ場合は current analysis reason を採用する。
- 最終 symbol と edge は stable identity 順に整列する。

current analysis を authoritative にすることで、今回の diff から得た新しい path、change type、code-slice token estimate、call reason が index record に上書きされない。一方、stable ID 昇格により index の外部 caller/callee edge を一時 ID の changed symbol から辿れる。

## Scope expansion

`buildReviewEvidenceScope` は current analysis を adapter 変換した後、repository index と merge し、既存 `buildEvidenceScope` を実行する。

changed symbol は現在の review analysis からのみ seed される。index は seed を増やすのではなく、seed から bounded depth で辿る repository-wide edge と symbol を提供する。

この構造により、変更 file 外の次の候補を既存 priority policy で選べる。

- caller
- callee
- used type
- read/write global
- related test
- import / inheritance / implementation relationship

直接接続は `high`、2-hop 以降は `medium`、変更 symbol は `required` のままである。rule selection、document evidence、unknown impact、token budget の既存 semantics は変更しない。

## Artifact provenance

index が設定された場合、`context-budget-report.json` は次の provenance を持つ。

```json
{
  "symbol_index": {
    "schema_version": 1,
    "id": "payment-repository",
    "source_revision": "<40-character-head-sha>",
    "source_path": ".bob/evidence-scope/repository-symbol-index.json",
    "content_hash": "sha256:...",
    "symbol_count": 1250,
    "edge_count": 4890
  }
}
```

`manifest.yaml` は次を記録する。

```yaml
inputs:
  repository_symbol_index: .bob/evidence-scope/repository-symbol-index.json
  repository_symbol_index_id: payment-repository
  repository_symbol_index_revision: <40-character-head-sha>
  repository_symbol_index_hash: sha256:...
  repository_symbol_count: 1250
  repository_edge_count: 4890
```

index content hash は package `artifact_metadata.input_hash` の入力へ追加した。review input、diff、rule pack が同じでも index bytes が変われば過去 package を stale と判定できる。

## Privacy

生成 artifact に保存するのは provenance、選定 ID、priority、reason、token estimate である。raw index JSON、source body、credentials は保存しない。

## TDD

Phase 4 の test-only RED commit は `1f307870e6269ef418a70a63e97908d62a5efc6e` である。

RED run では dependency、architecture、source、unused、production audit、TypeScript compile が成功した後、新規 unit tests が repository-index module 未実装のため失敗した。scaffold tests は同じ commit で成功した。

GREEN implementation anchor は `8ddee71561bbb6d8f8ef48589da2e2cc85eaad7a` である。実装 commit を生成した verification workflow は、commit 前に full unit suite と dependency / architecture / source / unused / audit / package / VSIX policy gate を実行し、すべて exit `0` の場合だけ branch へ push する構成とした。

初回 Windows matrix では production loader ではなく test fixture setup の LF 固定置換が CRLF checkout で一致せず、設定 path が挿入されない問題を検出した。また、追加した stable-identity test により、一時 analysis ID を repository stable ID へ昇格する adapter 契約の不足も検出した。

修正後は次を確認した。

- Phase 4 focused suite: 8/8
- CRLF fixture を強制した Phase 4 focused suite: 8/8
- complete extension suite: 223/223
- dependency / architecture / source / unused / audit: exit 0
- VSIX package: generated
- VSIX policy: 3,660,812 bytes / 1,900 entries

最終 Linux / Windows matrix conclusion は、この成果物一式を含む user-authored final head に対して確認し、PR 本文へ固定する。

## Non-goals

Phase 4 は次を行わない。

- repository index の生成・増分更新
- language server、compiler、external indexer の起動
- workspace 外 index の探索
- UNC / AD credential 管理
- raw source body の永続化
- producer 横断 artifact ledger の stale propagation

将来の index producer は、この consumer contract を維持したまま別 extension / workflow として追加できる。
