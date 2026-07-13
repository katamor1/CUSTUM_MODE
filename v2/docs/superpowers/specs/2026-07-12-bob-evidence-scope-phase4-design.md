# Bob Evidence Scope Phase 4 Design

## Goal

Add a reusable, versioned repository-wide symbol/reference index contract so `bob-evidence-scope` can include callers, callees, types, globals, and tests that live outside the files changed by the current diff.

## Context

Phases 1–3 select evidence deterministically, connect the selector to `preprocessReview`, and load project rule packs with provenance. The remaining scope gap is that `CodeAnalysisResult` is principally derived from changed files. Its call graph therefore cannot reliably represent repository-wide impact.

Phase 4 does not turn the review extension into a full language server or repository crawler. Instead, it defines a consumer contract for an index produced by a dedicated analyzer, compiler database tool, language server export, or future `bob-evidence-scope` indexer.

## Selected approach

Use a workspace-local, read-only JSON sidecar configured through:

```yaml
analysis_options:
  repository_symbol_index_path: .bob/evidence-scope/repository-symbol-index.json
```

The index is optional. When absent, Phase 1–3 behavior is unchanged. When present, it is loaded before evidence-scope selection and merged with the current review analysis.

This approach is preferred over scanning the whole repository during every review because it:

- keeps review latency and memory bounded;
- permits language-specific producers without coupling them to the review extension;
- makes freshness explicit through source revision and SHA-256 provenance;
- provides a stable handoff contract for a future standalone index producer and artifact ledger;
- preserves deterministic selection independent of input array order.

## Repository symbol index v1

The document is JSON and has this logical shape:

```json
{
  "schema_version": 1,
  "index": {
    "id": "payment-repository",
    "source_revision": "0123456789abcdef0123456789abcdef01234567",
    "generator": "clang-index-export/1.0"
  },
  "symbols": [
    {
      "id": "fn:Payment_Review",
      "name": "Payment_Review",
      "path": "src/payment/review.c",
      "kind": "function",
      "language": "c",
      "estimated_tokens": 40,
      "visibility": "internal",
      "risk_tags": ["payment"]
    }
  ],
  "edges": [
    {
      "from": "test:Payment_Review_timeout",
      "to": "fn:Payment_Review",
      "kind": "tests",
      "resolution": "resolved",
      "reason": "test invokes Payment_Review"
    }
  ]
}
```

### Symbol contract

Each symbol has a stable ID, display name, workspace-relative source path, kind, and optional language, estimated token count, visibility, interface-change flag, risk tags, and test marker.

A test marker adds the deterministic `test-impact` risk tag. Current-diff analysis is authoritative when an index symbol uses the same stable ID.

### Edge contract

Resolved edges require `from` and `to` symbol IDs that exist in the index. Supported edge kinds are open strings so producers can represent `calls`, `reads`, `writes`, `uses-type`, `inherits`, `implements`, `tests`, `imports`, and future relationships without a schema revision.

Unknown edges omit `to`, require `target_hint`, and remain visible through `unknown_impact` rather than being silently discarded.

Duplicate symbol IDs, duplicate canonical edges, dangling resolved edges, and malformed paths are fatal index errors.

## Loading and freshness

`loadRepositorySymbolIndex`:

1. accepts only a non-empty workspace-relative `.json` path;
2. rejects absolute paths, `..`, control characters, and realpath/symlink escapes;
3. opens the file read-only;
4. enforces normalized `maxDocumentBytes` before and after reading;
5. hashes the exact raw bytes as `sha256:<64 hex>`;
6. parses JSON and validates the v1 schema;
7. verifies that `index.source_revision` equals the immutable diff head SHA;
8. validates symbol and edge semantics;
9. never rewrites or copies the raw index into the review package.

A stale index is rejected rather than used with a warning. Repository-wide impact data can materially change review scope, so silently consuming a mismatched revision would create false confidence.

## Merge and selection flow

1. Existing analyzers produce changed symbols, detailed changed-file functions, and local call edges.
2. The repository index is loaded and validated against `diff.head`.
3. Index symbols and edges are normalized and sorted.
4. Current analysis symbols replace index symbols with the same ID.
5. Current analysis edges replace canonical duplicates from the index.
6. The existing bounded breadth-first scope expansion runs over the merged graph.
7. Edge kind is retained in inclusion reasons, so external caller, callee, type, global, and test impact remains auditable.
8. Existing token-budget, rule-pack, document-evidence, and unknown-impact behavior remains unchanged.

## Artifact provenance

When configured, `context-budget-report.json` includes:

```json
{
  "symbol_index": {
    "schema_version": 1,
    "id": "payment-repository",
    "source_revision": "0123456789abcdef0123456789abcdef01234567",
    "source_path": ".bob/evidence-scope/repository-symbol-index.json",
    "content_hash": "sha256:...",
    "symbol_count": 1250,
    "edge_count": 4890
  }
}
```

`manifest.yaml` records the same source path, ID, revision, hash, symbol count, and edge count. The index content hash participates in `artifact_metadata.input_hash`, so changing only index bytes invalidates prior review artifacts.

The report and manifest contain provenance and selected IDs only. They do not include raw index JSON, source bodies, or credentials.

## Error handling

Preprocessing aborts with a path-specific error for:

- unsupported schema version;
- source revision mismatch;
- index size overflow or concurrent mutation;
- workspace escape;
- duplicate symbols or edges;
- dangling resolved references;
- invalid test, visibility, path, or token fields.

The index is optional, so reviews without the configuration continue to work exactly as in Phase 3.

## Testing

Phase 4 tests cover:

- bounded read-only loading and exact-byte SHA-256;
- workspace escape, duplicate ID, dangling edge, and stale revision rejection;
- deterministic merge with current analysis taking precedence;
- selection of external caller, callee, type, global, and test symbols;
- report and manifest provenance;
- input-hash changes when only index bytes change;
- absence of raw index content from generated artifacts;
- stable output when symbol and edge arrays are reversed;
- all existing 215 extension tests and package/policy gates.

## Non-goals

Phase 4 does not:

- build or incrementally update the repository index;
- invoke language servers, compilers, or external indexers;
- search outside the workspace;
- manage UNC/AD credentials;
- persist raw source bodies in the index consumer;
- implement producer-crossing artifact-ledger stale propagation.

A future phase can add one or more index producers behind this contract without changing the review consumer API.
