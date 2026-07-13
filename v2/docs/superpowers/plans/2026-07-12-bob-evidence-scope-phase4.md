# Bob Evidence Scope Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Consume a versioned workspace-local repository symbol/reference index so evidence scope can include caller, callee, type, global, and test impact outside changed files, with strict freshness and provenance contracts.

**Architecture:** A new loader owns path confinement, bounded read-only loading, raw-byte hashing, JSON/schema validation, revision matching, and semantic graph validation. A merge adapter combines the loaded repository graph with existing changed-file analysis, with current analysis authoritative. The existing scope engine then expands the merged graph without changing its budget or rule behavior. Report and manifest metadata carry index provenance and the index hash joins the stale-input hash.

**Tech Stack:** TypeScript 5.x, CommonJS, Node.js built-ins (`fs`, `crypto`), existing AJV schema loader, Node.js built-in test runner, no new npm dependency.

## Global Constraints

- Configuration key: `analysis_options.repository_symbol_index_path`.
- Only workspace-relative `.json` paths are accepted.
- Realpath/symlink resolution must remain inside the workspace.
- File reads are read-only and bounded by normalized `maxDocumentBytes`.
- Index `source_revision` must exactly equal the immutable 40-character `diff.head` SHA.
- SHA-256 is calculated from exact raw index bytes and prefixed with `sha256:`.
- Current review analysis is authoritative over matching index symbol IDs and canonical edges.
- Resolved edges must reference known index symbols; unknown edges retain `target_hint` and no resolved target.
- The report and manifest store provenance only, never raw index JSON or source bodies.
- Index content hash participates in package `artifact_metadata.input_hash`.
- Reviews without an index retain Phase 3 behavior.
- No new npm dependency is introduced.

---

### Task 1: Lock the loader, merge, expansion, and provenance contracts with failing tests

**Files:**
- Create: `extensions/bob-code-consistency-review/test/repositorySymbolIndex.test.js`

**Interfaces:**
- Requires: `loadRepositorySymbolIndex(input)`.
- Requires: `mergeRepositoryScopeData(analysisSymbols, analysisEdges, repositoryIndex)`.
- Requires: `buildReviewEvidenceScope(..., { repositoryIndex })`.
- Requires: report `symbol_index` and manifest repository-index provenance.

- [x] **Step 1: Write the bounded read-only loader test**

Create a temporary workspace index, read source bytes before and after loading, and assert normalized source path, ID, source revision, SHA-256, symbol/edge counts, normalized symbols, and unchanged source bytes.

- [x] **Step 2: Write validation-boundary tests**

Assert rejection of:

```js
await assert.rejects(
  loadRepositorySymbolIndex({
    workspaceRoot,
    indexPath: "../outside.json",
    expectedSourceRevision: "a".repeat(40),
    maxBytes: 4096
  }),
  /must be workspace-relative|escapes workspace/
)
```

Also assert rejection of a stale source revision, duplicate symbol ID, duplicate canonical edge, and resolved edge whose target is absent.

- [x] **Step 3: Write deterministic merge and external-impact tests**

Build an analysis graph with changed `fn:api`. Supply an index containing external caller, callee, type, global, and test symbols plus edges. Assert all five appear as direct high-priority code scope and that reversing index arrays does not change the report. Include an index copy of `fn:api` and assert current analysis wins.

- [x] **Step 4: Write the pipeline provenance/stale-hash test**

Use `createMultiLanguageGitReviewWorkspace()`, resolve its head SHA, create `.bob/evidence-scope/repository-symbol-index.json`, add the configured path under `analysis_options`, and run `preprocessReview`. Assert report and manifest provenance, external selected code, no raw index body, and a changed report hash plus manifest input hash when only index bytes change.

- [x] **Step 5: Verify RED**

Run:

```bash
cd extensions/bob-code-consistency-review
npm test
```

Expected: FAIL because the repository-index loader/adapter and pipeline integration do not exist.

### Task 2: Implement the repository symbol index v1 loader and schema

**Files:**
- Create: `extensions/bob-code-consistency-review/src/evidenceScope/repositorySymbolIndexLoader.ts`
- Create: `extensions/bob-code-consistency-review/resources/schemas/repository-symbol-index.schema.json`
- Create: `docs/workflows/code-consistency-review/schemas/repository-symbol-index.schema.json`
- Modify: `extensions/bob-code-consistency-review/src/core/schemaLoader.ts`
- Modify: `extensions/bob-code-consistency-review/src/evidenceScope/index.ts`

**Interfaces:**
- Produces: `loadRepositorySymbolIndex(input): Promise<LoadedRepositorySymbolIndex | undefined>`.
- Produces: `RepositorySymbolIndexProvenance` and `LoadedRepositorySymbolIndex`.
- Consumes existing `ScopeSymbol` and `DependencyEdge` domain types.

- [x] **Step 1: Add byte-identical runtime and documentation schemas**

Require `schema_version: 1`, index ID/source revision, symbols, and edges. Bound symbol and edge counts. Keep edge kind open, but require resolved edges to have `to` and unknown edges to have `target_hint`.

- [x] **Step 2: Implement bounded read-only loading**

Normalize with `normalizeChangedFilePathStrict`, resolve with `resolveWorkspacePathStrict`, require `.json`, open with mode `r`, check size before and after reading, reject concurrent size changes, and hash the exact `Buffer`.

- [x] **Step 3: Validate freshness and graph semantics**

Require the index revision to match `expectedSourceRevision`. Reject duplicate symbols, malformed symbol paths, duplicate canonical edges, unknown edge sources, and dangling resolved targets. Normalize risk tags and add `test-impact` for test symbols.

- [x] **Step 4: Export the public API explicitly**

