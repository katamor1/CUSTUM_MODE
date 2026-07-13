# Bob Evidence Scope Phase 5 Implementation Plan

> **Execution:** Use `superpowers:executing-plans` and test-driven development. Keep the existing draft PR and commit all durable artifacts.

**Goal:** Add a deterministic built-in Git repository-index producer with per-file incremental cache invalidation behind the Phase 4 consumer contract.

**Architecture:** Enumerate immutable Git blobs for the resolved head revision, reuse validated per-file extraction fragments by Git object ID, rebuild changed fragments only, re-link all references globally, write a versioned index atomically, and immediately consume it during preprocess build mode.

**Tech stack:** TypeScript, Node.js built-ins, Git CLI through the existing bounded external-process runner, existing JSON schema/AJV validation, Node.js test runner. No new npm dependency.

## Constraints

- Preserve existing consume mode and external producer compatibility.
- Build mode is Git-only in Phase 5.
- Read source bytes from immutable Git blobs, not checkout files.
- Require checked-out HEAD to equal the resolved immutable head SHA.
- Reject dirty tracked source files in the selected language set.
- Limit source file count, per-file bytes, total bytes, Git output, and command time.
- Store no raw source body in index, cache, report, or committed evidence.
- Keep index/cache inside workspace-confined output roots.
- Recompute global reference resolution on every build, even for reused fragments.
- Cache failure is recoverable; source/revision/path failure is fatal.

## Task 1 — Lock producer and cache contracts with RED tests

**File:**
- Create `extensions/bob-code-consistency-review/test/repositorySymbolIndexProducer.test.js`

- [x] Define deterministic symbols, relationships, no-source-body contract.
- [x] Define cache hit, changed-file rebuild, deletion, and re-link behavior.
- [x] Define option/encoding invalidation and corrupt-cache fallback.
- [x] Define stale revision, dirty source, path confinement, and size limits.
- [x] Define nested repository root support.
- [x] Define preprocess build-and-consume behavior and public export.
- [x] Run tests and observe failure because producer/cache modules and schema keys do not exist.

Original RED contract commit: `4c94f5ab8dcd79fff9a38b6c10c04f345d7a53ad`.

Current-branch recovery RED checkpoint: `28b00c634a367540eb6ddd3a500cb5a4fdb28750`; compile/focused tests failed because cache/extractor modules, output path kinds, schema keys, and pipeline wiring were incomplete.

## Task 2 — Implement lexical source fragments

**File:**
- Create `src/evidenceScope/repositorySourceExtractor.ts`

- [x] Define source-free fragment/symbol/edge/reference records.
- [x] Generate path/name-based stable IDs.
- [x] Extract declarations for supported languages.
- [x] Extract import/include/test/call/type-use candidates conservatively.
- [x] Sort all fragment arrays deterministically.

## Task 3 — Implement validated incremental cache

**File:**
- Create `src/evidenceScope/repositoryIndexCache.ts`

- [x] Define cache schema v1 and producer option identity.
- [x] Validate paths, object IDs, hashes, counts, fragments, symbols, edges, and references.
- [x] Treat missing/corrupt/incompatible cache as rebuild plus warning.
- [x] Write cache atomically with Windows-safe replacement fallback.
- [x] Store no source body.

## Task 4 — Implement immutable Git producer

**File:**
- Create `src/evidenceScope/repositorySymbolIndexProducer.ts`

- [x] Validate workspace/repository/output boundaries and revision.
- [x] Enumerate tracked blobs with `git ls-tree`.
- [x] Enforce file-count, per-file, aggregate, command, and buffer limits.
- [x] Reject dirty selected tracked source.
- [x] Reuse fragments by Git object ID and rebuild changed blobs with `git cat-file`.
- [x] Re-link all path/name references globally.
- [x] Enforce schema symbol/edge maxima.
- [x] Serialize and hash a deterministic v1 index.
- [x] Return cache metrics and warnings.

## Task 5 — Wire build mode into review preprocessing

**Files:**
- Modify `src/core/fileSystem.ts`
- Modify `src/core/reviewTypes.ts`
- Modify `src/core/preprocessTypes.ts`
- Modify `src/core/pipeline.ts`
- Modify `src/evidenceScope/index.ts`
- Modify runtime/documentation `review-input.schema.json`

- [x] Add output/cache path kinds.
- [x] Add `repository_symbol_index_mode` and cache path.
- [x] Require index path for build and build mode for cache path.
- [x] Produce after immutable diff resolution and before context-budget loading.
- [x] Pass nested Git root and cancellation/timeout.
- [x] Omit unsupported review languages with deterministic warning.
- [x] Return build metrics and update summary.
- [x] Export producer explicitly.

## Task 6 — Verify, review, and document

- [x] Focused Phase 5 tests.
- [x] Full unit suite.
- [x] Dependency, architecture, source, unused, audit gates.
- [x] VSIX package and policy.
- [x] Review cache trust, Git immutability, path confinement, Windows replace behavior, and privacy.
- [x] Write design, implementation, and verification checkpoint artifacts.
- [x] Refresh the domain contract and SHA-256 manifest after the final artifact-ledger phase.
- [x] Commit Phase 5 implementation and checkpoint evidence to the draft PR branch.
- [x] Verify final GitHub Actions Linux/Windows matrix.
- [x] Synchronize PR title/body with Phase 5 results.
