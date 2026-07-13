# Bob Evidence Scope Final Artifact Stale Ledger 実装記録

## 概要

最終フェーズは Phase 5 producer/cache と Phase 1–4 consumer/pipeline の上に、persistent artifact ledger と stale-state propagation を追加した。検証済み source head は `3abc4473637fd000b7940b0007e7e4ed45ba27ae`。

## 実装構成

- `src/evidenceScope/artifactLedger.ts`: bounded load、strict normalization、deterministic reconciliation、fixed-point stale propagation、atomic canonical JSON write。
- `src/core/reviewPackageBuilder.ts`: manifest と ledger が共有する package input hash、managed package exact-byte content hash。
- `src/core/pipeline.ts`: package 前の upstream checkpoint と package 後の final checkpoint。
- `src/core/preprocessTypes.ts`: ledger path と fresh/stale/missing count。
- `src/core/fileSystem.ts`: `.bob-review/artifact-ledger.json` の workspace/realpath confinement。
- `src/evidenceScope/index.ts`: ledger API と型の explicit export。

## 状態遷移

- current observation は同じ ID の record を置換し `fresh` になる。
- complete kind の旧 record が current observations に無ければ `missing`。
- upstream fingerprint 変更は unobserved dependent に `upstream-changed:<id>` を付け `stale` にする。
- stale/missing dependency は fixed-point で transitive に伝播する。
- dependent 自身が current reconciliation に観測された場合だけ再構築済みとして `fresh` に戻る。

## Failure safety

上流 checkpoint は `buildReviewPackage` より先に atomic write される。したがって index/rule-pack 更新後に package 生成が失敗しても、旧 package が fresh と誤表示されない。

## Privacy と互換性

ledger は ID、path、hash、revision、producer、dependency、status、reason だけを保存する。artifact body、raw source、raw diff、document、credential は保存しない。既存 manifest、review input、repository-index v1、rule-pack v1、consume mode、Bazaar path は維持し、新規 npm dependencyは追加していない。
