# Bob Evidence Scope Phase 6 Artifact Ledger Design

## 1. Purpose

Phase 6 is the final `bob-evidence-scope` phase. It adds a persistent, source-free artifact ledger that records the repository-index producer artifact, project rule-pack provenance, and generated review packages as a dependency graph. The ledger makes stale state explicit when an upstream artifact changes, disappears, or becomes invalid, and clears stale state only after the dependent artifact is rebuilt from the current upstream set.

The ledger is an audit and freshness sidecar. It does not copy source code, index JSON, rule-pack bodies, document excerpts, raw diffs, prompt content, or review-package bodies.

## 2. Chosen approach

The ledger is stored independently at:

```text
.bob-review/artifact-ledger.json
```

This is preferred over embedding the ledger in `manifest.yaml` because package regeneration deletes managed package outputs, while stale propagation must survive a failed or interrupted package rebuild. It is preferred over an append-only event log because the final phase needs bounded current-state reconciliation, not an unbounded event store.

## 3. Schema v1

```json
{
  "schema_version": 1,
  "ledger_id": "bob-evidence-scope",
  "source_revision": "<40-character-head-sha>",
  "artifacts": [
    {
      "id": "repository-symbol-index:bob-repository-index",
      "kind": "repository-symbol-index",
      "producer": "bob-code-consistency-review/repository-index-producer-v1",
      "path": ".bob/evidence-scope/repository-symbol-index.json",
      "content_hash": "sha256:...",
      "input_hash": "sha256:...",
      "source_revision": "<40-character-head-sha>",
      "depends_on": [],
      "status": "fresh",
      "stale_reasons": []
    },
    {
      "id": "review-package:REVIEW-001",
      "kind": "review-package",
      "producer": "bob-code-consistency-review@0.1.0",
      "path": ".bob-review/review-package",
      "content_hash": "sha256:...",
      "input_hash": "sha256:...",
      "source_revision": "<base-sha>..<head-sha>",
      "depends_on": [
        "repository-symbol-index:bob-repository-index"
      ],
      "status": "fresh",
      "stale_reasons": []
    }
  ]
}
```

### Artifact kinds

- `repository-symbol-index`
- `project-rule-pack`
- `review-package`

The schema remains intentionally closed for v1. New kinds require an explicit schema revision or an additive implementation change with tests.

## 4. Reconciliation model

The pure reconciliation engine consumes:

- a previous ledger, if one exists;
- the current immutable head revision;
- current artifact observations;
- artifact kinds that are complete for the current checkpoint.

An observation contains identity, kind, producer, path, content hash, input hash, source revision, and dependency IDs. It never contains artifact bodies.

### State transitions

1. A current observation replaces the record with the same ID and is initially `fresh`.
2. A previous record in a complete kind that is absent from current observations becomes `missing`.
3. A previous, unobserved record becomes `stale` when the ledger head revision changes.
4. A previous, unobserved dependent becomes `stale` when an observed dependency changes fingerprint.
5. Any record whose dependency is `stale` or `missing` becomes `stale` through fixed-point propagation.
6. A dependent observed in the same reconciliation is considered rebuilt and remains `fresh` when all dependencies are fresh.
7. Only an explicit current observation can clear an existing stale state.

Stale reasons are stable strings, sorted and deduplicated:

```text
source-revision-changed
artifact-missing
upstream-changed:<artifact-id>
dependency-stale:<artifact-id>
dependency-missing:<artifact-id>
```

## 5. Two-checkpoint pipeline integration

`preprocessReview` writes the ledger twice:

### Upstream checkpoint

After the optional repository-index build and after `buildReviewContextBudget` has loaded the current index/rule-pack provenance, but before review-package generation:

- observe the current repository index and rule pack;
- mark removed upstream artifacts missing;
- propagate changed/missing upstream state to the previous review package;
- write the ledger atomically.

If package generation then fails, the persisted ledger correctly leaves the old package stale.

### Final checkpoint

After the review package is successfully written:

- compute the exact managed-package content hash;
- compute the same deterministic package input hash used by `manifest.yaml`;
- observe the rebuilt review package with dependencies on current upstream artifact IDs;
- reconcile and atomically write the final ledger.

The final current package is `fresh`; older unobserved packages remain stale when their source revision or upstream lineage no longer matches.

## 6. Package hashing

The review-package content hash is SHA-256 over a canonical stream of managed package paths and exact bytes:

```text
<relative-path> NUL <byte-count> NUL <bytes> NUL
```

Paths are sorted. Only known managed outputs are included. The ledger itself is outside the package and therefore cannot create a hash cycle.

The package input hash is refactored into an exported pure helper shared by `manifest.yaml` and the ledger. It includes normalized review input, normalized diff metadata, rule-pack hash, and symbol-index hash.

## 7. Persistence and validation

- The fixed ledger path must resolve inside the workspace, including realpath/symlink checks.
- Reads are bounded by `maxDocumentBytes`.
- Missing ledger is normal.
- Corrupt, oversize, or unsupported ledger is ignored with a deterministic warning and rebuilt from current observations.
- Writes use a same-directory temporary file and atomic rename; Windows replace failures retry only for known replacement error codes.
- Records, dependencies, and stale reasons are sorted before serialization.
- Maximum records: 512.
- Maximum dependencies per record: 64.
- Duplicate IDs, invalid hashes, invalid relative paths, self-dependencies, and dangling dependencies are rejected during validation. A dangling dependency may only exist transiently as a `missing` record synthesized by reconciliation.

## 8. Privacy and compatibility

- No raw source, raw diff, document text, rule-pack body, index body, prompt, credential, environment value, or review-package body is stored.
- Existing `manifest.yaml` fields are unchanged.
- Existing `buildReviewPackage` return type remains `Promise<string[]>`.
- Consume-only mode, no-index mode, external index producers, and Bazaar review continue to work.
- No npm dependency is added.
- The ledger is additive and optional for callers that use lower-level package APIs directly.

## 9. Public surface

`src/evidenceScope/index.ts` explicitly exports:

- `reconcileArtifactLedger`
- `loadArtifactLedger`
- `writeArtifactLedger`
- `updateArtifactLedger`
- ledger types

No `export *` is introduced.

## 10. Testing and acceptance

Focused tests cover:

1. deterministic serialization and ordering;
2. upstream-change stale propagation;
3. missing-upstream propagation;
4. rebuilt dependent returning to fresh;
5. source-revision change behavior;
6. corrupt-ledger fallback;
7. path, hash, duplicate, self-dependency, and size boundaries;
8. exact managed-package hash;
9. shared manifest/ledger input hash;
10. preprocess integration in build and consume modes;
11. no raw source/index/rule-pack/package body leakage;
12. explicit public exports.

Acceptance requires the complete extension suite, dependency/architecture/source policies, unused report, production audit, package/VSIX policy, Linux and Windows matrix, committed implementation/verification records, and a SHA-256 artifact manifest on the final head.