Add named exports and types only; do not introduce `export *`.

### Task 3: Merge repository graph data into evidence-scope expansion

**Files:**
- Create: `extensions/bob-code-consistency-review/src/evidenceScope/repositorySymbolIndexAdapter.ts`
- Modify: `extensions/bob-code-consistency-review/src/evidenceScope/reviewEvidenceAdapter.ts`
- Modify: `extensions/bob-code-consistency-review/src/evidenceScope/index.ts`

**Interfaces:**
- Produces: `mergeRepositoryScopeData(analysisSymbols, analysisEdges, repositoryIndex)`.
- `ReviewEvidenceScopeOptions` gains `repositoryIndex?: LoadedRepositorySymbolIndex`.

- [x] **Step 1: Merge symbols deterministically**

Load index symbols first, then replace matching IDs with current analysis symbols. Sort by stable ID.

- [x] **Step 2: Merge edges deterministically**

Canonicalize by `from`, `to`, kind, and resolution. Load index edges first, then replace duplicates with current analysis edges. Sort by canonical identity and reason.

- [x] **Step 3: Run the existing scope engine on merged data**

Keep changed-symbol seeds from current analysis. Preserve existing bounded breadth-first expansion, unknown impact, rule selection, document evidence, and token budget behavior.

- [x] **Step 4: Verify focused GREEN**

Run:

```bash
node --test test/repositorySymbolIndex.test.js test/evidenceScope.test.js test/evidenceScopePipeline.test.js
```

Expected: all focused tests pass.

### Task 4: Wire index provenance into pipeline, report, manifest, and stale hash

**Files:**
- Modify: `extensions/bob-code-consistency-review/src/core/reviewTypes.ts`
- Modify: `extensions/bob-code-consistency-review/src/evidenceScope/contextBudgetArtifact.ts`
- Modify: `extensions/bob-code-consistency-review/src/evidenceScope/reviewContextBudget.ts`
- Modify: `extensions/bob-code-consistency-review/src/core/reviewPackageBuilder.ts`
- Modify: `extensions/bob-code-consistency-review/resources/schemas/review-input.schema.json`
- Modify: `docs/workflows/code-consistency-review/schemas/review-input.schema.json`

**Interfaces:**
- `analysis_options.repository_symbol_index_path?: string`.
- `ContextBudgetArtifact` gains optional `symbol_index` provenance.
- Manifest gains repository-index path, ID, revision, hash, symbol count, and edge count.

- [x] **Step 1: Admit the optional index configuration**

Add a non-empty `.json` path to both review-input schemas and the TypeScript review input type.

- [x] **Step 2: Load before scope selection**

In `buildReviewContextBudget`, load the index with workspace root, `diff.head`, encoding, and `maxDocumentBytes`; pass it to `buildReviewEvidenceScope`.

- [x] **Step 3: Serialize report provenance**

Add:

```json
{
  "symbol_index": {
    "schema_version": 1,
    "id": "payment-repository",
    "source_revision": "<head-sha>",
    "source_path": ".bob/evidence-scope/repository-symbol-index.json",
    "content_hash": "sha256:...",
    "symbol_count": 5,
    "edge_count": 5
  }
}
```

- [x] **Step 4: Connect manifest and stale input hash**

Write repository-index fields under `inputs`. Include `symbol_index.content_hash` in the deterministic input-hash payload. Use an empty string when no index is configured.

- [x] **Step 5: Verify all regression and package gates**

Run:

```bash
cd extensions/bob-code-consistency-review
npm test
npm run dependency:policy
npm run architecture:policy
npm run source:policy
npm run unused:report
npm run audit:prod
npm run package
npm run package:policy
```

Expected: every command exits `0`.

### Task 5: Commit implementation and verification evidence

**Files:**
- Create: `docs/implementation/bob-evidence-scope-phase4-2026-07-12.md`
- Create: `docs/implementation/bob-evidence-scope-phase4-verification-2026-07-12.md`
- Create: `docs/implementation/bob-evidence-scope-phase4-manifest.json`
- Modify: `extensions/bob-code-consistency-review/docs/evidence-scope-domain-contract-ja.md`
- Modify: `docs/superpowers/plans/2026-07-12-bob-evidence-scope-phase4.md`

**Interfaces:**
- Produces reviewable architecture, TDD, security, CI, and checksum evidence.

- [x] **Step 1: Record behavior and boundaries**

Document configuration, schema, producer/consumer separation, read-only loading, freshness rejection, graph validation, merge precedence, provenance, stale hashing, and non-goals.

- [x] **Step 2: Record RED and GREEN evidence**

Include test-only commit SHA, expected RED failure, final test count, policy/package results, Linux/Windows CI, and any transient CI investigation.

- [x] **Step 3: Generate the SHA-256 manifest**

Record each Phase 4 source, schema, test, spec, plan, and documentation file with bytes and SHA-256. Runtime/documentation schema mirrors must have identical hashes.

- [x] **Step 4: Commit and update PR #72**

Commit all Phase 4 artifacts to `codex/execute-shared-plan-6a53743e`, keep the PR draft, update its title/body, and preserve the branch for the next phase.

## Self-review

- **Spec coverage:** The plan covers the index consumer contract, read-only loading, freshness, semantic validation, external impact expansion, deterministic merge, provenance, stale hashing, tests, documentation, and committed artifacts.
- **Placeholder scan:** No implementation placeholder remains; each task has exact files, interfaces, commands, and expected outcomes.
- **Type consistency:** `LoadedRepositorySymbolIndex`, `RepositorySymbolIndexProvenance`, `repositoryIndex`, `symbol_index`, and `repository_symbol_index_path` are used consistently across loader, adapter, pipeline, report, manifest, tests, and docs.
